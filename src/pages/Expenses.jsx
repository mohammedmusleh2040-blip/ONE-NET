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
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("expenses");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [direction, setDirection] = useState("all"); 
  const [method, setMethod] = useState("all"); 

  const [employees, setEmployees] = useState(() => {
    const saved = localStorage.getItem("one_net_employees");
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem("one_net_employees", JSON.stringify(employees));
  }, [employees]);

  const [salDate, setSalDate] = useState(todayISO());
  const [salEmployee, setSalEmployee] = useState("");
  const [salType, setSalType] = useState("salary"); 
  const [salAmount, setSalAmount] = useState("");
  const [salMethod, setSalMethod] = useState("cash");
  const [salNote, setSalNote] = useState("");
  const [salMonth, setSalMonth] = useState(() => new Date().toLocaleString("ar-EG", { month: "long" }));
  const [salBaseAmount, setSalBaseAmount] = useState("4000");

  const [empFilter, setEmpFilter] = useState("");
  const [statementFrom, setStatementFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [statementTo, setStatementTo] = useState(() => todayISO());

  const [toast, setToast] = useState("");
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 1800); }

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [fDirection, setFDirection] = useState("expense"); 
  const [fExpenseDate, setFExpenseDate] = useState(todayISO());
  const [fCategory, setFCategory] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fMethod, setFMethod] = useState("cash");
  const [fNote, setFNote] = useState("");

  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [empEditMode, setEmpEditMode] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState(null);
  const [empFormName, setEmpFormName] = useState("");
  const [empFormRole, setEmpFormRole] = useState("");
  const [empFormSalary, setEmpFormSalary] = useState("");
  const [empFormStatus, setEmpFormStatus] = useState("نشط");

  async function loadRows() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .gte("expense_date", from)
        .lte("expense_date", to)
        .order("expense_date", { ascending: false });
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRows(); }, [from, to]);

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
    let income = 0; let expense = 0;
    for (const r of filtered) {
      const amt = safeNum(r.amount);
      if (String(r.direction) === "income") income += amt;
      else expense += amt;
    }
    return { income, expense, net: income - expense };
  }, [filtered]);

  // ====== تعريف الموظفين والقوائم هنا لضمان وجودها ======
  const salaryRows = useMemo(() => {
    return (rows || []).filter(r => String(r.direction) === "expense" && (String(r.category).includes("راتب") || String(r.category).includes("سلف"))).map(r => ({ ...r, _emp: parseEmployee(r.note), _kind: String(r.category).includes("سلف") ? "advance" : "salary" }));
  }, [rows]);

  const employeesList = useMemo(() => {
    const set = new Set(employees.map(e => e.name));
    salaryRows.forEach(r => { if(r._emp) set.add(r._emp); });
    return Array.from(set).sort();
  }, [salaryRows, employees]);

  const currentEmployeeObject = useMemo(() => employees.find(e => e.name === salEmployee) || null, [employees, salEmployee]);

  const currentEmpUnpaidAdvance = useMemo(() => {
    if (!salEmployee) return 0;
    const empMoves = salaryRows.filter(r => r._emp === salEmployee);
    let adv = empMoves.filter(r => r._kind === "advance").reduce((a, b) => a + safeNum(b.amount), 0);
    let repaid = empMoves.filter(r => String(r.note).includes("استقطاع سلفة")).reduce((a, b) => {
        const m = String(b.note).match(/استقطاع سلفة:\s*([\d.]+)/);
        return a + (m ? safeNum(m[1]) : 0);
    }, 0);
    return Math.max(0, adv - repaid);
  }, [salaryRows, salEmployee]);

  const dynamicNetPayable = useMemo(() => {
    const base = currentEmployeeObject ? safeNum(currentEmployeeObject.salary) : safeNum(salBaseAmount);
    return salType === "advance" ? safeNum(salAmount) : Math.max(0, base - currentEmpUnpaidAdvance);
  }, [currentEmployeeObject, salBaseAmount, currentEmpUnpaidAdvance, salType, salAmount]);

  const salaryByEmployee = useMemo(() => {
    return employees.map(emp => {
      const moves = salaryRows.filter(r => r._emp === emp.name);
      const sal = moves.filter(r => r._kind === "salary").reduce((a,b) => a + safeNum(b.amount), 0);
      const adv = moves.filter(r => r._kind === "advance").reduce((a,b) => a + safeNum(b.amount), 0);
      return { ...emp, employee: emp.name, salary: sal, advance: adv, net: sal - adv };
    });
  }, [salaryRows, employees]);

  const employeeStatementData = useMemo(() => {
    if (!empFilter) return [];
    return salaryRows.filter(r => r._emp === empFilter).map(r => ({
      date: r.expense_date, kind: r._kind, debit: r._kind === "advance" ? r.amount : 0, credit: r._kind === "salary" ? r.amount : 0, note: r.note
    }));
  }, [salaryRows, empFilter]);

  // ===== CRUD =====
  function handleOpenNewEmployee() { setEmpFormName(""); setEmpEditMode(false); setEmpModalOpen(true); }
  function saveEmployeeData(e) { e.preventDefault(); if (empEditMode) setEmployees(prev => prev.map(emp => emp.id === selectedEmpId ? { ...emp, name: empFormName, role: empFormRole, salary: safeNum(empFormSalary), status: empFormStatus } : emp)); else setEmployees(prev => [...prev, { id: crypto.randomUUID(), name: empFormName, role: empFormRole, salary: safeNum(empFormSalary), status: empFormStatus }]); setEmpModalOpen(false); showToast("✅ تم الحفظ"); }
  function deleteEmployeeItem(id) { setEmployees(prev => prev.filter(e => e.id !== id)); showToast("🗑️ تم الحذف"); }

  async function saveRow(e) { e?.preventDefault?.(); try { await supabase.from("expenses").insert({ expense_date: fExpenseDate, category: fCategory, amount: fAmount, direction: fDirection, method: fMethod, note: fNote }); setOpen(false); await loadRows(); showToast("✅ تم الحفظ"); } catch { alert("فشل الحفظ"); } }
  async function delRow(id) { await supabase.from("expenses").delete().eq("id", id); await loadRows(); showToast("🗑️ تم الحذف"); }
  async function saveSalary() { try { await supabase.from("expenses").insert({ expense_date: salDate, category: salType === "advance" ? "سلف موظفين" : "رواتب", amount: salAmount, direction: "expense", method: salMethod, note: buildEmpNote(salEmployee, salNote) }); showToast("✅ تم الاعتماد"); await loadRows(); } catch { alert("فشل"); } }

  return (
    <div className="page" style={{ padding: 18, direction: "rtl" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, zIndex: 99999, padding: 10, background: "#36d0aa", color: "#fff", borderRadius: 8 }}>{toast}</div>}
      <div style={styles.headerRow}>
        <div><h2 style={{ margin: 0 }}>{tab === "expenses" ? "المصروفات / الدخل" : "إدارة الموظفين والرواتب"}</h2></div>
        <div style={styles.tabs}>
          <button className={"btn " + (tab === "expenses" ? "btn-primary" : "btn-outline")} onClick={() => setTab("expenses")}>المصروفات / الدخل</button>
          <button className={"btn " + (tab === "salaries" ? "btn-primary" : "btn-outline")} onClick={() => setTab("salaries")}>الرواتب / السلف</button>
        </div>
      </div>
      {tab === "expenses" && (
        <div className="card">
           <button className="btn btn-primary" onClick={() => setOpen(true)}>+ إضافة قيد</button>
           <table className="table"><thead><tr><th>البند</th><th>المبلغ</th><th>النوع</th><th>إجراء</th></tr></thead><tbody>{filtered.map(r => <tr key={r.id}><td>{r.category}</td><td>{money(r.amount)}</td><td>{r.direction}</td><td><button onClick={() => delRow(r.id)}>حذف</button></td></tr>)}</tbody></table>
        </div>
      )}
      {tab === "salaries" && (
        <div className="card">
           <div style={{ display: "flex", gap: 10 }}>
             <button className="btn" onClick={handleOpenNewEmployee}>+ موظف</button>
             <button className="btn" onClick={saveSalary}>صرف</button>
           </div>
           <table className="table"><thead><tr><th>الموظف</th><th>الراتب</th><th>السلفة</th><th>الصافي</th><th>إجراء</th></tr></thead><tbody>{salaryByEmployee.map(e => <tr key={e.id} onClick={() => setEmpFilter(e.employee)}><td>{e.employee}</td><td>{money(e.salary)}</td><td>{money(e.advance)}</td><td>{money(e.net)}</td><td><button onClick={() => deleteEmployeeItem(e.id)}>حذف</button></td></tr>)}</tbody></table>
        </div>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}><div className="modal" style={{ background: "#fff", padding: 20 }}><h3>إضافة قيد</h3><form onSubmit={saveRow}><input value={fCategory} onChange={e=>setFCategory(e.target.value)} placeholder="البند"/><input type="number" value={fAmount} onChange={e=>setFAmount(e.target.value)} placeholder="المبلغ"/><button type="submit">حفظ</button></form></div></div>
      )}
      {empModalOpen && (
        <div className="modal-backdrop" onClick={() => setEmpModalOpen(false)}><div className="modal" style={{ background: "#fff", padding: 20 }}><h3>موظف</h3><form onSubmit={saveEmployeeData}><input value={empFormName} onChange={e=>setEmpFormName(e.target.value)} placeholder="الاسم"/><button type="submit">حفظ</button></form></div></div>
      )}
    </div>
  );
}

const styles = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  tabs: { display: "flex", gap: 8 },
  tab: { padding: "10px 14px", cursor: "pointer" },
  tabActive: { padding: "10px 14px", cursor: "pointer", borderBottom: "2px solid blue" },
  card: { padding: 16, borderRadius: 18, background: "var(--panel)", border: "1px solid var(--border)" },
  input: { padding: "8px", borderRadius: 8 },
  btn: { padding: "8px 12px", cursor: "pointer" },
  btnPrimary: { padding: "8px 12px", background: "blue", color: "#fff" },
  table: { width: "100%" }
};
