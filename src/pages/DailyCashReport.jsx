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
    // جلب السندات مع استبعاد المرتجعات (assuming is_refund is a boolean column)
    const { data: payRows = [] } = await supabase
      .from("payments")
      .select("id, amount, invoice_id, note, pay_date, method, is_refund")
      .gte("pay_date", fromDate)
      .lte("pay_date", toDate)
      .neq("method", "from_balance")
      // استبعاد المرتجعات لتجنب تكرار الحساب
      .neq("is_refund", true) 
      .order("pay_date", { ascending: false });

    const invoiceIds = [...new Set(payRows.map((p) => p.invoice_id).filter(Boolean))];
    let invoiceMap = {};
    if (invoiceIds.length > 0) {
      const { data: invRows = [] } = await supabase.from("invoices").select("id, number").in("id", invoiceIds);
      invoiceMap = Object.fromEntries(invRows.map((i) => [i.id, i.number]));
    }

    const finalPayments = payRows.map((p) => ({
      ...p,
      invoice_number: invoiceMap[p.invoice_id] || "-"
    }));

    const { data: expRows = [] } = await supabase
      .from("expenses")
      .select("*")
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("expense_date", { ascending: false });

    setPayments(finalPayments);
    setExpenses(expRows);
    
    // إجمالي القبض (بدون خصم المصروفات)
    setTotalPayments(finalPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    setTotalExpenses(expRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  }

  useEffect(() => {
    loadReport();
  }, [fromDate, toDate]);

  return (
    <div style={{ padding: 20 }}>
      {/* ... (نفس كود المدخلات السابق) ... */}
      
      <h1>تقرير اليومية</h1>
      
      {/* عرض إجمالي القبض قبل المصروفات */}
      <div style={{ background: "#e0f7fa", padding: "10px", borderRadius: "8px", marginBottom: "20px" }}>
        <h2>إجمالي القبض (قبل المصروفات): {totalPayments.toLocaleString()}</h2>
      </div>

      <h2>سندات القبض</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f4f4f4" }}>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>التاريخ</th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>الفاتورة</th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>المبلغ</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td style={{ border: "1px solid #ccc", padding: 8 }}>{p.pay_date}</td>
              <td style={{ border: "1px solid #ccc", padding: 8 }}>{p.invoice_number}</td>
              <td style={{ border: "1px solid #ccc", padding: 8 }}>{Number(p.amount).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>المصروفات</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f4f4f4" }}>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>التاريخ</th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>البند</th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>المبلغ</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id}>
              <td style={{ border: "1px solid #ccc", padding: 8 }}>{e.expense_date}</td>
              <td style={{ border: "1px solid #ccc", padding: 8 }}>{e.category}</td>
              <td style={{ border: "1px solid #ccc", padding: 8 }}>{Number(e.amount).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      
      <div style={{ marginTop: 20, fontWeight: "bold", fontSize: "1.2em" }}>
        صافي الصندوق: {(totalPayments - totalExpenses).toLocaleString()}
      </div>
    </div>
  );
}
