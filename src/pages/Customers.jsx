import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

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
};

async function payOpeningBalance(c){
  const current = safeNum(c?.opening_balance);
  if(current <= 0) return alert("لا يوجد دين افتتاحي على هذا العميل");
  const s = prompt(`أدخل مبلغ السداد للدين الافتتاحي (المتبقي: ${current})`, String(current));
  if(s === null) return;
  const amt = safeNum(s);
  if(amt <= 0) return alert("المبلغ غير صحيح");
  const method = prompt("طريقة السداد؟ اكتب: cash أو bank أو other", "cash") || "cash";
  const pay_date = new Date().toISOString().slice(0,10);
  // 1) insert payment بدون فاتورة
  const { error: e1 } = await supabase.from("payments").insert([{
    customer_id: c.id,
    invoice_id: null,
    pay_date,
    amount: amt,
    method,
    note: "سداد دين افتتاحي",
  }]);
  if(e1) return alert(e1.message || "فشل حفظ السداد");
  // 2) تحديث الدين الافتتاحي (نخصم منه)
  const newBal = Math.max(0, current - amt);
  const { error: e2 } = await supabase.from("customers").update({ opening_balance: newBal }).eq("id", c.id);
  if(e2) return alert(e2.message || "فشل تحديث رصيد الدين الافتتاحي");
  alert("تم السداد بنجاح");
  await refresh();
}

export default function Customers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r && // تأكد من أن الصف (r) موجود
        ((r.name || "").toLowerCase().includes(s) ||
          (r.phone || "").toLowerCase().includes(s))
    );
  }, [rows, q]);

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

  useEffect(() => {
    load();
  }, []);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: ["opening_balance", "price_per_gb", "last_reading_gb"].includes(
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
        phone: form.phone.trim(),
        address: form.address.trim(),
        notes: form.notes.trim(),
        opening_balance: Number(form.opening_balance || 0),
        price_per_gb: form.type === "giga" ? Number(form.price_per_gb || 0) : 0,
        last_reading_gb:
          form.type === "giga" ? Number(form.last_reading_gb || 0) : 0,
      };

      if (form.id) {
        const { error } = await supabase
          .from("customers")
          .update(payload)
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert(payload);
        if (error) throw error;
      }

      await load();
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
    } catch (e) {
      console.error(e);
      alert("تعذر الحذف (قد يكون عليه حركات لاحقًا)");
    }
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* Top bar */}
      <div className="card">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="col">
            <label style={{ fontSize: 12, color: "var(--muted)" }}>بحث</label>
            <input
              className="input"
              placeholder="ابحث بالاسم أو الهاتف..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={load} disabled={loading}>
              {loading ? "تحميل..." : "تحديث"}
            </button>
            <button className="btn-primary" onClick={startAdd}>
              + عميل جديد
            </button>
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
            {form.id ? (
              <span className="badge">تعديل #{form.id}</span>
            ) : (
              <span className="badge">إضافة</span>
            )}
          </div>

          <div className="row">
            <div className="col">
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                اسم العميل *
              </label>
              <input
                className="input"
                name="name"
                value={form.name}
                onChange={onChange}
              />
            </div>

            <div className="col" style={{ flex: "0 0 220px" }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                نوع العميل
              </label>
              <select
                className="input"
                name="type"
                value={form.type}
                onChange={onChange}
              >
                <option value="cards">كروت</option>
                <option value="giga">جيجا (Metered)</option>
              </select>
            </div>

            <div className="col" style={{ flex: "0 0 220px" }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                دين/رصيد افتتاحي
              </label>
              <input
                className="input"
                type="number"
                name="opening_balance"
                value={form.opening_balance}
                onChange={onChange}
              />
            </div>
          </div>

          <div className="row">
            <div className="col">
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                الهاتف
              </label>
              <input
                className="input"
                name="phone"
                value={form.phone}
                onChange={onChange}
              />
            </div>
            <div className="col">
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                العنوان
              </label>
              <input
                className="input"
                name="address"
                value={form.address}
                onChange={onChange}
              />
            </div>
          </div>

          {form.type === "giga" && (
            <div className="row">
              <div className="col" style={{ flex: "0 0 220px" }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>
                  سعر الجيجا
                </label>
                <input
                  className="input"
                  type="number"
                  name="price_per_gb"
                  value={form.price_per_gb}
                  onChange={onChange}
                />
              </div>
              <div className="col" style={{ flex: "0 0 220px" }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>
                  آخر قراءة (GB)
                </label>
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
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                ملاحظات
              </label>
              <textarea
                className="input"
                name="notes"
                value={form.notes}
                onChange={onChange}
                rows={2}
              />
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

      {/* List */}
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
                  <td>{Number(r.opening_balance || 0).toFixed(2)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn" onClick={() => startEdit(r)}>
                      تعديل
                    </button>{" "}
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
    </div>
  );
}
