// src/pages/Expenses.jsx
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

// دالة ذكية لتفكيك اسم الموظف من عمود الملاحظات
const parseEmployee = (note) => {
  const s = String(note || "").trim();
  if (!s) return "";
  let m = s.match(/(?:الموظف|موظف)\s*[:：]\s*([^|\n]+)/i);
  if (m && m[1]) return m[1].trim();
  const part = s.split("|")[0].trim();
  return part.length <= 40 ? part : "";
};

const buildEmpNote = (emp, note, extra = "") => {
  const e = String(emp || "").trim();
  const n = String(note || "").trim();
  const head = e ? `الموظف: ${e}` : "";
  let res = head;
  if (n) res += ` | ${n}`;
  if (extra) res += ` | ${extra}`;
  return res;
};

export default function Expenses() {
  // ===== data =====
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  // filters
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [direction, setDirection] = useState("all"); 
  const [method, setMethod] = useState("all"); 

  // Tabs
  const [tab, setTab] = useState("expenses"); 

  // printing mode
  const [printMode, setPrintMode] = useState("none"); 

  // 🔥 شاشة الرواتب والسلف الاحترافية المترابطة
  const [salDate, setSalDate] = useState(todayISO());
  const [salEmployee, setSalEmployee] = useState("");
  const [salType, setSalType] = useState("salary"); // salary | advance
  const [salAmount, setSalAmount] = useState("");
  const [salMethod, setSalMethod] = useState("cash");
  const [salNote, setSalNote] = useState("");
  const [salMonth, setSalMonth] = useState(() => new Date().toLocaleString("ar-EG", { month: "long" }));
  const [salBaseAmount, setSalBaseAmount] = useState("4000"); // الراتب الأساسي الافتراضي للموظف

  // كشف حساب الموظف
  const [empFilter, setEmpFilter] = useState("");
  const [statementFrom, setStatementFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [statementTo, setStatementTo] = useState(() => todayISO());

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

  // form
  const [fDirection, setFDirection] = useState("expense"); 
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
  }, [from, to]);

  // ===== computed (expenses/income) =====
  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (direction !== "all" && String(r.direction || "") !== direction) return false;
      if (method !== "all" && String(r.method || "") !== method) return false;
      if (!s) return true;
      return String(r.category || "").toLowerCase().includes(s) || String(r.note || "").toLowerCase().includes(s) || String(r.id).includes(s);
    });
  }, [rows, q, direction, method]);

  const totals = useMemo(() => {
    let income = 0; let expense = 0; let incomeCash = 0; let expenseCash = 0;
    for (const r of filtered) {
      const amt = safeNum(r.amount);
      const isCash = String(r.method || "") === "cash";
      if (String(r.direction) === "income") {
        income += amt; if (isCash) incomeCash += amt;
      } else {
        expense += amt; if (isCash) expenseCash += amt;
      }
    }
    return { income, expense, net: income - expense, cashNet: incomeCash - expenseCash };
  }, [filtered]);

  // ====================================================================
  // 🔥 الحسابات التفاعلية المترابطة لنظام الرواتب والسلف برمجياً داخل React
  // ====================================================================
  const salaryRows = useMemo(() => {
    return (rows || [])
      .filter((r) => String(r.direction || "") === "expense")
      .filter((r) => {
        const c = String(r.category || "").trim();
        return c === "رواتب" || c === "سلف موظفين" || c === "سلفة";
      })
      .map((r) => {
        const cat = String(r.category || "").trim();
        const kind = cat === "سلف موظفين" || cat === "سلفة" ? "advance" : "salary";
        let extractedMonth = "";
        const mMatch = String(r.note || "").match(/شهر:\s*([^|\n]+)/);
        if (mMatch) extractedMonth = mMatch[1].trim();
        return { ...r, _emp: parseEmployee(r.note), _kind: kind, _month: extractedMonth };
      });
  }, [rows]);

  const employeesList = useMemo(() => {
    const set = new Set(["محمد", "الأنبط", "أبو مهند"]);
    salaryRows.forEach(r => { if(r._emp) set.add(r._emp); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [salaryRows]);

  const currentEmpUnpaidAdvance = useMemo(() => {
    if (!salEmployee) return 0;
    const empMoves = salaryRows.filter(r => r._emp === salEmployee);
    let totalAdv = 0; let totalRepaid = 0;
    empMoves.forEach(r => {
      if (r._kind === "advance") totalAdv += safeNum(r.amount);
      if (String(r.note || "").includes("استقطاع سلفة")) {
        const match = String(r.note || "").match(/استقطاع سلفة:\s*([\d.]+)/);
        if (match) totalRepaid += safeNum(match[1]);
      }
    });
    return Math.max(0, totalAdv - totalRepaid);
  }, [salaryRows, salEmployee]);

  const dynamicNetPayable = useMemo(() => {
    const base = safeNum(salBaseAmount);
    if (salType === "advance") return safeNum(salAmount);
    return Math.max(0, base - currentEmpUnpaidAdvance);
  }, [salBaseAmount, currentEmpUnpaidAdvance, salType, salAmount]);

  useEffect(() => {
    if (salType === "salary") setSalAmount(String(dynamicNetPayable));
  }, [dynamicNetPayable, salType]);

  const salaryByEmployee = useMemo(() => {
    const map = new Map();
    for (const r of salaryRows) {
      const emp = r._emp || "غير محدد";
      if (!map.has(emp)) map.set(emp, { employee: emp, salary: 0, advance: 0, net: 0 });
      const it = map.get(emp);
      if (r._kind === "advance") it.advance += safeNum(r.amount);
      else it.salary += safeNum(r.amount);
    }
    return Array.from(map.values()).map(x => ({ ...x, net: x.salary - x.advance }));
  }, [salaryRows]);

  const employeeStatementData = useMemo(() => {
    if (!empFilter) return [];
    const filteredMoves = salaryRows.filter(r => r._emp === empFilter && r.expense_date >= statementFrom && r.expense_date <= statementTo);
    const sorted = [...filteredMoves].sort((a, b) => new Date(a.expense_date) - new Date(b.expense_date));
    let currentBalance = 0;
    return sorted.map(r => {
      let debit = 0; let credit = 0;
      if (r._kind === "advance") { debit = safeNum(r.amount); currentBalance += debit; }
      else { credit = safeNum(r.amount); const advM = String(r.note || "").match(/استقطاع سلفة:\s*([\d.]+)/); currentBalance -= safeNum(advM ? advM[1] : 0); }
      return { date: r.expense_date, kind: r._kind === "advance" ? "سلفة" : `راتب ${r._month}`, debit, credit, runningBalance: currentBalance, note: r.note };
    });
  }, [salaryRows, empFilter, statementFrom, statementTo]);

  // ===== modal helpers =====
  function resetForm() {
    setEditId(null); setFDirection("expense"); setFExpenseDate(todayISO()); setFCategory(""); setFAmount(""); setFMethod("cash"); setFNote(""); setFCreatedAt(nowISO());
  }

  async function saveRow(e) {
    e?.preventDefault?.();
    const amt = safeNum(fAmount);
    if (!String(fCategory || "").trim()) return alert("اكتب بند/نوع المصروف");
    if (amt <= 0) return alert("اكتب مبلغ صحيح أكبر من الصفر");

    setSaving(true);
    try {
      const payload = { expense_date: fExpenseDate, category: String(fCategory).trim(), amount: amt, direction: fDirection, method: fMethod, note: fNote || null, created_at: fCreatedAt || nowISO() };
      if (editId) await supabase.from("expenses").update(payload).eq("id", editId);
      else await supabase.from("expenses").insert(payload);
      setOpen(false); resetForm(); await loadRows(); showToast("✅ تم الحفظ بنجاح");
    } catch { alert("فشل الحفظ"); } finally { setSaving(false); }
  }

  async function delRow(id) {
    if (!confirm("هل تريد حذف هذا السجل نهائياً؟")) return;
    try {
      setLoading(true);
      await supabase.from("expenses").delete().eq("id", id);
      await loadRows(); showToast("🗑️ تم الحذف");
    } catch { alert("فشل الحذف"); } finally { setLoading(false); }
  }

  // 🔥 حفظ الراتب والسلف ومنع التكرار
  async function saveSalary() {
    const emp = String(salEmployee || "").trim();
    const amt = safeNum(salAmount);
    const base = safeNum(salBaseAmount);
    if (!emp) return alert("الرجاء اختيار الموظف");
    if (amt <= 0) return alert("الرجاء إدخال مبلغ صحيح");

    if (salType === "salary") {
      const isDuplicated = salaryRows.some(r => r._emp === emp && r._kind === "salary" && String(r._month) === String(salMonth));
      if (isDuplicated) return alert(`⚠️ تم صرف راتب شهر (${salMonth}) مسبقاً لهذا الموظف!`);
    }

    setSaving(true);
    try {
      const cat = salType === "advance" ? "سلف موظفين" : "رواتب";
      const payload = {
        expense_date: salDate, category: cat, amount: amt, direction: "expense", method: salMethod,
        note: salType === "advance" ? buildEmpNote(emp, salNote, "سلفة نقدية مستلمة") : buildEmpNote(emp, salNote, `الأساسي: ${base} | استقطاع سلفة: ${currentEmpUnpaidAdvance} | شهر: ${salMonth}`),
        created_at: nowISO()
      };
      await supabase.from("expenses").insert(payload);
      showToast("✅ تم تسجيل السند بنجاح");
      setSalAmount(""); setSalNote(""); await loadRows();
    } catch { alert("فشل الحفظ"); } finally { setSaving(false); }
  }

  return (
    <div className="page" style={{ padding: 18, direction: "rtl" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, zIndex: 99999, padding: "12px 14px", borderRadius: 12, background: "rgba(54, 208, 170, 0.9)", color: "#fff" }}>{toast}</div>}

      <div className="page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
        <div>
          <h2 style={{ margin: 0 }}>{tab === "expenses" ? "سجل المصروفات والدخل العامة" : "💼 دليل رواتب وسلف الموظفين"}</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>نظام ون نت المترابط لإدارة الحركات المالية والخزينة.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={"btn " + (tab === "expenses" ? "btn-primary" : "btn-outline")} onClick={() => setTab("expenses")}>المصروفات / الدخل</button>
          <button className={"btn " + (tab === "salaries" ? "btn-primary" : "btn-outline")} onClick={() => setTab("salaries")}>الرواتب / السلف</button>
        </div>
      </div>

      {/* ===================== TAB 1: المصروفات والدخل ===================== */}
      {tab === "expenses" && (
        <>
          <div className="card" style={{ padding: 16, marginBottom: 15 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
              <select value={direction} onChange={(e) => setDirection(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}><option value="all">كل الحركات</option><option value="expense">مصروفات</option><option value="income">إيرادات / دخل</option></select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث سري في القيود..." style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", flex: 1 }} />
              <button className="btn btn-primary" onClick={() => setOpen(true)}>+ إضافة قيد جديد</button>
            </div>
            <div style={{ display: "flex", gap: 15, marginTop: 15, justifyContent: "flex-end" }}>
              <div style={{ fontSize: 13 }}>إجمالي الدخل: <b style={{ color: "green" }}>{money(totals.income)}</b></div>
              <div style={{ fontSize: 13 }}>إجمالي المصروف: <b style={{ color: "red" }}>{money(totals.expense)}</b></div>
              <div style={{ fontSize: 13 }}>صافي الصندوق: <b>{money(totals.net)} ريال</b></div>
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "#f5f5f5" }}><th>#</th><th>التاريخ</th><th>النوع</th><th>البند</th><th>الطريقة</th><th>المبلغ الصافي</th><th>بيان وملاحظة الحركة</th><th>إجراءات</th></tr></thead>
                <tbody>
                  {filtered.map((r, idx) => (
                    <tr key={r.id}>
                      <td>{idx + 1}</td><td>{toDateOnly(r.expense_date)}</td>
                      <td><span className={"pill " + dirUi(r.direction).cls}>{dirUi(r.direction).ar}</span></td>
                      <td>{r.category}</td><td>{r.method}</td><td><strong>{money(r.amount)}</strong></td><td>{r.note || "-"}</td>
                      <td>
                        <button onClick={() => { openEdit(r); }} style={{ marginLeft: 6 }}>تعديل</button>
                        <button onClick={() => delRow(r.id)} style={{ color: "red" }}>حذف</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ===================== TAB 2: الرواتب والسلف الاحترافية المترابطة ===================== */}
      {tab === "salaries" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 15 }}>
            <div className="card" style={{ padding: 15, borderRight: "4px solid #3182ce" }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>💵 رواتب مصروفة نقدًا بالفترة</div>
              <div style={{ fontSize: 24, fontWeight: "bold" }}>{money(salaryRows.filter(r=>r._kind==="salary").reduce((a,b)=>a+safeNum(b.amount),0))} ريال</div>
            </div>
            <div className="card" style={{ padding: 15, borderRight: "4px solid #dd6b20" }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>💸 سلف قائمة غير مستردة بالفترة</div>
              <div style={{ fontSize: 24, fontWeight: "bold", color: "#dd6b20" }}>{money(salaryRows.filter(r=>r._kind==="advance").reduce((a,b)=>a+safeNum(b.amount),0))} ريال</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20, alignItems: "start" }}>
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: "0 0 15px 0", fontSize: 14 }}>صرف الرواتب والسلف</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ fontSize: 12 }}>التاريخ<input type="date" value={salDate} onChange={(e) => setSalDate(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }} /></label>
                <label style={{ fontSize: 12 }}>الموظف المستهدف *
                  <select value={salEmployee} onChange={(e) => setSalEmployee(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }}>
                    <option value="">اختر الموظف...</option>
                    {employeesList.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>نوع العملية<select value={salType} onChange={(e) => setSalType(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }}><option value="salary">صرف راتب شهري</option><option value="advance">تسجيل سلفة موظف</option></select></label>
                {salType === "salary" ? (
                  <label style={{ fontSize: 12 }}>الراتب الأساسي<input type="number" value={salBaseAmount} onChange={(e) => setSalBaseAmount(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }} /></label>
                ) : (
                  <label style={{ fontSize: 12 }}>مبلغ السلفة المطلوب<input type="number" value={salAmount} onChange={(e) => setSalAmount(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }} /></label>
                )}
                <label style={{ fontSize: 12 }}>الشهر المستهدف<select value={salMonth} onChange={(e) => setSalMonth(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }}><option value="يناير">يناير</option><option value="فبراير">فبراير</option><option value="مارس">مارس</option><option value="أبريل">أبريل</option><option value="مايو">مايو</option><option value="يونيو">يونيو</option><option value="يوليو">يوليو</option><option value="أغسطس">أغسطس</option><option value="سبتمبر">سبتمبر</option><option value="أكتوبر">أكتوبر</option><option value="نوفمبر">نوفمبر</option><option value="ديسمبر">ديسمبر</option></select></label>
                <label style={{ fontSize: 12 }}>طريقة الدفع/الصرف<select value={salMethod} onChange={(e) => setSalMethod(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }}><option value="cash">نقداً من الصندوق</option><option value="bank">تحويل بنكي</option></select></label>
              </div>

              {salEmployee && salType === "salary" && (
                <div style={{ marginTop: 15, padding: 12, background: "rgba(220,100,50,0.06)", border: "1px dashed #dd6b20", borderRadius: 8, fontSize: 12 }}>
                  💼 حوسبة مستحقات الموظف (<b>{salEmployee}</b>): <br/>
                  - الراتب الأساسي القائم: <b>{money(salBaseAmount)} ريال</b> <br/>
                  - مديونية السلف غير المسددة عليه: <b style={{ color: "red" }}>{money(currentEmpUnpaidAdvance)} ريال</b> <br/>
                  <hr style={{ border: "none", borderTop: "1px solid #ddd", margin: "6px 0" }}/>
                  - الصافي المستحق والمصروف كاش الآن: <b style={{ color: "green" }}>{money(dynamicNetPayable)} ريال</b>
                </div>
              )}

              <button className="btn btn-primary" onClick={saveSalary} style={{ width: "100%", marginTop: 15, padding: 10 }}>💾 حفظ واعتماد السند المالي فورا</button>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: "0 0 15px 0", fontSize: 14 }}>أرصدة حسابات الموظفين الحالية</h3>
              <div className="table-wrap" style={{ maxHeight: 280 }}>
                <table className="table">
                  <thead><tr><th>الموظف</th><th>رواتب</th><th>سلف قائمة</th><th>الصافي</th></tr></thead>
                  <tbody>
                    {salaryByEmployee.map(emp => (
                      <tr key={emp.employee} onClick={() => setEmpFilter(emp.employee)} style={{ cursor: "pointer" }}>
                        <td><strong>{emp.employee}</strong></td><td>{money(emp.salary)}</td><td style={{ color: "red" }}>{money(emp.advance)}</td><td><strong>{money(emp.net)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15, flexWrap: "wrap", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>📊 كشف الحساب المالي للموظف</h3>
              <div style={{ display: "flex", gap: 10 }}>
                <select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} style={{ padding: 6, borderRadius: 8, border: "1px solid #ddd" }}><option value="">اختر الموظف...</option>{employeesList.map(n=><option key={n} value={n}>{n}</option>)}</select>
                <input type="date" value={statementFrom} onChange={(e) => setStatementFrom(e.target.value)} style={{ padding: 6, borderRadius: 8, border: "1px solid #ddd" }} />
                <input type="date" value={statementTo} onChange={(e) => setStatementTo(e.target.value)} style={{ padding: 6, borderRadius: 8, border: "1px solid #ddd" }} />
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>التاريخ</th><th>البيان المالي للحركة</th><th>مدين (سلفة +)</th><th>دائن (راتب -)</th><th>الرصيد المتبقي لدين السلفة</th></tr></thead>
                <tbody>
                  {employeeStatementData.length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: "center", color: "var(--muted)", padding: 15 }}>الرجاء اختيار اسم الموظف لمعاينة كشف حسابه المتصاعد</td></tr>
                  ) : (
                    employeeStatementData.map((row, i) => (
                      <tr key={i}>
                        <td>{row.date}</td><td><strong>{row.kind}</strong> <span style={{ fontSize: 11, color: "var(--muted)" }}>({row.note})</span></td>
                        <td style={{ color: "red" }}>{row.debit > 0 ? money(row.debit) : ""}</td><td style={{ color: "green" }}>{row.credit > 0 ? money(row.credit) : ""}</td>
                        <td><strong>{money(row.runningBalance)} ريال</strong></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal لإنشاء حركات المصروفات العامة */}
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}><div className="modal" onClick={e=>e.stopPropagation()} style={{ background: "var(--panel)", padding: 20, borderRadius: 12, width: "90%", maxWidth: 500 }}><form onSubmit={saveRow}><h3>إضافة قيد حركة جديدة</h3><div style={{ display: "grid", gap: 10 }}><label style={{ fontSize: 12 }}>النوع<select value={fDirection} onChange={e=>setFDirection(e.target.value)} style={{ padding: 8, width: "100%" }}><option value="expense">مصروف</option><option value="income">دخل</option></select></label><label style={{ fontSize: 12 }}>البند / التصنيف<input value={fCategory} onChange={e=>setFCategory(e.target.value)} placeholder="مثال: كهرباء، إيجار، ماء" style={{ padding: 8, width: "100%" }} /></label><label style={{ fontSize: 12 }}>المبلغ<input type="number" step="0.01" value={fAmount} onChange={e=>setFAmount(e.target.value)} style={{ padding: 8, width: "100%" }} /></label><label style={{ fontSize: 12 }}>طريقة الصرف<select value={fMethod} onChange={e=>setFMethod(e.target.value)} style={{ padding: 8, width: "100%" }}><option value="cash">نقدي</option><option value="bank">تحويل</option></select></label><label style={{ fontSize: 12 }}>ملاحظات عامة<input value={fNote} onChange={e=>setFNote(e.target.value)} style={{ padding: 8, width: "100%" }} /></label></div><div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 15 }}><button type="submit" className="btn btn-primary">حفظ القيد</button><button type="button" onClick={()=>setOpen(false)} className="btn btn-outline">إلغاء</button></div></form></div></div>
      )}
    </div>
  );
}

// ===== Styles =====
const styles = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  tabs: { display: "flex", gap: 8, flexWrap: "wrap" },
  tab: { padding: "10px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer" },
  tabActive: { padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(54, 208, 170, 0.5)", background: "rgba(54, 208, 170, 0.18)", color: "var(--text)", cursor: "pointer" },
  card: { padding: 16, borderRadius: 18, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" },
  label: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, width: "100%" },
  input: { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(0,0,0,0.15)", color: "var(--text)", outline: "none", width: "100%" },
  tableWrap: { marginTop: 12, overflowX: "auto", overflowY: "auto", maxHeight: 360, borderRadius: 14, border: "1px solid var(--border)" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 700 }
};
