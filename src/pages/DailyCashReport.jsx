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
    // تم إزالة شرط is_refund لأنه غير موجود في قاعدة البيانات
    const { data: payRows, error: payError } = await supabase
  .from("payments")
  .select("id, amount, invoice_id, note, pay_date, method")
  .gte("pay_date", fromDate)
  .lte("pay_date", toDate)
  .neq("method", "from_balance")
  
  .order("pay_date", { ascending: false });

    if (payError) console.error("Payment Error:", payError);

    const safePayRows = (payRows || []).filter(   (p) => !(p.note || "").includes("[WRITEOFF]") );

    const invoiceIds = [...new Set(safePayRows.map((p) => p.invoice_id).filter(Boolean))];
    let invoiceMap = {};
    
    if (invoiceIds.length > 0) {
      const { data: invRows } = await supabase
  .from("invoices")
  .select("id, number, is_refund")
  .in("id", invoiceIds);
      if (invRows) {
        invoiceMap = Object.fromEntries(
  invRows.map((i) => [
    i.id,
    {
      number: i.number,
      is_refund: i.is_refund,
    },
  ])
);
      }
    }

    const finalPayments = safePayRows
  .map((p) => ({
    ...p,
    invoice_number: invoiceMap[p.invoice_id]?.number || "-",
    is_refund: invoiceMap[p.invoice_id]?.is_refund || false,
  }))
  .filter((p) => !p.is_refund);

    const { data: expRows } = await supabase
  .from("expenses")
  .select("*")
  .gte("expense_date", fromDate)
  .lte("expense_date", toDate)
  .order("expense_date", { ascending: false });

const safeExpRows = expRows || [];

// دخل يدوي
const manualIncome = safeExpRows.filter(
  (r) => r.direction === "income"
);

// مصروفات فقط
const onlyExpenses = safeExpRows.filter(
  (r) => r.direction !== "income"
);

// أضف الدخل اليدوي إلى سندات القبض
const allPayments = [
  ...finalPayments,
  ...manualIncome.map((r) => ({
    id: `income-${r.id}`,
    pay_date: r.expense_date,
    invoice_number: "-",
    amount: r.amount,
    note: r.category,
  })),
];

setPayments(allPayments);

setExpenses(onlyExpenses);

setTotalPayments(
  allPayments.reduce(
    (s, r) => s + Number(r.amount || 0),
    0
  )
);

setTotalExpenses(
  onlyExpenses.reduce(
    (s, r) => s + Number(r.amount || 0),
    0
  )
);
  }

  useEffect(() => {
    loadReport();
  }, [fromDate, toDate]);

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body * { visibility: hidden; }
          #report-content, #report-content * { visibility: visible; }
          #report-content { position: absolute; left: 0; top: 0; width: 100%; }
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

        <div id="report-content">
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
      </div>
    </>
  );
}
