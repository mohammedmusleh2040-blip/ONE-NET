// src/pages/Expenses.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

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

  useEffect(() => { localStorage.setItem("one_net_employees", JSON.stringify(employees)); }, [employees]);

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

  const [open, setOpen] = useState(false);
  const [fDirection, setFDirection] = useState("expense");
  const [fCategory, setFCategory] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fMethod, setFMethod] = useState("cash");
  const [fNote, setFNote] = useState("");
  const [toast, setToast] = useState("");

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 1800); }

  // 🔥 دالة التحميل المربوطة بالفترة (from / to)
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
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { loadRows(); }, [from, to]);

  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (direction !== "all" && String(r.direction || "") !== direction) return false;
      if (method !== "all" && String(r.method || "") !== method) return false;
      return !s || String(r.category || "").toLowerCase().includes(s) || String(r.note || "").toLowerCase().includes(s);
    });
  }, [rows, q, direction, method]);

  const salaryRows = useMemo(() => {
    return (rows || []).filter(r => String(r.direction) === "expense" && (String(r.category).includes("رواتب") || String(r.category).includes("سلف"))).map(r => ({ ...r, _emp: parseEmployee(r.note), _kind: String(r.category).includes("سلف") ? "advance" : "salary" }));
  }, [rows]);

  const employeesList = useMemo(() => {
    const set = new Set(employees.map(e => e.name));
    salaryRows.forEach(r => { if(r._emp) set.add(r._emp); });
    return Array.from(set).sort();
  }, [salaryRows, employees]);

  const salaryByEmployee = useMemo(() => {
    return employees.map(emp => {
      const moves = salaryRows.filter(r => r._emp === emp.name);
      const sal = moves.filter(r => r._kind === "salary").reduce((a,b) => a + safeNum(b.amount), 0);
      const adv = moves.filter(r => r._kind === "advance").reduce((a,b) => a + safeNum(b.amount), 0);
      return { ...emp, employee: emp.name, salary: sal, advance: adv, net: sal - adv };
    });
  }, [salaryRows, employees]);

  async function saveRow(e) {
    e.preventDefault();
    try {
      await supabase.from("expenses").insert({ expense_date: todayISO(), category: fCategory, amount: fAmount, direction: fDirection, method: fMethod, note: fNote });
      setOpen(false); loadRows(); showToast("✅ تم الحفظ");
    } catch { alert("فشل الحفظ"); }
  }

  async function delRow(id) {
    if (!confirm("حذف؟")) return;
    await supabase.from("expenses").delete().eq("id", id);
    loadRows();
  }

  return (
    <div className="page" style={{ padding: 18, direction: "rtl" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, background: "#36d0aa", color: "#fff", padding: 10, borderRadius: 8 }}>{toast}</div>}
      
      <div style={styles.headerRow}>
        <h2>{tab === "expenses" ? "المصروفات" : "الرواتب والسلف"}</h2>
        <div style={styles.tabs}>
          <button className="btn" onClick={() => setTab("expenses")}>المصروفات</button>
          <button className="btn" onClick={() => setTab("salaries")}>الرواتب</button>
        </div>
      </div>

      {tab === "expenses" && (
        <div className="card">
          <div style={{ display: "flex", gap: 8, marginBottom: 15 }}>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            <button className="btn" onClick={() => setOpen(true)}>+ إضافة قيد</button>
          </div>
          <table className="table"><thead><tr><th>البند</th><th>المبلغ</th><th>النوع</th><th>إجراء</th></tr></thead>
            <tbody>{filtered.map(r => <tr key={r.id}><td>{r.category}</td><td>{money(r.amount)}</td><td>{r.direction}</td><td><button onClick={() => delRow(r.id)}>حذف</button></td></tr>)}</tbody>
          </table>
        </div>
      )}

      {tab === "salaries" && (
        <div className="card">
          <select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)}><option value="">اختر موظف</option>{employeesList.map(n=><option key={n} value={n}>{n}</option>)}</select>
          <table className="table"><thead><tr><th>الموظف</th><th>الراتب</th><th>السلفة</th><th>الصافي</th></tr></thead>
            <tbody>{salaryByEmployee.map(e => <tr key={e.employee}><td>{e.employee}</td><td>{money(e.salary)}</td><td>{money(e.advance)}</td><td>{money(e.net)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}><div className="modal" style={{ background: "#fff", padding: 20 }}>
          <form onSubmit={saveRow}><input value={fCategory} onChange={e=>setFCategory(e.target.value)} placeholder="البند"/><input type="number" value={fAmount} onChange={e=>setFAmount(e.target.value)} placeholder="المبلغ"/><button type="submit">حفظ</button></form>
        </div></div>
      )}
    </div>
  );
}

const styles = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  tabs: { display: "flex", gap: 8 },
  card: { padding: 16, borderRadius: 18, background: "var(--panel)", border: "1px solid var(--border)" },
  table: { width: "100%" }
};
