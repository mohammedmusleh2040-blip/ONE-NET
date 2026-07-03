import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function DailyCashReport() {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [totalPayments, setTotalPayments] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);

  async function loadReport() {
    const { data: payRows } = await supabase
      .from("payments")
      .select("id, amount, invoice_id, note, pay_date, method, is_refund")
      .gte("pay_date", fromDate)
      .lte("pay_date", toDate)
      .neq("method", "from_balance")
      .neq("is_refund", true)
      .order("pay_date", { ascending: false });

    const safePayRows = payRows || [];

    const invoiceIds = [...new Set(safePayRows.map((p) => p.invoice_id).filter(Boolean))];
    let invoiceMap = {};
    
    if (invoiceIds.length > 0) {
      const { data: invRows } = await supabase.from("invoices").select("id, number").in("id", invoiceIds);
      if (invRows) {
        invoiceMap = Object.fromEntries(invRows.map((i) => [i.id, i.number]));
      }
    }

    const finalPayments = safePayRows.map((p) => ({
      ...p,
      invoice_number: invoiceMap[p.invoice_id] || "-"
    }));

    const { data: expRows } = await supabase
      .from("expenses")
      .select("*")
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("expense_date", { ascending: false });

    const safeExpRows = expRows || [];

    setPayments(finalPayments);
    setExpenses(safeExpRows);
    setTotalPayments(finalPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    setTotalExpenses(safeExpRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  }

  useEffect(() => {
    loadReport();
  }, [fromDate, toDate]);

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { padding: 0 !important; }
        }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #000; padding: 8px; text-align: center; }
      `}</style>

      <div style={{ padding: 20 }}>
        <div className="no-print" style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <button onClick={loadReport}>تحديث</button>
          <button onClick={() => window.print()}>طباعة</button>
        </div>

        <h1>تقرير اليومية</h1>
        <h3>من {fromDate} إلى {toDate}</h3>

        <div style={{ background: "#e0f7fa", padding: "10px", borderRadius: "8px", marginBottom: "20px" }}>
          <h2>إجمالي القبض: {totalPayments.toLocaleString()}</h2>
        </div>

        <h2>سندات القبض</h2>
        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>الفاتورة</th>
              <th>المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{p.pay_date}</td>
                <td>{p.invoice_number}</td>
                <td>{Number(p.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>المصروفات</h2>
        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>البند</th>
              <th>المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id}>
                <td>{e.expense_date}</td>
                <td>{e.category}</td>
                <td>{Number(e.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div style={{ marginTop: 20, fontWeight: "bold", fontSize: "1.2em", borderTop: "2px solid #000", paddingTop: "10px" }}>
          الصافي (القبض - المصروفات): {(totalPayments - totalExpenses).toLocaleString()}
        </div>
      </div>
    </>
  );
}
