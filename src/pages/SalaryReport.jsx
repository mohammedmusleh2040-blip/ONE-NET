import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// تقرير رواتب مستقل (يعتمد على جدول expenses فقط)
// يعتمد أن رواتب = category = 'رواتب' و direction = 'expense'
// إذا ما عندك عمود employee_name: نقرأ الاسم من note بصيغة: "راتب / الاسم / 2025-12" (اختياري)

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => safeNum(v).toFixed(2);
const todayISO = () => new Date().toISOString().slice(0, 10);

function parseEmployeeName(note) {
  const s = String(note || "").trim();
  // راتب / احمد علي / 2025-12
  const parts = s.split("/").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2 && parts[0].includes("راتب")) return parts[1];
  // بديل: Salary - Ahmed
  const m = s.match(/salary\s*[:-]\s*(.+)$/i);
  if (m) return m[1].trim();
  return "";
}

export default function SalaryReport() {
  const [from, setFrom] = useState(() => todayISO());
  const [to, setTo] = useState(() => todayISO());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const start = `${from}T00:00:00`;
      const end = `${to}T23:59:59`;
      const { data, error } = await supabase
        .from("expenses")
        .select("id, expense_date, category, amount, direction, method, note, created_at")
        .eq("category", "رواتب")
        .eq("direction", "expense")
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setErr(e?.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const summary = useMemo(() => {
    const map = new Map();
    let total = 0;
    for (const r of rows) {
      const name = parseEmployeeName(r.note) || "غير محدد";
      const amt = safeNum(r.amount);
      total += amt;
      map.set(name, (map.get(name) || 0) + amt);
    }
    const items = Array.from(map.entries()).map(([name, totalAmount]) => ({ name, totalAmount }));
    items.sort((a, b) => b.totalAmount - a.totalAmount);
    return { total, items };
  }, [rows]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>تقرير الرواتب</h2>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginInlineStart: "auto", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            من
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            إلى
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button onClick={load} disabled={loading}>
            {loading ? "جاري التحميل..." : "تحديث"}
          </button>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#ffe8e8", color: "#7a0000" }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, alignItems: "start" }}>
        <div style={{ padding: 12, borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>إجمالي الرواتب</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{money(summary.total)}</div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>حسب الموظف</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {summary.items.map((x) => (
              <div key={x.name} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</div>
                <div style={{ fontWeight: 700 }}>{money(x.totalAmount)}</div>
              </div>
            ))}
            {!summary.items.length ? <div style={{ opacity: 0.7 }}>لا توجد رواتب في هذه الفترة</div> : null}
          </div>
        </div>

        <div style={{ padding: 12, borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>السجل</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{rows.length} سطر</div>
          </div>

          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "right", opacity: 0.85 }}>
                  <th style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>التاريخ</th>
                  <th style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>الموظف</th>
                  <th style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>المبلغ</th>
                  <th style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>الطريقة</th>
                  <th style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{r.expense_date}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {parseEmployeeName(r.note) || "غير محدد"}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.06)", fontWeight: 700 }}>
                      {money(r.amount)}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{r.method}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{r.note || ""}</td>
                  </tr>
                ))}
                {!rows.length && !loading ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 12, opacity: 0.7 }}>
                      لا توجد بيانات
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            ملاحظة: اكتب الملاحظة بهذا الشكل عشان يصير اسم الموظف واضح: <b>راتب / اسم الموظف / 2025-12</b>
          </div>
        </div>
      </div>
    </div>
  );
}
