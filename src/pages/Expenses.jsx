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
  // ===== Data State =====
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("expenses"); // expenses | salaries
  const [printMode, setPrintMode] = useState("none"); // none | expenses | employee

  // Filters (TAB 1)
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [direction, setDirection] = useState("all"); 
  const [method, setMethod] = useState("all"); 

  // ====== 1. دليل الموظفين الديناميكي المدمج ======
  const [employees, setEmployees] = useState(() => {
    const saved = localStorage.getItem("one_net_employees");
    return saved ? JSON.parse(saved) : [
      { id: "1", name: "أحمد", role: "إنتاج", salary: 4000, date: "2025-01-15", status: "نشط", notes: "مصنع الكروت" },
      { id: "2", name: "محمد", role: "صيانة شبكات", salary: 4500, date: "2024-06-01", status: "نشط", notes: "إدارة ون نت" },
      { id: "3", name: "الأنبط", role: "توزيع ومبيعات", salary: 3500, date: "2025-03-10", status: "نشط", notes: "عهدة الباعة" }
    ];
  });

  useEffect(() => {
    localStorage.setItem("one_net_employees", JSON.stringify(employees));
  }, [employees]);

  // ====== 2. الرواتب والسلف والنوافذ المنبثقة ======
  const [salDate, setSalDate] = useState(todayISO());
  const [salEmployee, setSalEmployee] = useState("");
  const [salType, setSalType] = useState("salary"); 
  const [salAmount, setSalAmount] = useState("");
  const [salMethod, setSalMethod] = useState("cash");
  const [salNote, setSalNote] = useState("");
  const [salMonth, setSalMonth] = useState(() => new Date().toLocaleString("ar-EG", { month: "long" }));

  // كشف الحساب والبحث
  const [empFilter, setEmpFilter] = useState("");
  const [statementFrom, setStatementFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [statementTo, setStatementTo] = useState(() => todayISO());

  // Modals Controller
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [empEditMode, setEmpEditMode] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState(null);

  // Employee Form State
  const [empFormName, setEmpFormName] = useState("");
  const [empFormRole, setEmpFormRole] = useState("");
  const [empFormSalary, setEmpFormSalary] = useState("");
  const [empFormDate, setEmpFormDate] = useState(todayISO());
  const [empFormStatus, setEmpFormStatus] = useState("نشط");
  const [empFormNotes, setEmpFormNotes] = useState("");

  // Expense Main Modal
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [fDirection, setFDirection] = useState("expense"); 
  const [fExpenseDate, setFExpenseDate] = useState(todayISO());
  const [fCategory, setFCategory] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fMethod, setFMethod] = useState("cash");
  const [fNote, setFNote] = useState("");

  const [toast, setToast] = useState("");
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 1800); }

  // ===== Load Data =====
  async function loadRows() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRows(); }, [from, to]);

  // ===== Computed (TAB 1) =====
  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (direction !== "all" && String(r.direction || "") !== direction) return false;
      if (method !== "all" && String(r.method || "") !== method) return false;
      if (!s) return true;
      return String(r.category || "").toLowerCase().includes(s) || String(r.note || "").toLowerCase().includes(s);
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

  // ===== المحرك المالي المحوسب للرواتب والسلف والتأمين المحاسبي =====
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

  // إيجاد الموظف المختار حالياً من دليل الموظفين
  const currentEmployeeObject = useMemo(() => {
    return employees.find(e => e.name === salEmployee) || null;
  }, [employees, salEmployee]);

  // حساب السلف غير المسددة المتبقية في ذمة الموظف حياً
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

  // حساب صافي المبلغ المستحق والمصروف فعلياً للراتب
  const dynamicNetPayable = useMemo(() => {
    const base = currentEmployeeObject ? safeNum(currentEmployeeObject.salary) : safeNum(salBaseAmount);
    if (salType === "advance") return safeNum(salAmount);
    return Math.max(0, base - currentEmpUnpaidAdvance);
  }, [currentEmployeeObject, salBaseAmount, currentEmpUnpaidAdvance, salType, salAmount]);

  // مزامنة المبلغ التلقائي المصروف في الحقل حياً
  useEffect(() => {
    if (salType === "salary") {
      setSalAmount(String(dynamicNetPayable));
    }
  }, [dynamicNetPayable, salType]);

  const salaryByEmployee = useMemo(() => {
    return employees.map(emp => {
      const empMoves = salaryRows.filter(r => r._emp === emp.name);
      let salPaid = 0; let advPaid = 0;
      empMoves.forEach(r => {
        if (r._kind === "advance") advPaid += safeNum(r.amount);
        else salPaid += safeNum(r.amount);
      });
      return { employee: emp.name, role: emp.role, baseSalary: emp.salary, salary: salPaid, advance: advPaid, net: salPaid - advPaid, status: emp.status, id: emp.id };
    });
  }, [salaryRows, employees]);

  // كشف حساب الموظف المتصاعد التفصيلي للطباعة والمعاينة
  const employeeStatementData = useMemo(() => {
    if (!empFilter) return [];
    const filteredMoves = salaryRows.filter(r => r._emp === empFilter && r.expense_date >= statementFrom && r.expense_date <= statementTo);
    const sorted = [...filteredMoves].sort((a, b) => new Date(a.expense_date) - new Date(b.expense_date));
    
    let currentBalance = 0;
    return sorted.map((r) => {
      let debit = 0; let credit = 0;
      if (r._kind === "advance") {
        debit = safeNum(r.amount); currentBalance += debit;
      } else {
        credit = safeNum(r.amount);
        const advM = String(r.note || "").match(/استقطاع سلفة:\s*([\d.]+)/);
        if (advM) currentBalance -= safeNum(advM[1]);
      }
      return { date: r.expense_date, kind: r._kind === "advance" ? "سلفة" : `راتب ${r._month || ""}`, debit, credit, runningBalance: currentBalance, note: r.note };
    });
  }, [salaryRows, empFilter, statementFrom, statementTo]);

  // ===================== CRUD الموظفين والرواتب =====================
  function handleOpenNewEmployee() {
    setSalEmployee("");
    setSalType("salary");
    setSalAmount("");
    setSalNote("");
    setSalBaseAmount("4000");
    setEmpEditMode(false);
    setEmpModalOpen(true);
  }

  function handleStartEditEmployee(emp) {
    setSelectedEmpId(emp.id);
    setEmpFormName(emp.employee);
    setEmpFormRole(emp.role);
    setEmpFormSalary(String(emp.baseSalary));
    setEmpFormStatus(emp.status);
    setEmpEditMode(true);
    setEmpModalOpen(true);
  }

  function saveEmployeeData(e) {
    e.preventDefault();
    if (!empFormName.trim()) return alert("اكتب اسم الموظف");
    
    if (empEditMode) {
      setEmployees(prev => prev.map(emp => emp.id === selectedEmpId ? { ...emp, name: empFormName, role: empFormRole, salary: safeNum(empFormSalary), status: empFormStatus } : emp));
      showToast("✅ تم تعديل بيانات الموظف");
    } else {
      const newEmp = { id: crypto.randomUUID(), name: empFormName, role: empFormRole, salary: safeNum(empFormSalary), date: todayISO(), status: empFormStatus, notes: "" };
      setEmployees(prev => [...prev, newEmp]);
      showToast("✅ تم إضافة الموظف الجديد");
    }
    setEmpModalOpen(false);
    setEmpFormName(""); setEmpFormRole(""); setEmpFormSalary("");
  }

  function deleteEmployeeItem(id) {
    if (!confirm("هل تريد حذف الموظف نهائياً من الدليل المعتمد؟")) return;
    setEmployees(prev => prev.filter(emp => emp.id !== id));
    showToast("🗑️ تم حذف الموظف");
  }

  async function handleSaveSalaryOrAdvance() {
    const emp = String(salEmployee || "").trim();
    const amt = safeNum(salAmount);
    if (!emp) return alert("اختر الموظف أولاً");
    if (amt <= 0) return alert("أدخل مبلغاً صحيحاً");

    if (salType === "salary") {
      const isPaid = salaryRows.some(r => r._emp === emp && r._kind === "salary" && String(r._month) === String(salMonth));
      if (isPaid) return alert(`⚠️ تم صرف راتب شهر (${salMonth}) مسبقاً لهذا الموظف!`);
    }

    setLoading(true);
    try {
      const cat = salType === "advance" ? "سلفة" : "رواتب";
      const baseSalary = currentEmployeeObject ? safeNum(currentEmployeeObject.salary) : safeNum(salBaseAmount);
      
      const payload = {
        expense_date: salDate,
        category: cat,
        amount: amt,
        direction: "expense",
        method: salMethod,
        note: salType === "advance" 
          ? buildEmpNote(emp, salNote, `سلفة ماليّة خصم من الصندوق [طريقة الدفع: ${salMethod === "cash" ? "نقدي" : "تحويل"}]`)
          : buildEmpNote(emp, salNote, `راتب شهر ${salMonth} | الأساسي: ${baseSalary} | استقطاع سلفة: ${currentEmpUnpaidAdvance} | الصافي المستلم فعلياً: ${amt}`),
        created_at: nowISO()
      };

      const { error } = await supabase.from("expenses").insert(payload);
      if (error) throw error;

      showToast("✅ تم حفظ السند المالي بنجاح");
      setSalAmount(""); setSalNote(""); await loadRows();
    } catch {
      alert("فشل في حفظ السند المالي");
    } finally {
      setLoading(false);
    }
  }

  // ===== الطباعة المحترفة =====
  function printEmployeeStatement() {
    if (!empFilter) return alert("اختر الموظف لعرض وطباعة الكشف");
    const rowsHtml = employeeStatementData.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.date}</td>
        <td>${r.kind}</td>
        <td>${money(r.debit)}</td>
        <td>${money(r.credit)}</td>
        <td>${money(r.runningBalance)}</td>
        <td>${r.note}</td>
      </tr>
    `).join("");

    const w = window.open("", "_blank");
    w.document.write(`
      <html dir="rtl">
      <head>
        <title>كشف الحساب المالي للموظف</title>
        <style>
          body { font-family: Tahoma, Arial, sans-serif; padding: 24px; color: #111; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th, td { border: 1px solid #999; padding: 8px; text-align: center; font-size: 13px; }
          th { background: #f4f6fb; }
          .header-title { text-align: center; font-size: 16px; font-weight: bold; margin-bottom: 20px; background: #eef2f7; padding: 10px; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="header-title">كشف الحساب المالي للموظف: ${empFilter}</div>
        <div style="font-size: 12px; margin-bottom: 10px;">الفترة المحددة: من ${statementFrom} إلى ${statementTo}</div>
        <table>
          <thead>
            <tr><th>#</th><th>التاريخ</th><th>البيان المالي للحركة</th><th>مدين (سلفة +)</th><th>دائن (راتب -)</th><th>الرصيد المتبقي</th><th>ملاحظات الحركة</th></tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="7">لا توجد حركات مسجلة للموظف في هذه الفترة الزمنية</td></tr>`}
          </tbody>
        </table>
        <script>window.print();</script>
      </body>
      </html>
    `);
    w.document.close();
  }

  function exportDebtsToCSV() {
    if (!employeeStatementData.length) return alert("لا توجد بيانات متاحة للتصدير.");
    let csvContent = "\uFEFF"; 
    csvContent += "التاريخ,البيان المالي,مدين,دائن,الرصيد المتبقي\n";
    employeeStatementData.forEach(r => {
      csvContent += `${r.date},"${r.kind}",${r.debit},${r.credit},${r.runningBalance}\n`;
    });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `كشف_حساب_${empFilter}.csv`);
    link.click();
  }

  return (
    <div className="page" style={{ padding: 18, direction: "rtl" }}>
      
      {/* التبويبات العلوية الحية المستقرة للنظام */}
      <div className="page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>{tab === "expenses" ? "سجل المصروفات والإيرادات" : "💼 دليل رواتب وسلف الموظفين"}</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>نظام الربط الشامل والمطابقات النقدية لشبكة ون نت اللاسلكية.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={"btn " + (tab === "expenses" ? "btn-primary" : "btn-outline")} onClick={() => setTab("expenses")}>المصروفات / الدخل</button>
          <button className={"btn " + (tab === "salaries" ? "btn-primary" : "btn-outline")} onClick={() => setTab("salaries")}>الرواتب / السلف</button>
        </div>
      </div>

      {/* ===================== التبويب الأول: المصروفات والدخل ===================== */}
      {tab === "expenses" && (
        <>
          <div className="card" style={{ padding: 16, marginBottom: 15 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
              <select value={direction} onChange={(e) => setDirection(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}><option value="all">كل العمليات</option><option value="expense">مصروفات</option><option value="income">دخل وإيرادات</option></select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث في القيود والتصنيفات المالية..." style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", flex: 1 }} />
              <button className="btn btn-primary" onClick={() => { resetForm(); setOpen(true); }}>+ إضافة قيد حركة</button>
            </div>
            <div style={{ display: "flex", gap: 15, marginTop: 15, justifyContent: "flex-end" }}>
              <div style={{ fontSize: 13 }}>إجمالي الدخل: <b style={{ color: "green" }}>{money(totals.income)}</b></div>
              <div style={{ fontSize: 13 }}>إجمالي المصروف: <b style={{ color: "red" }}>{money(totals.expense)}</b></div>
              <div style={{ fontSize: 13 }}>صافي السيولة النقدية: <b>{money(totals.net)} ريال</b></div>
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>بند التصنيف</th><th>طريقة الصرف</th><th>المبلغ المستقطع</th><th>بيان وملاحظة الحركة المالية</th><th>إجراءات</th></tr></thead>
                <tbody>
                  {filtered.map((r, idx) => (
                    <tr key={r.id}>
                      <td>{idx + 1}</td><td>{toDateOnly(r.expense_date)}</td>
                      <td><span className={"pill " + dirUi(r.direction).cls}>{dirUi(r.direction).ar}</span></td>
                      <td>{r.category}</td><td>{r.method}</td><td><strong>{money(r.amount)}</strong></td><td>{r.note || "-"}</td>
                      <td>
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

      {/* ===================== TAB 2: الرواتب والسلف الاحترافية المتكاملة 4 أقسام ===================== */}
      {tab === "salaries" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          
          {/* شريط الأزرار الشامل في أعلى الصفحة */}
          <div className="card" style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", background: "rgba(255,255,255,0.02)" }}>
            <button className="btn btn-primary" onClick={handleOpenNewEmployee}>➕ إضافة موظف جديد</button>
            <button className="btn btn-outline" onClick={() => { setSalType("advance"); showToast("💡 تم تحويل النموذج لوضع تسجيل سلفة"); }}>💰 تسجيل سلفة</button>
            <button className="btn btn-outline" onClick={() => { setSalType("salary"); showToast("💡 تم تحويل النموذج لوضع صرف راتب"); }} style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>💵 صرف راتب شهري</button>
            <button className="btn btn-outline" onClick={printEmployeeStatement}>🖨️ طباعة كشف حساب</button>
            <button className="btn btn-outline" onClick={exportDebtsToCSV}>📊 تصدير Excel</button>
          </div>

          {/* المؤشرات المالية الحية علوية */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 15 }}>
            <div className="card" style={{ padding: 15, borderRight: "5px solid #3182ce" }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>رواتب مصروفة نقدًا بالفترة</div>
              <div style={{ fontSize: 22, fontWeight: "bold", marginTop: 5 }}>{money(salaryRows.filter(r=>r._kind==="salary").reduce((a,b)=>a+safeNum(b.amount),0))} ريال</div>
            </div>
            <div className="card" style={{ padding: 15, borderRight: "5px solid #dd6b20" }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>سلف قائمة غير مستردة بالفترة</div>
              <div style={{ fontSize: 22, fontWeight: "bold", color: "#dd6b20", marginTop: 5 }}>{money(salaryRows.filter(r=>r._kind==="advance").reduce((a,b)=>a+safeNum(b.amount),0))} ريال</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20, alignItems: "start" }}>
            
            {/* القسم الثاني والثالث: نافذة ونموذج صرف الرواتب والسلف الذكي */}
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: "0 0 15px 0", fontSize: 14 }}>صرف العمليات والسندات (رواتب / سلف)</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ fontSize: 12 }}>التاريخ ووقت السند
                  <input type="date" value={salDate} onChange={(e) => setSalDate(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }} />
                </label>
                <label style={{ fontSize: 12 }}>الموظف المستهدف *
                  <select value={salEmployee} onChange={(e) => setSalEmployee(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }}>
                    <option value="">اختر الموظف...</option>
                    {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name} ({emp.role})</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>نوع السند المستند المالي
                  <select value={salType} onChange={(e) => setSalType(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }}>
                    <option value="salary">صرف راتب شهري</option>
                    <option value="advance">تسجيل سلفة موظف جديدة</option>
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>الشهر المالي المستهدف
                  <select value={salMonth} onChange={(e) => setSalMonth(e.target.value)} style={{ padding: 8, width: "100%", borderRadius: 8, border: "1px solid #ddd" }}><option value="يناير">يناير</option><option value="فبراير">فبراير</option><option value="مارس">مارس</option><option value="أبريل">أبريل</option><option value="مايو">مايو</option><option value="يونيو">يونيو</option><option value="يوليو">يوليو</option><option value="أغسطس">أغسطس</option><option value="سبتمبر">سبتمبر</option><option value="أكتوبر">أكتوبر</option><option value="نوفمبر">نوفمبر</option><option value="ديسمبر">ديسمبر</option></select>
                </label>
                <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>طريقة دفع وصرف المبلغ
                  <select value={salMethod} onChange={(e) => setSalMethod(e.target.value)} style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "rgba(0,0,0,0.20)", color: "var(--text)", width: "100%" }}><option value="cash">نقداً من كاش الصندوق الرئيسي</option><option value="bank">تحويل بنكي الكتروني</option></select>
                </label>
                <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>البيان والملاحظات الشارحة للقيد
                  <input value={salNote} onChange={(e) => setSalNote(e.target.value)} placeholder="ملاحظات اختيارية ترحل لليومية العامة..." style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "rgba(0,0,0,0.20)", color: "var(--text)", width: "100%" }} />
                </label>
              </div>

              {/* 🔥 الميزة الكبرى المضافة: بطاقة إدارية ذكية ومحوسبة حركياً تظهر فورياً قبل الحفظ */}
              {salEmployee && (
                <div style={{ marginTop: 15, padding: 14, background: "rgba(54, 208, 170, 0.08)", border: "1px dashed var(--border)", borderRadius: 12, fontSize: 13 }}>
                  📌 <b>بطاقة الموقف المالي للموظف الحالي:</b> <br/>
                  - الاسم الكامل: <b>{salEmployee}</b> <br/>
                  - الوظيفة: <b>{currentEmployeeObject?.role || "غير محددة"}</b> <br/>
                  - الراتب الأساسي: <b style={{ color: "var(--accent)" }}>{money(currentEmployeeObject?.salary || salBaseAmount)} ريال</b> <br/>
                  - السلف غير المسددة المتبقية في ذمته: <b style={{ color: "red" }}>{money(currentEmpUnpaidAdvance)} ريال</b> <br/>
                  <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "8px 0" }}/>
                  - 💵 <b>المبلغ المستحق الفعلي للصرف كاش الآن: <span style={{ color: "green", fontSize: 15 }}>{money(dynamicNetPayable)} ريال</span></b>
                </div>
              )}

              <button className="btn btn-primary" onClick={handleSaveSalaryOrAdvance} style={{ width: "100%", marginTop: 15, padding: 12 }}>
                💾 حفظ واعتماد قيد السند المالي المباشر بالصندوق
              </button>
            </div>

            {/* القسم الأول: جدول دليل الموظفين وأرصدتهم وإجراءات الإدارة الحية */}
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: "0 0 15px 0", fontSize: 14 }}>📋 دليل حسابات الموظفين القائمين وإجراءات الإدارة</h3>
              <div className="table-wrap" style={{ maxHeight: 310 }}>
                <table className="table">
                  <thead><tr><th>الموظف</th><th>الوظيفة</th><th>الراتب الأساسي</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                  <tbody>
                    {salaryByEmployee.map(emp => (
                      <tr key={emp.id} onClick={() => setEmpFilter(emp.employee)} style={{ cursor: "pointer" }} title="اضغط لعرض كشف حسابه المتصاعد بالأسفل">
                        <td><strong>{emp.employee}</strong></td>
                        <td>{emp.role || "-"}</td>
                        <td>{money(emp.baseSalary)}</td>
                        <td><span className={emp.status === "نشط" ? "pill pill-in" : "pill pill-out"}>{emp.status}</span></td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn" onClick={(e) => { e.stopPropagation(); handleStartEditEmployee(emp); }} style={{ padding: "4px 8px", fontSize: 11 }}>✏️ تعديل</button>
                            <button className="btn btn-danger" onClick={(e) => { e.stopPropagation(); deleteEmployeeItem(emp.id); }} style={{ padding: "4px 8px", fontSize: 11 }}>🗑️ حذف</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* القسم الرابع: شاشة كشف حساب الموظف المتصاعد الواضح والمتقن */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14 }}>📊 كشف الحساب المالي التفاعلي المتقن للموظف</h3>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>حساب متصاعد دقيق للسلف المأخوذة والاستقطاعات المقتطعة دورياً مع الراتب.</div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} style={{ padding: 6, borderRadius: 8, border: "1px solid #ddd" }}>
                  <option value="">اختر اسم الموظف لمعاينة كشفه...</option>
                  {employeesList.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <input type="date" value={statementFrom} onChange={(e) => setStatementFrom(e.target.value)} style={{ padding: 6, borderRadius: 8, border: "1px solid #ddd", fontSize: 12 }} />
                <input type="date" value={statementTo} onChange={(e) => setStatementTo(e.target.value)} style={{ padding: 6, borderRadius: 8, border: "1px solid #ddd", fontSize: 12 }} />
              </div>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>التاريخ</th><th>البيان المالي للحركة</th><th>مدين (سلفة +)</th><th>دائن (راتب ومستقطع -)</th><th>الرصيد المتبقي لدين السلفة بالتراكم</th></tr></thead>
                <tbody>
                  {employeeStatementData.length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: "center", color: "var(--muted)", padding: 15 }}>الرجاء تحديد اسم الموظف من القائمة لعرض وطباعة تقرير كشف حسابه المتصاعد فوراً</td></tr>
                  ) : (
                    employeeStatementData.map((row, i) => (
                      <tr key={i}>
                        <td>{row.date}</td>
                        <td><strong>{row.kind}</strong> <span style={{ fontSize: 11, color: "var(--muted)", marginRight: 6 }}>({row.note})</span></td>
                        <td style={{ color: "red" }}>{row.debit > 0 ? money(row.debit) : ""}</td>
                        <td style={{ color: "green" }}>{row.credit > 0 ? money(row.credit) : ""}</td>
                        <td><strong style={{ color: row.runningBalance > 0 ? "red" : "green" }}>{money(row.runningBalance)} ريال</strong></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* النافذة المنبثقة لإضافة / تعديل موظف جديد بدليل الرواتب */}
      {empModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999 }}>
          <div style={{ background: "var(--panel)", padding: 22, borderRadius: 16, width: "92%", maxWidth: 480, border: "1px solid var(--border)", color: "var(--text)" }}>
            <h3 style={{ margin: "0 0 15px 0" }}>{empEditMode ? "✏️ تعديل بيانات موظف قائم" : "➕ إضافة موظف كادر جديد"}</h3>
            <form onSubmit={saveEmployeeData} style={{ display: "grid", gap: 12 }}>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>اسم الموظف الكامل *
                <input value={empFormName} onChange={e=>setEmpFormName(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>الوظيفة / القسم الإداري
                <input value={empFormRole} onChange={e=>setEmpFormRole(e.target.value)} placeholder="إنتاج، مبيعات، حسابات..." style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>الراتب الأساسي الشهري (ريال) *
                <input type="number" value={empFormSalary} onChange={e=>setEmpFormSalary(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>حالة الموظف الحالية بالشبكة
                <select value={empFormStatus} onChange={e=>setEmpFormStatus(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}>
                  <option value="نشط">نشط (على رأس العمل)</option>
                  <option value="موقوف">موقوف مؤقتاً</option>
                </select>
              </label>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 15 }}>
                <button type="submit" className="btn btn-primary">حفظ واعتماد البيانات</button>
                <button type="button" className="btn btn-outline" onClick={()=>setEmpModalOpen(false)}>إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* النافذة المنبثقة لإنشاء حركات المصروفات العامة القائمة بالخزينة */}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}><div style={{ background: "var(--panel)", padding: 20, borderRadius: 14, width: "90%", maxWidth: 480 }}><form onSubmit={saveRow}><h3>تسجيل قيد حركة خزينة جديدة</h3><div style={{ display: "grid", gap: 10 }}><label style={{ fontSize: 12 }}>النوع<select value={fDirection} onChange={e=>setFDirection(e.target.value)} style={{ padding: 8, width: "100%" }}><option value="expense">مصروف</option><option value="income">دخل وإيراد</option></select></label><label style={{ fontSize: 12 }}>بند التصنيف المالي<input value={fCategory} onChange={e=>setFCategory(e.target.value)} placeholder="كهرباء، شحن، ماء، صيانة..." style={{ padding: 8, width: "100%" }} /></label><label style={{ fontSize: 12 }}>المبلغ المالي<input type="number" step="0.01" value={fAmount} onChange={e=>setFAmount(e.target.value)} style={{ padding: 8, width: "100%" }} /></label><label style={{ fontSize: 12 }}>طريقة التحصيل / الصرف<select value={fMethod} onChange={e=>setFMethod(e.target.value)} style={{ padding: 8, width: "100%" }}><option value="cash">نقدي</option><option value="bank">تحويل</option></select></label><label style={{ fontSize: 12 }}>ملاحظات وبيان الترحيل<input value={fNote} onChange={e=>setFNote(e.target.value)} style={{ padding: 8, width: "100%" }} /></label></div><div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 15 }}><button type="submit" className="btn btn-primary">حفظ واعتماد الحركة</button><button type="button" onClick={()=>setOpen(false)} className="btn btn-outline">إلغاء</button></div></form></div></div>
      )}

    </div>
  );
}

// ===== Styles =====
const styles = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  tabs: { display: "flex", gap: 8, flexWrap: "wrap" },Normally I can help with things like this, but I don't seem to have access to that content. You can try again or ask me for something else.
