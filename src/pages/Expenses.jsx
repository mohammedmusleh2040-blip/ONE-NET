
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

// Parse employee name from note (supports Arabic/English patterns)
const parseEmployee = (note) => {
  const s = String(note || "").trim();
  if (!s) return "";
  // Arabic: "الموظف: محمد" or "موظف: محمد"
  let m = s.match(/(?:الموظف|موظف)\s*[:：]\s*([^|\n]+)/i);
  if (m && m[1]) return m[1].trim();
  // English: "EMP: John"
  m = s.match(/\bEMP\s*[:：]\s*([^|\n]+)/i);
  if (m && m[1]) return m[1].trim();
  // Fallback: first token before "|" if exists
  const part = s.split("|")[0].trim();
  return part.length <= 40 ? part : "";
};

const buildEmpNote = (emp, note) => {
  const e = String(emp || "").trim();
  const n = String(note || "").trim();
  const head = e ? `الموظف: ${e}` : "";
  if (!head) return n;
  if (!n) return head;
  // Avoid duplicating employee header
  if (n.includes("الموظف:") || /\bEMP\s*:/i.test(n)) return n;
  return `${head} | ${n}`;
};

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

  // Tabs: expenses/income vs salaries
  const [tab, setTab] = useState("expenses"); // 'expenses' | 'salaries'

  // printing mode
  const [printMode, setPrintMode] = useState("none"); // none | expenses | employee

  // Salary/Advance form
  const [salDate, setSalDate] = useState(todayISO());
  const [salEmployee, setSalEmployee] = useState("");
  const [salType, setSalType] = useState("salary"); // salary | advance
  const [salAmount, setSalAmount] = useState("");
  const [salMethod, setSalMethod] = useState("cash");
  const [salNote, setSalNote] = useState("");

  // printing (employee statement)
  const [empFilter, setEmpFilter] = useState("");

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
  const [fExpenseDate, setFExpenseDate] = useState(todayISO());
  const [fCategory, setFCategory] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fMethod, setFMethod] = useState("cash");
  const [fNote, setFNote] = useState("");
  const [fCreatedAt, setFCreatedAt] = useState(nowISO());

  // ===== load =====
  async function loadRows() {
    setLoading(true);
    try {
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

  // ===== computed (expenses/income) =====
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
        expense_date: fExpenseDate,
        category: String(fCategory).trim(),
        amount: amt,
        direction: fDirection,
        method: fMethod,
        note: fNote || null,
        created_at: fCreatedAt || nowISO(),
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

  // ===== Salaries (using the same expenses table) =====
  const salaryRows = useMemo(() => {
    const arr = Array.isArray(rows) ? rows : [];
    return arr
      .filter((r) => String(r.direction || "") === "expense")
      .filter((r) => {
        const c = String(r.category || "").trim();
        const cl = c.toLowerCase();
        return c === "رواتب" || c === "راتب" || cl === "salary" || c === "سلفة" || cl === "advance";
      })
      .map((r) => {
        const cat = String(r.category || "").trim();
        const cl = cat.toLowerCase();
        const kind = cat === "سلفة" || cl === "advance" ? "advance" : "salary";
        return { ...r, _emp: parseEmployee(r.note), _kind: kind };
      });
  }, [rows]);

  const salaryByEmployee = useMemo(() => {
    const map = new Map();
    for (const r of salaryRows) {
      const emp = r._emp || "غير محدد";
      if (!map.has(emp)) map.set(emp, { employee: emp, salary: 0, advance: 0, net: 0 });
      const it = map.get(emp);
      const amt = safeNum(r.amount);
      if (r._kind === "advance") it.advance += amt;
      else it.salary += amt;
    }
    const out = Array.from(map.values()).map((x) => ({ ...x, net: x.salary - x.advance }));
    out.sort((a, b) => a.employee.localeCompare(b.employee, "ar"));
    return out;
  }, [salaryRows]);

  const salaryTotals = useMemo(() => {
    let salary = 0;
    let advance = 0;
    for (const r of salaryRows) {
      const amt = safeNum(r.amount);
      if (r._kind === "advance") advance += amt;
      else salary += amt;
    }
    return { salary, advance, net: salary - advance };
  }, [salaryRows]);

  async function saveSalary() {
    const emp = String(salEmployee || "").trim();
    const amt = safeNum(salAmount);
    if (!emp) return alert("اكتب اسم الموظف");
    if (!amt || amt <= 0) return alert("اكتب مبلغ صحيح");

    const cat = salType === "advance" ? "سلفة" : "رواتب";
    const payload = {
      expense_date: salDate || todayISO(),
      category: cat,
      amount: amt,
      direction: "expense",
      method: salMethod || "cash",
      note: buildEmpNote(emp, salNote),
    };

    const { error } = await supabase.from("expenses").insert(payload);
    if (error) {
      console.error("saveSalary error", error);
      alert(error.message || "فشل الحفظ");
      return;
    }

    showToast("✅ تم حفظ العملية");
    setSalAmount("");
    setSalNote("");
    // keep employee for faster entry
    await loadRows();
  }

  // ===== Statement computed =====
  const statementEmp = String(empFilter || "").trim();
  const statementRows = useMemo(() => {
    if (!statementEmp) return [];
    const s = statementEmp.toLowerCase();
    return salaryRows.filter((r) => String(r._emp || "").toLowerCase().includes(s));
  }, [salaryRows, statementEmp]);

  const statementTotals = useMemo(() => {
    let salary = 0;
    let advance = 0;
    for (const r of statementRows) {
      const amt = safeNum(r.amount);
      if (r._kind === "advance") advance += amt;
      else salary += amt;
    }
    return { salary, advance, net: salary - advance };
  }, [statementRows]);

  // ===== Printing =====
  function printExpensesReport() {
    // print only expenses report area (filtered rows + totals)
    setPrintMode("expenses");
    setTimeout(() => window.print(), 60);
    setTimeout(() => setPrintMode("none"), 800);
  }

  function printEmployeeStatement() {
    // print only employee statement area
    setPrintMode("employee");
    setTimeout(() => window.print(), 60);
    setTimeout(() => setPrintMode("none"), 800);
  }

  const printMeta = useMemo(() => {
    const fromD = from || todayISO();
    const toD = to || todayISO();
    return {
      from: fromD,
      to: toD,
      at: new Date().toLocaleString("ar-SA"),
    };
  }, [from, to]);

  return (
    <div className="page" data-print-mode={printMode}>
      {/* Print CSS: show only the chosen print area */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          body * { visibility: hidden; }
          [data-print-area="expenses"], [data-print-area="expenses"] *,
          [data-print-area="employee"], [data-print-area="employee"] * {
            visibility: hidden;
          }

          /* Show selected area */
          .print-show { position: fixed; inset: 0; padding: 16px; }
          .print-show, .print-show * { visibility: visible !important; }

          .print-card { box-shadow: none !important; border: 1px solid #ddd; border-radius: 10px; padding: 12px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #000; padding: 6px; text-align: center; }
        }
      `}</style>

      {toast && <div className="toast">{toast}</div>}

      <div className="page-head">
        <div>
          <div className="badge">{tab === "expenses" ? "المصروفات والدخل" : "الرواتب والسلف"}</div>
          <h2 style={{ margin: "8px 0 0" }}>{tab === "expenses" ? "سجل المصروفات والدخل" : "سجل الرواتب والسلف"}</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            {tab === "expenses"
              ? "الصافي = الدخل − المصروف | صافي الكاش = دخل نقدي − مصروف نقدي"
              : "الرواتب والسلف محفوظة داخل جدول المصروفات (expenses) بدون أي تعديل على قاعدة البيانات"}
          </div>
        </div>

        <div className="actions-row no-print">
          {tab === "expenses" ? (
            <>
              <button className="btn" onClick={() => openNew("expense")}>+ مصروف</button>
              <button className="btn btn-outline" onClick={() => openNew("income")}>+ دخل</button>
              <button className="btn btn-outline" onClick={printExpensesReport} disabled={loading || filtered.length === 0}>
                🖨️ طباعة التقرير
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={saveSalary} disabled={loading}>+ إضافة راتب/سلفة</button>
              <button className="btn btn-outline" onClick={printEmployeeStatement}>
                🖨️ طباعة كشف الحساب
              </button>
            </>
          )}
          <button className="btn btn-outline" onClick={loadRows} disabled={loading}>تحديث</button>
        </div>

        <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            className={"btn btn-outline" + (tab === "expenses" ? " active" : "")}
            onClick={() => setTab("expenses")}
            type="button"
          >
            المصروفات / الدخل
          </button>
          <button
            className={"btn btn-outline" + (tab === "salaries" ? " active" : "")}
            onClick={() => setTab("salaries")}
            type="button"
          >
            الرواتب / السلف
          </button>
        </div>
      </div>

      {tab === "expenses" ? (
        <>
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

              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", justifyContent: "flex-end", flexWrap: "wrap" }}>
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
                          <td>
                            <span className={"pill " + t.cls}>{t.ar}</span>
                          </td>
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
                    <h3 style={{ margin: "6px 0 0" }}>{fDirection === "income" ? "دخل" : "مصروف"}</h3>
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

          {/* Printable Expenses Report */}
          <div
            data-print-area="expenses"
            className={printMode === "expenses" ? "print-show" : ""}
          >
            {printMode === "expenses" && (
              <div className="print-card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>تقرير المصروفات والدخل</div>
                    <div style={{ marginTop: 4, fontSize: 12 }}>الفترة: {printMeta.from} → {printMeta.to}</div>
                    <div style={{ marginTop: 4, fontSize: 12 }}>تاريخ الطباعة: {printMeta.at}</div>
                  </div>
                  <div style={{ textAlign: "left", fontSize: 12 }}>
                    <div><b>إجمالي دخل:</b> {money(totals.income)}</div>
                    <div><b>إجمالي مصروف:</b> {money(totals.expense)}</div>
                    <div><b>الصافي:</b> {money(totals.net)}</div>
                    <div><b>صافي الكاش:</b> {money(totals.cashNet)}</div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>التاريخ</th>
                        <th>النوع</th>
                        <th>البند</th>
                        <th>الطريقة</th>
                        <th>المبلغ</th>
                        <th>ملاحظة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length ? (
                        filtered.map((r, idx) => (
                          <tr key={r.id}>
                            <td>{idx + 1}</td>
                            <td>{toDateOnly(r.expense_date)}</td>
                            <td>{String(r.direction) === "income" ? "دخل" : "مصروف"}</td>
                            <td>{r.category || "-"}</td>
                            <td>{r.method || "-"}</td>
                            <td>{money(r.amount)}</td>
                            <td style={{ textAlign: "right" }}>{r.note || "-"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={7}>لا توجد بيانات</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 20 }}>
                  <div style={{ width: "45%" }}>
                    <div style={{ fontWeight: 800, marginBottom: 10 }}>التوقيع</div>
                    <div style={{ borderBottom: "1px solid #000", height: 28 }} />
                  </div>
                  <div style={{ width: "45%" }}>
                    <div style={{ fontWeight: 800, marginBottom: 10 }}>الختم</div>
                    <div style={{ border: "1px dashed #000", height: 60, borderRadius: 8 }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Salaries Tab */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="cardHead">
              <div>
                <div className="cardTitle">إضافة راتب / سلفة</div>
                <div className="muted">يتم الحفظ في جدول المصروفات (expenses) ضمن تصنيفات: رواتب / سلفة</div>
              </div>
            </div>

            <div className="cardBody">
              <div className="grid2">
                <div className="field">
                  <label>التاريخ</label>
                  <input type="date" value={salDate} onChange={(e) => setSalDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>الموظف</label>
                  <input value={salEmployee} onChange={(e) => setSalEmployee(e.target.value)} placeholder="اسم الموظف" />
                </div>

                <div className="field">
                  <label>النوع</label>
                  <select value={salType} onChange={(e) => setSalType(e.target.value)}>
                    <option value="salary">راتب</option>
                    <option value="advance">سلفة</option>
                  </select>
                </div>

                <div className="field">
                  <label>المبلغ</label>
                  <input value={salAmount} onChange={(e) => setSalAmount(e.target.value)} placeholder="0" inputMode="decimal" />
                </div>

                <div className="field">
                  <label>الطريقة</label>
                  <select value={salMethod} onChange={(e) => setSalMethod(e.target.value)}>
                    <option value="cash">نقداً</option>
                    <option value="bank">تحويل/بنك</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>

                <div className="field">
                  <label>ملاحظة (اختياري)</label>
                  <input value={salNote} onChange={(e) => setSalNote(e.target.value)} placeholder="مثال: شهر ديسمبر" />
                </div>
              </div>
            </div>
          </div>

          <div className="statsRow" style={{ marginTop: 14 }}>
            <div className="stat">
              <div className="statLabel">إجمالي الرواتب</div>
              <div className="statValue">{money(salaryTotals.salary)}</div>
            </div>
            <div className="stat">
              <div className="statLabel">إجمالي السلف</div>
              <div className="statValue">{money(salaryTotals.advance)}</div>
            </div>
            <div className="stat">
              <div className="statLabel">صافي الرواتب</div>
              <div className="statValue">{money(salaryTotals.net)}</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="cardHead">
              <div>
                <div className="cardTitle">كشف رواتب حسب الموظف</div>
                <div className="muted">الراتب − السلفة = الصافي</div>
              </div>
            </div>
            <div className="cardBody">
              <div className="no-print" style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 10, flexWrap: "wrap" }}>
                <label style={{ flex: 1, minWidth: 220 }}>
                  اختر الموظف للطباعة
                  <input
                    className="input"
                    placeholder="اكتب اسم الموظف"
                    value={empFilter}
                    onChange={(e) => setEmpFilter(e.target.value)}
                  />
                </label>
                <button className="btn btn-outline" onClick={printEmployeeStatement}>
                  🖨️ طباعة كشف الحساب
                </button>
              </div>

              <div className="tableWrap no-print">
                <table className="table">
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      <th>رواتب</th>
                      <th>سلف</th>
                      <th>الصافي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salaryByEmployee.length ? (
                      salaryByEmployee.map((r) => (
                        <tr key={r.employee}>
                          <td>{r.employee}</td>
                          <td>{money(r.salary)}</td>
                          <td>{money(r.advance)}</td>
                          <td>{money(r.net)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="noData">لا توجد بيانات رواتب/سلف للفترة المختارة</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="muted no-print" style={{ marginTop: 8 }}>
                ملاحظة: يتم أخذ اسم الموظف من الملاحظة بصيغة <b>الموظف: الاسم</b> (النظام يضيفها تلقائياً عند الحفظ).
              </div>
            </div>
          </div>

          {/* Printable Employee Statement */}
          <div
            data-print-area="employee"
            className={printMode === "employee" ? "print-show" : ""}
          >
            {printMode === "employee" && (
              <div className="print-card">
                <div style={{ textAlign: "center", marginBottom: 10 }}>
                  <h2 style={{ margin: 0 }}>كشف حساب رواتب</h2>
                  <div style={{ marginTop: 6 }}>الموظف: <b>{statementEmp || "—"}</b></div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "#444" }}>تاريخ الطباعة: {new Date().toLocaleString("ar-SA")}</div>
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 10, flexWrap: "wrap" }}>
                  <div><b>إجمالي الرواتب:</b> {money(statementTotals.salary)}</div>
                  <div><b>إجمالي السلف:</b> {money(statementTotals.advance)}</div>
                  <div><b>الصافي:</b> {money(statementTotals.net)}</div>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>النوع</th>
                      <th>المبلغ</th>
                      <th>ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statementEmp ? (
                      statementRows.length ? (
                        statementRows.map((r) => (
                          <tr key={r.id}>
                            <td>{toDateOnly(r.expense_date)}</td>
                            <td>{r._kind === "advance" ? "سلفة" : "راتب"}</td>
                            <td>{money(r.amount)}</td>
                            <td style={{ textAlign: "right" }}>{r.note || "-"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4}>لا توجد حركات لهذا الموظف ضمن الفترة</td>
                        </tr>
                      )
                    ) : (
                      <tr>
                        <td colSpan={4}>اكتب اسم الموظف في خانة "اختر الموظف للطباعة" ثم اضغط طباعة</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 20 }}>
                  <div style={{ width: "45%" }}>
                    <div style={{ fontWeight: 800, marginBottom: 10 }}>التوقيع</div>
                    <div style={{ borderBottom: "1px solid #000", height: 28 }} />
                  </div>
                  <div style={{ width: "45%" }}>
                    <div style={{ fontWeight: 800, marginBottom: 10 }}>الختم</div>
                    <div style={{ border: "1px dashed #000", height: 60, borderRadius: 8 }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
