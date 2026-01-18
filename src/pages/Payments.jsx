import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

import { currentUser } from "../lib/auth";
// ===== Helpers =====
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => safeNum(v).toFixed(2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

function uiPayType(amount) {
  const a = safeNum(amount);
  return a < 0 ? { key: "out", ar: "صرف" } : { key: "in", ar: "قبض" };
}



async function syncInvoicePayments(invoiceId) {
  const iid = Number(invoiceId || 0);
  if (!iid) return;

  // احسب مجموع السداد على هذه الفاتورة
  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("id,paid_amount,remaining_amount")
    .eq("id", iid)
    .maybeSingle();
  if (invErr || !inv) return;

  const { data: pays, error: payErr } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", iid);
  if (payErr) return;

  const paid = Math.max(0, (pays || []).reduce((s, p) => s + safeNum(p.amount), 0));
  const total = safeNum(inv.paid_amount) + safeNum(inv.remaining_amount);
  const remaining = Math.max(0, total - paid);
  const status = remaining <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";

  await supabase
    .from("invoices")
    .update({ paid_amount: paid, remaining_amount: remaining, status })
    .eq("id", iid);
}

export default function Payments() {
  const me = currentUser?.() || null;
  const role = String(me?.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "owner" || role === "superadmin";
  // أي حساب غير Admin نعتبره "حساب بائع" (عرض محدود على السندات الخاصة به فقط).
  const isSeller = !isAdmin;
  // أي حساب غير Admin نعتبره "حساب بائع" (عرض محدود).

  const [authUserId, setAuthUserId] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setAuthUserId(data?.user?.id || null);
      setAuthReady(true);
    }).catch(() => {
      if (!alive) return;
      setAuthUserId(null);
      setAuthReady(true);
    });
    return () => { alive = false; };
  }, []);

  // تحميل السندات حسب الفلاتر + حسب دور المستخدم

  // ====== data ======
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);

  // filters
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [method, setMethod] = useState("all"); // all | cash | bank | other
  const [customerId, setCustomerId] = useState("all");

  // تحميل السندات حسب الفلاتر + حسب دور المستخدم
  useEffect(() => {
    if (!authReady) return;
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, authUserId, from, to, method, customerId, q, isSeller, isAdmin]);


  // modal
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);

  // form
  const [fCustomerId, setFCustomerId] = useState("");
  const [fInvoiceId, setFInvoiceId] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fMethod, setFMethod] = useState("cash"); // cash | bank | other
  const [fNote, setFNote] = useState("");
  const [fCreatedAt, setFCreatedAt] = useState(nowISO());

  // autocomplete (modal)
  const [custSearch, setCustSearch] = useState("");
  const [invSearch, setInvSearch] = useState("");
  const [showCustDD, setShowCustDD] = useState(false);
  const [showInvDD, setShowInvDD] = useState(false);

  // ====== load ======
  async function loadCustomers() {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name")
      .order("name", { ascending: true });
    if (error) throw error;
    setCustomers(data || []);
  }

  // نحاول View أولاً (v_invoices) ثم fallback للجدول invoices
  async function loadInvoices() {
    try {
      // 1) view
      let q = supabase
        .from("v_invoices")
        .select("id,number,customer_id,invoice_date,remaining_amount,total_after_discount,paid_amount")
        .order("invoice_date", { ascending: true })
        .limit(2000);

      const { data: vData, error: vErr } = await q;
      if (!vErr && Array.isArray(vData)) {
        setInvoices(
          vData.map((r) => ({
            ...r,
            total_after_discount: r.total_after_discount ?? 0,
            paid_amount: r.paid_amount ?? 0,
            remaining_amount: r.remaining_amount ?? 0,
          }))
        );
        return;
      }
    } catch (e) {
      // ignore, fallback below
      console.warn("v_invoices load failed, fallback to invoices:", e);
    }

    // 2) fallback table (نختار أعمدة آمنة فقط لتجنب 400)
    // بعض النسخ قد لا تحتوي total_after_discount في الجدول، لذلك نحاول 2 توقيعات
    const try1 = await supabase
      .from("invoices")
      .select("id,number,customer_id,invoice_date,remaining_amount,total_after_discount,paid_amount")
      .order("invoice_date", { ascending: true })
      .limit(2000);

    if (!try1.error) {
      setInvoices(
        (try1.data || []).map((r) => ({
          ...r,
          total_after_discount: r.total_after_discount ?? 0,
          paid_amount: r.paid_amount ?? 0,
          remaining_amount: r.remaining_amount ?? 0,
        }))
      );
      return;
    }

    // محاولة 2: بدون total_after_discount (لو غير موجود)
    const try2 = await supabase
      .from("invoices")
      .select("id,number,customer_id,invoice_date,remaining_amount,total_before_discount,paid_amount")
      .order("invoice_date", { ascending: true })
      .limit(2000);

    if (try2.error) throw try2.error;

    setInvoices(
      (try2.data || []).map((r) => ({
        ...r,
        total_after_discount: r.total_after_discount ?? r.total_before_discount ?? 0,
        paid_amount: r.paid_amount ?? 0,
        remaining_amount: r.remaining_amount ?? 0,
      }))
    );
  }


  async function loadPayments() {
    setLoading(true);
    try {
      // (to is inclusive) => add 1 day for < nextDay
      const dTo = new Date(to);
      dTo.setDate(dTo.getDate() + 1);
      const toPlus1 = dTo.toISOString().slice(0, 10);

      // ✅ لا يوجد عمود number في جدول payments عندك
      let q = supabase
        .from("payments")
        .select("id,customer_id,invoice_id,amount,method,note,created_at,seller_user_id")
        .gte("created_at", from)
        .lt("created_at", toPlus1);

      if (method && method !== "all") q = q.eq("method", method);
      if (customerId && customerId !== "all") q = q.eq("customer_id", Number(customerId));
      if (isSeller && authUserId) q = q.eq("seller_user_id", authUserId);

      const { data, error } = await q.order("created_at", { ascending: false });

      if (error) throw error;
      setRows(data || []);
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadCustomers();
        await loadInvoices();
      } catch (e) {
        console.error(e);
        alert(e?.message || "فشل تحميل السندات");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // تحميل السندات حسب الفلاتر (ويُعاد التحميل عند تغيير الفترة/الفلاتر أو عند جاهزية بيانات المستخدم)
  useEffect(() => {
    if (!authReady) return;
    loadPayments().catch((e) => {
      console.error(e);
      alert(e?.message || "فشل تحميل السندات");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, authUserId, from, to, method, customerId, q, isSeller, isAdmin]);

  // ====== computed ======
  const custMap = useMemo(() => {
    const m = new Map();
    customers.forEach((c) => m.set(c.id, c));
    return m;
  }, [customers]);

  const invMap = useMemo(() => {
    const m = new Map();
    invoices.forEach((i) => m.set(i.id, i));
    return m;
  }, [invoices]);

  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (customerId !== "all" && String(r.customer_id) !== String(customerId)) return false;
      if (method !== "all" && String(r.method || "") !== method) return false;

      if (!s) return true;

      const cn = (custMap.get(r.customer_id)?.name || "").toLowerCase();
      const invObj = r.invoice_id ? invMap.get(r.invoice_id) : null;
      const invNo = String(invObj?.number || "").toLowerCase();
      const invId = String(r.invoice_id || "").toLowerCase();
      const id = String(r.id || "").toLowerCase();
      const note = String(r.note || "").toLowerCase();

      return cn.includes(s) || invNo.includes(s) || invId.includes(s) || id.includes(s) || note.includes(s);
    });
  }, [rows, q, customerId, method, custMap, invMap]);

  const totals = useMemo(() => {
    let inSum = 0,
      outSum = 0;
    for (const r of filtered) {
      const a = safeNum(r.amount);
      if (a >= 0) inSum += a;
      else outSum += Math.abs(a);
    }
    return { inSum, outSum, net: inSum - outSum };
  }, [filtered]);

  // ====== modal helpers ======
  function resetForm() {
    setEditId(null);
    setFCustomerId("");
    setFInvoiceId("");
    setFAmount("");
    setFMethod("cash");
    setFNote("");
    setFCreatedAt(nowISO());

    setCustSearch("");
    setInvSearch("");
    setShowCustDD(false);
    setShowInvDD(false);
  }

  function openNew() {
    resetForm();
    setOpen(true);
  }

  function openEdit(row) {
    setEditId(row.id);

    const custName = custMap.get(row.customer_id)?.name || "";
    setFCustomerId(row.customer_id || "");
    setCustSearch(custName);

    const invObj = row.invoice_id ? invMap.get(row.invoice_id) : null;
    setFInvoiceId(row.invoice_id || "");
    setInvSearch(invObj?.number ? String(invObj.number) : "");

    setFAmount(String(row.amount ?? ""));
    setFMethod(row.method || "cash");
    setFNote(row.note || "");
    setFCreatedAt(row.created_at || nowISO());

    setOpen(true);
  }

  
async function savePayment(e) {
  if (e && typeof e.preventDefault === "function") e.preventDefault();
  try {
    setSaving(true);

    const cid = Number(fCustomerId || 0) || null;
    const iid = Number(fInvoiceId || 0) || null;

    if (!cid) throw new Error("اختر العميل أولاً");
    const amt = safeNum(fAmount);
    if (!Number.isFinite(amt) || amt === 0) throw new Error("أدخل مبلغ صحيح (لا يكون صفر)");

    // لو تعديل: نحتاج نعرف invoice_id السابق حتى نعمل sync للفواتير
    const prev = editId ? (rows || []).find((r) => Number(r.id) === Number(editId)) : null;
    const prevInvoiceId = Number(prev?.invoice_id || 0) || null;

    // ✅ قفل يمنع السداد الزائد عن الفاتورة (عند الربط بفاتورة فقط)
    if (iid) {
      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .select("id,paid_amount,remaining_amount")
        .eq("id", iid)
        .maybeSingle();
      if (invErr || !inv) throw new Error("لم يتم العثور على الفاتورة المختارة");

      const { data: pays, error: payErr } = await supabase
        .from("payments")
        .select("id,amount")
        .eq("invoice_id", iid);
      if (payErr) throw payErr;

      const paidOther = (pays || [])
        .filter((p) => Number(p.id) !== Number(editId || 0))
        .reduce((s, p) => s + safeNum(p.amount), 0);

      const total = safeNum(inv.paid_amount) + safeNum(inv.remaining_amount);
      const newPaid = paidOther + amt;

      // نمنع فقط تجاوز الإجمالي (نسمح بالمرتجع/الصرف لو كان سالب)
      if (newPaid > total + 0.0001) {
        throw new Error(
          `لا يمكن: السداد سيصبح (${money(newPaid)}) وهو أكبر من إجمالي الفاتورة (${money(total)})`
        );
      }
    }

    const payload = {
      customer_id: cid,
      invoice_id: iid || null,
amount: amt,
      method: String(fMethod || ""),
      note: String(fNote || ""),
      created_at: fCreatedAt || new Date().toISOString(),
      ...(isSeller && authUserId ? { seller_user_id: authUserId } : {}),
    };

    let res;
    if (editId) {
      res = await supabase
        .from("payments")
        .update(payload)
        .eq("id", editId)
        .select()
        .maybeSingle();
    } else {
      res = await supabase.from("payments").insert(payload).select().maybeSingle();
    }
    if (res.error) throw res.error;

    // تحديث حالة الفاتورة (إذا كان السند مربوط بفاتورة)
    if (prevInvoiceId) await syncInvoicePayments(prevInvoiceId);
    if (iid && iid !== prevInvoiceId) await syncInvoicePayments(iid);

    await loadPayments();
    setOpen(false);
    setEditId(null);
  } catch (e2) {
    console.error(e2);
    alert(e2?.message || String(e2));
  } finally {
    setSaving(false);
  }
}


async function deletePayment(id) {
  const ok = confirm("حذف السند؟");
  if (!ok) return;
  try {
    setLoading(true);

    const row = (rows || []).find((r) => Number(r.id) === Number(id));
    const invId = Number(row?.invoice_id || 0) || null;

    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) throw error;

    if (invId) await syncInvoicePayments(invId);

    await loadPayments();
  } catch (e) {
    console.error(e);
    alert(e?.message || "فشل حذف السند");
  } finally {
    setLoading(false);
  }
}


  // ====== dropdown helpers ======
  const custOptions = useMemo(() => {
    const s = custSearch.trim().toLowerCase();
    if (!s) return [];
    return customers
      .filter((c) => (c.name || "").toLowerCase().includes(s))
      .slice(0, 8);
  }, [custSearch, customers]);

  const invOptions = useMemo(() => {
    const s = invSearch.trim().toLowerCase();

    // لو تم اختيار عميل: اعرض فواتير العميل (حتى لو بدون بحث)
    let base = invoices;
    if (fCustomerId) {
      base = base.filter((i) => String(i.customer_id) === String(fCustomerId));
    }

    // يقبل كتابة رقم الفاتورة أو جزء منه
    if (s) {
      base = base.filter((i) => String(i.number || "").toLowerCase().includes(s));
    }

    return (base || []).slice(0, 8);
  }, [invSearch, invoices, fCustomerId]);

  // ====== UI ======
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="badge">السندات / السداد</div>
          <h2 style={{ margin: "8px 0 0" }}>سجل السندات</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            القبض = مبلغ موجب ✅ — الصرف/المرتجع = مبلغ سالب ✅
          </div>
        </div>

        <div className="actions-row no-print">
          <button className="btn" onClick={openNew}>
            + سند جديد
          </button>
          <button className="btn btn-outline" onClick={loadPayments} disabled={loading}>
            تحديث
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="grid4">
          <label>
            من
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            إلى
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            طريقة الدفع
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="all">الكل</option>
              <option value="cash">نقدي</option>
              <option value="bank">تحويل</option>
              <option value="other">أخرى</option>
            </select>
          </label>
          <label>
            العميل
            <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="all">الكل</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid2" style={{ marginTop: 10 }}>
          <label>
            بحث
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="اسم العميل / رقم السند (ID) / رقم الفاتورة / ملاحظة"
            />
          </label>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", justifyContent: "flex-end" }}>
            <div className="mini-card">
              <div className="mini-title">إجمالي قبض</div>
              <div className="mini-value">{money(totals.inSum)}</div>
            </div>
            <div className="mini-card">
              <div className="mini-title">إجمالي صرف</div>
              <div className="mini-value">{money(totals.outSum)}</div>
            </div>
            <div className="mini-card">
              <div className="mini-title">الصافي</div>
              <div className="mini-value">{money(totals.net)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>#</th><th>التاريخ</th><th>النوع</th><th>العميل</th><th>فاتورة</th><th>طريقة</th><th>المبلغ</th><th>ملاحظة</th><th className="no-print">إجراءات</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
                    لا توجد سندات
                  </td></tr>
              ) : (
                filtered.map((r, idx) => {
                  const t = uiPayType(r.amount);
                  const cn = custMap.get(r.customer_id)?.name || "-";
                  const invObj = r.invoice_id ? invMap.get(r.invoice_id) : null;
                  const invLabel = invObj?.number ? String(invObj.number) : (r.invoice_id ? String(r.invoice_id).slice(0, 8) : "-");

                  return (
                    <tr key={r.id}><td>{idx + 1}</td><td>{new Date(r.created_at || Date.now()).toLocaleString("ar-EG")}</td><td>
                        <span className={"pill " + (t.key === "in" ? "pill-in" : "pill-out")}>{t.ar}</span>
                      </td><td>{cn}</td><td>{invLabel}</td><td>{r.method || "-"}</td><td style={{ fontWeight: 800 }}>{money(Math.abs(r.amount))}</td><td style={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.note || "-"}
                      </td><td className="no-print" style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-outline" onClick={() => openEdit(r)}>
                          تعديل
                        </button>
                        <button className="btn btn-danger" onClick={() => deletePayment(r.id)}>
                          حذف
                        </button>
                      </td></tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          {/* نفس مودال الفواتير: نثبت الحجم ونجعله بوسط الشاشة */}
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(760px, 94vw)",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <div className="modal-head">
              <div>
                <div className="badge">{editId ? "تعديل سند" : "سند جديد"}</div>
                <h3 style={{ margin: "6px 0 0" }}>بيانات السند</h3>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={savePayment}>
              <div className="grid2">
                {/* العميل - بحث تلقائي */}
                <div style={{ position: "relative" }}>
                  <label>
                    العميل
                    <input
                      className="input"
                      value={custSearch}
                      onChange={(e) => {
                        setCustSearch(e.target.value);
                        setShowCustDD(true);
                        // لو المستخدم عدّل النص بعد اختيار عميل → نفرغ id حتى يختار من القائمة
                        setFCustomerId("");
                      }}
                      onFocus={() => setShowCustDD(true)}
                      onBlur={() => setTimeout(() => setShowCustDD(false), 160)}
                      placeholder="اكتب حرف… وسيظهر العميل"
                    />
                  </label>

                  {showCustDD && custOptions.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        left: 0,
                        marginTop: 6,
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        overflow: "hidden",
                        zIndex: 50,
                        boxShadow: "0 20px 60px rgba(0,0,0,.35)",
                      }}
                    >
                      {custOptions.map((c) => (
                        <div
                          key={c.id}
                          onMouseDown={() => {
                            setFCustomerId(c.id);
                            setCustSearch(c.name);
                            setShowCustDD(false);
                          }}
                          style={{
                            padding: "10px 12px",
                            cursor: "pointer",
                            borderBottom: "1px solid rgba(255,255,255,.06)",
                          }}
                        >
                          {c.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* رقم الفاتورة - بحث تلقائي من سجل الفواتير */}
                <div style={{ position: "relative" }}>
                  <label>
                    رقم الفاتورة (اختياري)
                    <input
                      className="input"
                      value={invSearch}
                      onChange={(e) => {
                        setInvSearch(e.target.value);
                        setShowInvDD(true);
                        setFInvoiceId(""); // نفرغ حتى يختار فاتورة صحيحة
                      }}
                      onFocus={() => setShowInvDD(true)}
                      onBlur={() => setTimeout(() => setShowInvDD(false), 160)}
                      placeholder="اكتب رقم الفاتورة…"
                    />
                  </label>

                  {showInvDD && invOptions.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        left: 0,
                        marginTop: 6,
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        overflow: "hidden",
                        zIndex: 50,
                        boxShadow: "0 20px 60px rgba(0,0,0,.35)",
                      }}
                    >
                      {invOptions.map((i) => (
                        <div
                          key={i.id}
                          onMouseDown={() => {
                            setFInvoiceId(i.id);
                            setInvSearch(String(i.number || ""));
                            setShowInvDD(false);
                            // لو العميل غير مختار، نملأه تلقائياً من الفاتورة (اختياري)
                            if (!fCustomerId && i.customer_id) {
                              const nm = custMap.get(i.customer_id)?.name || "";
                              setFCustomerId(i.customer_id);
                              if (nm) setCustSearch(nm);
                            }
                          }}
                          style={{
                            padding: "10px 12px",
                            cursor: "pointer",
                            borderBottom: "1px solid rgba(255,255,255,.06)",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                          }}
                        >
                          <span>فاتورة #{String(i.number || "")}</span>
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>
                            {String(i.id).slice(0, 8)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <label>
                  طريقة الدفع
                  <select className="input" value={fMethod} onChange={(e) => setFMethod(e.target.value)}>
                    <option value="cash">نقدي</option>
                    <option value="bank">تحويل</option>
                    <option value="other">أخرى</option>
                  </select>
                </label>

                <label>
                  التاريخ/الوقت
                  <input
                    className="input"
                    type="datetime-local"
                    value={(fCreatedAt || "").slice(0, 16)}
                    onChange={(e) => setFCreatedAt(new Date(e.target.value).toISOString())}
                  />
                </label>

                <label>
                  المبلغ (موجب قبض / سالب صرف)
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={fAmount}
                    onChange={(e) => setFAmount(e.target.value)}
                  />
                </label>

                <label>
                  ملاحظة
                  <input className="input" value={fNote} onChange={(e) => setFNote(e.target.value)} placeholder="اختياري" />
                </label>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                  إلغاء
                </button>
                <button className="btn" type="submit" disabled={saving}>
                  {saving ? "جارٍ الحفظ..." : "حفظ"}
                </button>
              </div>

              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
                ملاحظة: السندات المرتبطة بالفواتير يتم إنشاؤها من شاشة الفواتير تلقائياً.
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
