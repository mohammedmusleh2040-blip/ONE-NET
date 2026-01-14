import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
const fmtMoney = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const empty = {
  id: null,
  name: "",
  type: "cards", // cards | giga
  phone: "",
  address: "",
  notes: "",
  opening_balance: 0,
  price_per_gb: 0,
  last_reading_gb: 0,
  discount_percent: 0,
};

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * سداد "الدين الافتتاحي" فقط (ليس سداد فواتير).
 * يسجل سداد في جدول payments ثم يخصم من customers.opening_balance.
 */
async function payOpeningBalance(c, onDone) {
  const current = safeNum(c?.opening_balance);
  if (current <= 0) return alert("لا يوجد دين افتتاحي على هذا العميل");

  const s = prompt(
    `أدخل مبلغ السداد للدين الافتتاحي (المتبقي: ${current.toFixed(2)})`,
    String(current)
  );
  if (s === null) return;

  const amt = safeNum(s);
  if (amt <= 0) return alert("المبلغ غير صحيح");

  const method = (prompt("طريقة السداد؟ اكتب: cash أو bank أو other", "cash") || "cash").trim();
  const pay_date = new Date().toISOString().slice(0, 10);

  // 1) insert payment بدون فاتورة
  const { error: e1 } = await supabase.from("payments").insert([
    {
      customer_id: c.id,
      invoice_id: null,
      pay_date,
      amount: amt,
      method,
      note: "سداد دين افتتاحي",
    },
  ]);
  if (e1) return alert(e1.message || "فشل حفظ السداد");

  // 2) تحديث الدين الافتتاحي (نخصم منه)
  const newBal = Math.max(0, current - amt);
  const { error: e2 } = await supabase
    .from("customers")
    .update({ opening_balance: newBal })
    .eq("id", c.id);
  if (e2) return alert(e2.message || "فشل تحديث رصيد الدين الافتتاحي");

  alert("تم السداد بنجاح");
  if (typeof onDone === "function") await onDone();
}

function pickInvoiceTotal(inv) {
  // نحاول نقرأ من أكثر من اسم عمود (حسب اختلافات سكيماتك السابقة)
  const candidates = [
    inv?.total_amount,
    inv?.total,
    inv?.grand_total,
    inv?.net_total,
    inv?.amount,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export default function Customers() {
  const [tab, setTab] = useState("customers"); // customers | debts

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [debts, setDebts] = useState([]);
  const [debtsLoading, setDebtsLoading] = useState(false);
  const [debtsQ, setDebtsQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r &&
        (((r.name || "").toLowerCase().includes(s) ||
          (r.phone || "").toLowerCase().includes(s)))
    );
  }, [rows, q]);

  const filteredDebts = useMemo(() => {
    const s = debtsQ.trim().toLowerCase();
    const base = (debts || []).filter((d) => safeNum(d.debt) > 0.0001);
    if (!s) return base;
    return base.filter((d) => (d.name || "").toLowerCase().includes(s));
  }, [debts, debtsQ]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("id", { ascending: false });
    setLoading(false);

    if (error) {
      console.error(error);
      alert("خطأ في تحميل العملاء");
      return;
    }
    setRows(data || []);
  };

  const loadDebts = async () => {
    setDebtsLoading(true);

    // 1) حاول view جاهز لو موجود
    // ملاحظة: شكل الأعمدة قد يختلف، فنعمل mapping مرن
    try {
      const { data, error } = await supabase
        .from("v_customer_debt_snapshot")
        .select("*")
        .order("debt", { ascending: false });

      if (!error) {
        const mapped = (data || []).map((r) => ({
          id: r.customer_id ?? r.id ?? r.customerid ?? null,
          name: r.customer_name ?? r.name ?? r.customer ?? "",
          opening_balance: safeNum(r.opening_balance ?? r.opening ?? 0),
          invoices_total: safeNum(r.invoices_total ?? r.invoices ?? r.sales_total ?? 0),
          payments_total: safeNum(r.payments_total ?? r.payments ?? r.paid_total ?? 0),
          debt: safeNum(r.debt ?? r.balance_due ?? r.balance ?? 0),
        }));
        setDebts(mapped.filter((x) => x.id != null));
        setDebtsLoading(false);
        return;
      }
    } catch (e) {
      // ignore, fallback below
      console.warn("v_customer_debt_snapshot load failed, fallback compute", e);
    }

    // 2) fallback: نحسب من الجداول
    try {
      const { data: customers, error: eC } = await supabase
        .from("customers")
        .select("id,name,opening_balance")
        .order("id", { ascending: false });
      if (eC) throw eC;

      const custMap = new Map();
      (customers || []).forEach((c) => {
        custMap.set(c.id, {
          id: c.id,
          name: c.name || "",
          opening_balance: safeNum(c.opening_balance),
          invoices_total: 0,
          payments_total: 0,
          debt: 0,
        });
      });

      // invoices
      const { data: invs, error: eI } = await supabase
        .from("invoices")
        .select("id,customer_id,total_amount,total,grand_total,net_total,amount");
      if (eI) throw eI;

      (invs || []).forEach((inv) => {
        const cid = inv.customer_id;
        if (!custMap.has(cid)) return;
        custMap.get(cid).invoices_total += pickInvoiceTotal(inv);
      });

      // payments
      const { data: pays, error: eP } = await supabase
        .from("payments")
        .select("id,customer_id,amount");
      if (eP) throw eP;

      (pays || []).forEach((p) => {
        const cid = p.customer_id;
        if (!custMap.has(cid)) return;
        custMap.get(cid).payments_total += safeNum(p.amount);
      });

      const result = Array.from(custMap.values()).map((x) => ({
        ...x,
        debt: safeNum(x.opening_balance) + safeNum(x.invoices_total) - safeNum(x.payments_total),
      }));

      result.sort((a, b) => safeNum(b.debt) - safeNum(a.debt));
      setDebts(result);
    } catch (e) {
      console.error(e);
      alert("تعذر تحميل ديون العملاء (تأكد من RLS والجداول)");
    } finally {
      setDebtsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (tab === "debts") loadDebts();
  }, [tab]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: ["opening_balance", "price_per_gb", "last_reading_gb", "discount_percent"].includes(
        name
      )
        ? Number(value || 0)
        : value,
    }));
  };

  const startAdd = () => {
    setForm(empty);
    setShowForm(true);
  };

  const startEdit = (r) => {
    setForm({
      id: r.id,
      name: r.name || "",
      type: r.type || "cards",
      phone: r.phone || "",
      address: r.address || "",
      notes: r.notes || "",
      opening_balance: Number(r.opening_balance || 0),
      price_per_gb: Number(r.price_per_gb || 0),
      last_reading_gb: Number(r.last_reading_gb || 0),
      discount_percent: Number(r.discount_percent || 0),
    });
    setShowForm(true);
  };

  const save = async () => {
    if (saving) return;
    if (!form.name.trim()) {
      alert("اكتب اسم العميل");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        phone: (form.phone || "").trim(),
        address: (form.address || "").trim(),
        notes: (form.notes || "").trim(),
        opening_balance: Number(form.opening_balance || 0),
        price_per_gb: form.type === "giga" ? Number(form.price_per_gb || 0) : 0,
        last_reading_gb: form.type === "giga" ? Number(form.last_reading_gb || 0) : 0,
        discount_percent: Number(form.discount_percent || 0),
      };

      if (form.id) {
        const { error } = await supabase.from("customers").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert(payload);
        if (error) throw error;
      }

      await load();
      if (tab === "debts") await loadDebts();

      setForm(empty);
      setShowForm(false);
      alert("تم حفظ العميل");
    } catch (e) {
      console.error(e);
      alert("فشل الحفظ (تأكد من Supabase و RLS)");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("حذف العميل؟")) return;
    try {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
      await load();
      if (tab === "debts") await loadDebts();
    } catch (e) {
      console.error(e);
      alert("تعذر الحذف (قد يكون عليه حركات لاحقًا)");
    }
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* Top bar */}
      <div className="card">
        <div className="row" style={{ alignItems: "flex-end", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className={tab === "customers" ? "btn-primary" : "btn"}
              onClick={() => setTab("customers")}
            >
              العملاء
            </button>
            <button
              className={tab === "debts" ? "btn-primary" : "btn"}
              onClick={() => setTab("debts")}
            >
              ديون العملاء
            </button>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            {tab === "customers" ? (
              <>
                <div className="col">
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>بحث</label>
                  <input
                    className="input"
                    placeholder="ابحث بالاسم أو الهاتف..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <button className="btn" onClick={load} disabled={loading}>
                  {loading ? "تحميل..." : "تحديث"}
                </button>
                <button className="btn-primary" onClick={startAdd}>
                  + عميل جديد
                </button>
              </>
            ) : (
              <>
                <div className="col">
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>بحث</label>
                  <input
                    className="input"
                    placeholder="ابحث باسم العميل..."
                    value={debtsQ}
                    onChange={(e) => setDebtsQ(e.target.value)}
                  />
                </div>
                <button className="btn" onClick={loadDebts} disabled={debtsLoading}>
                  {debtsLoading ? "تحميل..." : "تحديث"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Form (hidden until startAdd/startEdit) */}
      {showForm && (
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div className="badge">نموذج العميل</div>
            {form.id ? <span className="badge">تعديل #{form.id}</span> : <span className="badge">إضافة</span>}
          </div>

          <div className="row">
            <div className="col">
              <label style={{ fontSize: 12, color: "var(--muted)" }}>اسم العميل *</label>
              <input className="input" name="name" value={form.name} onChange={onChange} />
            </div>

            <div className="col" style={{ flex: "0 0 220px" }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>نوع العميل</label>
              <select className="input" name="type" value={form.type} onChange={onChange}>
                <option value="cards">كروت</option>
                <option value="giga">جيجا (Metered)</option>
              </select>
            </div>

            <div className="col" style={{ flex: "0 0 220px" }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>دين/رصيد افتتاحي</label>
              <input
                className="input"
                type="number"
                name="opening_balance"
                value={form.opening_balance}
                onChange={onChange}
              />
            </div>

            <div className="col" style={{ flex: "0 0 220px" }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>نسبة خصم افتراضية (%)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                name="discount_percent"
                value={form.discount_percent}
                onChange={onChange}
              />
            </div>
          </div>

          <div className="row">
            <div className="col">
              <label style={{ fontSize: 12, color: "var(--muted)" }}>الهاتف</label>
              <input className="input" name="phone" value={form.phone} onChange={onChange} />
            </div>
            <div className="col">
              <label style={{ fontSize: 12, color: "var(--muted)" }}>العنوان</label>
              <input className="input" name="address" value={form.address} onChange={onChange} />
            </div>
          </div>

          {form.type === "giga" && (
            <div className="row">
              <div className="col" style={{ flex: "0 0 220px" }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>سعر الجيجا</label>
                <input
                  className="input"
                  type="number"
                  name="price_per_gb"
                  value={form.price_per_gb}
                  onChange={onChange}
                />
              </div>
              <div className="col" style={{ flex: "0 0 220px" }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>آخر قراءة (GB)</label>
                <input
                  className="input"
                  type="number"
                  name="last_reading_gb"
                  value={form.last_reading_gb}
                  onChange={onChange}
                />
              </div>
            </div>
          )}

          <div className="row">
            <div className="col">
              <label style={{ fontSize: 12, color: "var(--muted)" }}>ملاحظات</label>
              <textarea className="input" name="notes" value={form.notes} onChange={onChange} rows={2} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-start" }}>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "حفظ..." : "حفظ"}
            </button>

            <button
              className="btn"
              onClick={() => {
                setForm(empty);
                setShowForm(false);
              }}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {tab === "customers" ? (
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div className="badge">قائمة العملاء</div>
            <div className="badge">{filtered.length} عميل</div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الاسم</th>
                  <th>النوع</th>
                  <th>الهاتف</th>
                  <th>افتتاحي</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.name}</td>
                    <td>{r.type === "giga" ? "جيجا" : "كروت"}</td>
                    <td>{r.phone || "-"}</td>
                    <td>{safeNum(r.opening_balance).toFixed(2)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn" onClick={() => startEdit(r)}>
                        تعديل
                      </button>
                      <button className="btn-primary danger" onClick={() => remove(r.id)}>
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--muted)" }}>
                      لا توجد بيانات
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div className="badge">ديون العملاء</div>
            <div className="badge">{filteredDebts.length} عميل عليه دين</div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>العميل</th>
                  <th>الدين (إجمالي)</th>
                  <th>افتتاحي</th>
                  <th>فواتير</th>
                  <th>سداد</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredDebts.map((d) => (
                  <tr key={d.id}>
                    <td>{d.id}</td>
                    <td>{d.name}</td>
                    <td style={{ fontWeight: 700 }}>{safeNum(d.debt).toFixed(2)}</td>
                    <td>{safeNum(d.opening_balance).toFixed(2)}</td>
                    <td>{safeNum(d.invoices_total).toFixed(2)}</td>
                    <td>{safeNum(d.payments_total).toFixed(2)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn"
                        onClick={() => {
                          const r = rows.find((x) => x.id === d.id);
                          if (r) startEdit(r);
                          else alert("افتح تبويب العملاء ثم ابحث عنه");
                        }}
                      >
                        عرض
                      </button>
                      <button
                        className="btn-primary"
                        onClick={() => payOpeningBalance({ id: d.id, opening_balance: d.opening_balance }, async () => {
                          await load();
                          await loadDebts();
                        })}
                      >
                        سداد افتتاحي
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredDebts.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--muted)" }}>
                      لا يوجد عملاء عليهم ديون حالياً
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 12 }}>
            ملاحظة: إذا كان عندك View باسم <b>v_customer_debt_snapshot</b> سيتم استخدامه مباشرة. إذا غير موجود، سيتم حساب
            الدين من customers + invoices + payments.
          </div>
        </div>
      )}
    </div>
  );
}
