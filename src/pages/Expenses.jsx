import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ===== Helpers =====
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => safeNum(v).toFixed(2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

function dirUi(direction) {
  return String(direction) === "income"
    ? { ar: "دخل", cls: "pill-in" }
    : { ar: "مصروف", cls: "pill-out" };
}

function toDateOnly(isoOrDateLike) {
  try {
    if (!isoOrDateLike) return todayISO();
    if (String(isoOrDateLike).length === 10) return String(isoOrDateLike);
    return new Date(isoOrDateLike).toISOString().slice(0, 10);
  } catch {
    return todayISO();
  }
}

export default function Expenses() {
  // ===== data =====
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  // filters
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [direction, setDirection] = useState("all"); // all | expense | income
  const [method, setMethod] = useState("all"); // all | cash | bank | other

  // toast
  const [toast, setToast] = useState("");

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 1800);
  }

  // modal
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);

  // form (matching your table)
  const [fDirection, setFDirection] = useState("expense"); // expense | income
  const [fExpenseDate, setFExpenseDate] = useState(todayISO()); // date
  const [fCategory, setFCategory] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fMethod, setFMethod] = useState("cash");
  const [fNote, setFNote] = useState("");
  const [fCreatedAt, setFCreatedAt] = useState(nowISO()); // timestamp

  // ===== load =====
  async function loadRows() {
    setLoading(true);
    try {
      // filter using expense_date (date column)
      const { data, error } = await supabase
        .from("expenses")
        .select("id,expense_date,category,amount,direction,method,note,created_at")
        .gte("expense_date", from)
        .lte("expense_date", to)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      console.error(e);
      alert(e?.message || "فشل تحميل المصروفات/الدخل");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== computed =====
  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();

    return (rows || []).filter((r) => {
      if (direction !== "all" && String(r.direction || "") !== direction) return false;
      if (method !== "all" && String(r.method || "") !== method) return false;

      if (!s) return true;
      const cat = String(r.category || "").toLowerCase();
      const note = String(r.note || "").toLowerCase();
      const id = String(r.id || "").toLowerCase();
      return cat.includes(s) || note.includes(s) || id.includes(s);
    });
  }, [rows, q, direction, method]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    let incomeCash = 0;
    let expenseCash = 0;

    for (const r of filtered) {
      const amt = safeNum(r.amount);
      const isCash = String(r.method || "") === "cash";

      if (String(r.direction) === "income") {
        income += amt;
        if (isCash) incomeCash += amt;
      } else {
        expense += amt;
        if (isCash) expenseCash += amt;
      }
    }

    return {
      income,
      expense,
      net: income - expense,
      cashNet: incomeCash - expenseCash,
    };
  }, [filtered]);

  // ===== modal helpers =====
  function resetForm() {
    setEditId(null);
    setFDirection("expense");
    setFExpenseDate(todayISO());
    setFCategory("");
    setFAmount("");
    setFMethod("cash");
    setFNote("");
    setFCreatedAt(nowISO());
  }

  function openNew(dir = "expense") {
    resetForm();
    setFDirection(dir);
    setOpen(true);
  }

  function openEdit(r) {
    setEditId(r.id);
    setFDirection(r.direction || "expense");
    setFExpenseDate(toDateOnly(r.expense_date));
    setFCategory(r.category || "");
    setFAmount(String(r.amount ?? ""));
    setFMethod(r.method || "cash");
    setFNote(r.note || "");
    setFCreatedAt(r.created_at || nowISO());
    setOpen(true);
  }

  async function saveRow(e) {
    e?.preventDefault?.();

    const amt = safeNum(fAmount);
    if (!String(fCategory || "").trim()) return alert("اكتب بند/نوع (مثلاً: راتب، كهرباء، إيجار…)");
    if (!Number.isFinite(amt) || amt <= 0) return alert("اكتب مبلغ صحيح (أكبر من صفر)");
    if (!fExpenseDate) return alert("اختر تاريخ");

    setSaving(true);
    try {
      const payload = {
        expense_date: fExpenseDate, // ✅ date
        category: String(fCategory).trim(),
        amount: amt, // نخزنه موجب
        direction: fDirection, // expense / income
        method: fMethod, // cash/bank/other
        note: fNote || null,
        created_at: fCreatedAt || nowISO(), // timestamp
      };

      if (editId) {
        const { error } = await supabase.from("expenses").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("expenses").insert(payload);
        if (error) throw error;
      }

      setOpen(false);
      resetForm();
      await loadRows();
      showToast("✅ تم الحفظ");
    } catch (e2) {
      console.error(e2);
      alert(e2?.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  }

  async function delRow(id) {
    const ok = confirm("حذف السجل؟");
    if (!ok) return;

    try {
      setLoading(true);
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) throw error;
      await loadRows();
      showToast("🗑️ تم الحذف");
    } catch (e) {
      console.error(e);
      alert(e?.message || "فشل الحذف");
    } finally {
      setLoading(false);
    }
  }

  // ===== UI =====
  return (
    <div className="page">
      {toast && <div className="toast">{toast}</div>}

      <div className="page-head">
        <div>
          <div className="badge">المصروفات والدخل</div>
          <h2 style={{ margin: "8px 0 0" }}>سجل المصروفات والدخل</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            الصافي = الدخل − المصروف | صافي الكاش = دخل نقدي − مصروف نقدي
          </div>
        </div>

        <div className="actions-row no-print">
          <button className="btn" onClick={() => openNew("expense")}>+ مصروف</button>
          <button className="btn btn-outline" onClick={() => openNew("income")}>+ دخل</button>
          <button className="btn btn-outline" onClick={loadRows} disabled={loading}>تحديث</button>
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
            النوع
            <select className="input" value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="all">الكل</option>
              <option value="expense">مصروف</option>
              <option value="income">دخل</option>
            </select>
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
        </div>

        <div className="grid2" style={{ marginTop: 10 }}>
          <label>
            بحث
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="البند (راتب.. كهرباء..) أو ملاحظة أو ID"
              />
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setQ("")}
                style={{ whiteSpace: "nowrap" }}
              >
                مسح
              </button>
            </div>
          </label>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", justifyContent: "flex-end" }}>
            <div className="mini-card">
              <div className="mini-title">إجمالي دخل</div>
              <div className="mini-value">{money(totals.income)}</div>
            </div>
            <div className="mini-card">
              <div className="mini-title">إجمالي مصروف</div>
              <div className="mini-value">{money(totals.expense)}</div>
            </div>
            <div className="mini-card">
              <div className="mini-title">الصافي</div>
              <div className="mini-value">{money(totals.net)}</div>
            </div>
            <div className="mini-card">
              <div className="mini-title">صافي الكاش</div>
              <div className="mini-value">{money(totals.cashNet)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>البند</th>
                <th>طريقة</th>
                <th>المبلغ</th>
                <th>ملاحظة</th>
                <th className="no-print">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)" }}>
                    لا توجد بيانات
                  </td>
                </tr>
              ) : (
                filtered.map((r, idx) => {
                  const t = dirUi(r.direction);
                  return (
                    <tr key={r.id}>
                      <td>{idx + 1}</td>
                      <td>{toDateOnly(r.expense_date)}</td>
                      <td><span className={"pill " + t.cls}>{t.ar}</span></td>
                      <td>{r.category || "-"}</td>
                      <td>{r.method || "-"}</td>
                      <td style={{ fontWeight: 800 }}>{money(r.amount)}</td>
                      <td style={{ maxWidth: 320, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.note || "-"}
                      </td>
                      <td className="no-print" style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-outline" onClick={() => openEdit(r)}>تعديل</button>
                        <button className="btn btn-danger" onClick={() => delRow(r.id)}>حذف</button>
                      </td>
                    </tr>
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
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(760px, 94vw)", maxHeight: "90vh", overflow: "auto" }}
          >
            <div className="modal-head">
              <div>
                <div className="badge">{editId ? "تعديل" : "جديد"}</div>
                <h3 style={{ margin: "6px 0 0" }}>
                  {fDirection === "income" ? "دخل" : "مصروف"}
                </h3>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)}>✕</button>
            </div>

            <form onSubmit={saveRow}>
              <div className="grid2">
                <label>
                  النوع
                  <select className="input" value={fDirection} onChange={(e) => setFDirection(e.target.value)}>
                    <option value="expense">مصروف</option>
                    <option value="income">دخل</option>
                  </select>
                </label>

                <label>
                  طريقة الدفع
                  <select className="input" value={fMethod} onChange={(e) => setFMethod(e.target.value)}>
                    <option value="cash">نقدي</option>
                    <option value="bank">تحويل</option>
                    <option value="other">أخرى</option>
                  </select>
                </label>

                <label>
                  التاريخ (expense_date)
                  <input
                    className="input"
                    type="date"
                    value={fExpenseDate}
                    onChange={(e) => setFExpenseDate(e.target.value)}
                  />
                </label>

                <label>
                  التاريخ/الوقت (created_at)
                  <input
                    className="input"
                    type="datetime-local"
                    value={(fCreatedAt || "").slice(0, 16)}
                    onChange={(e) => setFCreatedAt(new Date(e.target.value).toISOString())}
                  />
                </label>

                <label>
                  البند / النوع
                  <input
                    className="input"
                    value={fCategory}
                    onChange={(e) => setFCategory(e.target.value)}
                    placeholder="راتب، إيجار، كهرباء… أو دخل (تحويل، شحن...)"
                  />
                </label>

                <label>
                  المبلغ (موجب)
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={fAmount}
                    onChange={(e) => setFAmount(e.target.value)}
                    placeholder="مثال: 2500"
                  />
                </label>

                <label style={{ gridColumn: "1 / -1" }}>
                  ملاحظة
                  <input
                    className="input"
                    value={fNote}
                    onChange={(e) => setFNote(e.target.value)}
                    placeholder="اختياري"
                  />
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
                ملاحظة: المبلغ يُحفظ موجب دائمًا، والاتجاه يحدد (دخل/مصروف) داخل التقارير.
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
