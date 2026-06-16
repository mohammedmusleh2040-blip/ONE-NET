import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function DailyCashReport() {
  const today = new Date().toISOString().slice(0, 10);

  const [reportDate, setReportDate] = useState(today);

  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);

  const [totalPayments, setTotalPayments] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);

  async function loadReport() {
    // سندات القبض
    const { data: payRows } = await supabase
      .from("payments")
      .select(`
        id,
        amount,
        invoice_id,
        note,
        pay_date
      `)
      .eq("pay_date", reportDate)
      .order("id", { ascending: false });

    // جلب أرقام الفواتير
    const invoiceIds = [...new Set((payRows || [])
      .map(p => p.invoice_id)
      .filter(Boolean))];

    let invoiceMap = {};

    if (invoiceIds.length) {
      const { data: invRows } = await supabase
        .from("invoices")
        .select("id,number")
        .in("id", invoiceIds);

      invoiceMap = Object.fromEntries(
        (invRows || []).map(i => [i.id, i.number])
      );
    }

    const finalPayments = (payRows || []).map(p => ({
      ...p,
      invoice_number: invoiceMap[p.invoice_id] || "-"
    }));

    // المصروفات
    const { data: expRows } = await supabase
      .from("expenses")
      .select("*")
      .eq("expense_date", reportDate)
      .order("id", { ascending: false });

    setPayments(finalPayments);
    setExpenses(expRows || []);

    setTotalPayments(
      finalPayments.reduce((s, r) => s + Number(r.amount || 0), 0)
    );

    setTotalExpenses(
      (expRows || []).reduce((s, r) => s + Number(r.amount || 0), 0)
    );
  }

  useEffect(() => {
    loadReport();
  }, [reportDate]);

  function printReport() {
    window.print();
  }

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 20
        }}
      >
        <input
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
        />

        <button onClick={loadReport}>
          تحديث
        </button>

        <button onClick={printReport}>
          طباعة
        </button>
      </div>

      <div id="daily-report">

        <h2>تقرير اليومية</h2>

        <h3>التاريخ: {reportDate}</h3>

        <hr />

        <h3>سندات القبض</h3>

        <table className="table">
          <thead>
            <tr>
              <th>الفاتورة</th>
              <th>المبلغ</th>
            </tr>
          </thead>

          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{p.invoice_number}</td>
                <td>{Number(p.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>
          إجمالي القبض :
          {" "}
          {totalPayments.toLocaleString()}
        </h3>

        <hr />

        <h3>المصروفات</h3>

        <table className="table">
          <thead>
            <tr>
              <th>البند</th>
              <th>المبلغ</th>
            </tr>
          </thead>

          <tbody>
            {expenses.map((e) => (
              <tr key={e.id}>
                <td>{e.category}</td>
                <td>{Number(e.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>
          إجمالي المصروفات :
          {" "}
          {totalExpenses.toLocaleString()}
        </h3>

        <hr />

        <h2>
          الصافي :
          {" "}
          {(totalPayments - totalExpenses).toLocaleString()}
        </h2>

      </div>
    </div>
  );
}
