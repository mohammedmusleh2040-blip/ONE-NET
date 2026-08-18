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
    const { data: payRows = [] } = await supabase
      .from("payments")
      .select("id, amount, invoice_id, note, pay_date")
      .gte("pay_date", fromDate)
      .lte("pay_date", toDate)
      .order("id", { ascending: false });

    // اجلب الفواتير المرتجعة في نفس الفترة أيضًا.
    // المرتجع الجزئي لا ينشئ سند قبض سالب، لذلك نضيفه كتسوية سالبة
    // حتى لا تظهر فاتورة الاستبدال كأنها قبض جديد كامل.
    const { data: refundRows = [] } = await supabase
      .from("invoices")
      .select("id, number, total_after_discount, invoice_date, invoice_datetime, is_refund, note")
      .eq("is_refund", true)
      .gte("invoice_date", fromDate)
      .lte("invoice_date", toDate)
      .order("id", { ascending: false });

    const invoiceIds = [
      ...new Set(
        payRows
          .map((p) => p.invoice_id)
          .filter(Boolean)
      ),
    ];

    let invoiceMap = {};

    if (invoiceIds.length > 0) {
      const { data: invRows = [] } = await supabase
        .from("invoices")
        .select("id, number")
        .in("id", invoiceIds);

      invoiceMap = Object.fromEntries(
        invRows.map((i) => [i.id, i.number])
      );
    }

    const normalPayments = payRows.map((p) => ({
      ...p,
      invoice_number: invoiceMap[p.invoice_id] || "-",
      is_refund: false
    }));

    // أضف المرتجع كحركة سالبة في سندات القبض.
    // هذا يجعل الاستبدال 8400- / 8400+ = صفر في تقرير اليومية.
    const refundPayments = refundRows
      .map((r) => ({
        id: `refund-${r.id}`,
        amount: Number(r.total_after_discount || 0),
        invoice_id: r.id,
        invoice_number: r.number || `REF-${String(r.id).padStart(6, "0")}`,
        note: r.note || "مرتجع مبيعات",
        pay_date: r.invoice_date,
        is_refund: true
      }))
      .filter((r) => r.amount < 0);

    const finalPayments = [...normalPayments, ...refundPayments]
      .sort((a, b) => String(b.pay_date || "").localeCompare(String(a.pay_date || "")));

    const { data: expRows = [] } = await supabase
      .from("expenses")
      .select("*")
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("id", { ascending: false });

    // المرتجع الكامل الذي لديه مصروف "مرتجع مبيعات" لا نضيفه مرة ثانية كسالب في القبض،
    // لأن أثره النقدي موجود أصلًا في المصروفات. أما المرتجع الجزئي بدون مصروف فيظهر كسالب هنا.
    const fullRefundInvoiceNumbers = new Set(
      (expRows || [])
        .filter((e) =>
          String(e.category || "") === "مرتجع مبيعات" ||
          String(e.expense_group || "") === "sales_refund" ||
          String(e.expense_type || "") === "refund"
        )
        .map((e) => {
          const m = String(e.note || "").match(/الفاتورة\s+([^\s]+)/);
          return m ? m[1] : "";
        })
        .filter(Boolean)
    );

    const adjustedRefundPayments = refundPayments.filter(
      (r) => !fullRefundInvoiceNumbers.has(String(r.invoice_number || ""))
    );

    const adjustedFinalPayments = [...normalPayments, ...adjustedRefundPayments]
      .sort((a, b) => String(b.pay_date || "").localeCompare(String(a.pay_date || "")));

    setPayments(adjustedFinalPayments);
    setExpenses(expRows);

    setTotalPayments(
      finalPayments.reduce(
        (sum, row) => sum + Number(row.amount || 0),
        0
      )
    );

    setTotalExpenses(
      expRows.reduce(
        (sum, row) => sum + Number(row.amount || 0),
        0
      )
    );
  }

  useEffect(() => {
    loadReport();
  }, [fromDate, toDate]);

  function printReport() {
    window.print();
  }

  return (
    <>
      <style>
        {`
          @media print {

            .no-print {
              display: none !important;
            }

            aside {
              display: none !important;
            }

            main {
              padding: 0 !important;
              margin: 0 !important;
            }

            body {
              background: white !important;
            }

            #daily-report {
              width: 100% !important;
              margin: 0 !important;
            }

            table {
              width: 100% !important;
            }

            @page {
              size: A4 portrait;
              margin: 10mm;
            }
          }
        `}
      </style>

      <div style={{ padding: 20 }}>
        <div
          className="no-print"
          style={{
            display: "flex",
            gap: 10,
            marginBottom: 20,
            flexWrap: "wrap",
            alignItems: "center"
          }}
        >
          <label>
            من
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>

          <label>
            إلى
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>

          <button onClick={loadReport}>
            تحديث
          </button>

          <button onClick={printReport}>
            طباعة
          </button>
        </div>

        <div id="daily-report">
          <h1>تقرير اليومية</h1>

          <h3>
            من {fromDate} إلى {toDate}
          </h3>

          <hr />

          <h2>سندات القبض</h2>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: 20
            }}
          >
            <thead>
              <tr>
                <th style={{ border: "1px solid #000", padding: 8 }}>
                  الفاتورة
                </th>
                <th style={{ border: "1px solid #000", padding: 8 }}>
                  المبلغ
                </th>
              </tr>
            </thead>

            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td style={{ border: "1px solid #000", padding: 8 }}>
                    {p.invoice_number}
                  </td>
                  <td style={{ border: "1px solid #000", padding: 8 }}>
                    {Number(p.amount).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>
            إجمالي القبض: {totalPayments.toLocaleString()}
          </h3>

          <hr />

          <h2>المصروفات</h2>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: 20
            }}
          >
            <thead>
              <tr>
                <th style={{ border: "1px solid #000", padding: 8 }}>
                  البند
                </th>
                <th style={{ border: "1px solid #000", padding: 8 }}>
                  المبلغ
                </th>
              </tr>
            </thead>

            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td style={{ border: "1px solid #000", padding: 8 }}>
                    {e.category}
                  </td>
                  <td style={{ border: "1px solid #000", padding: 8 }}>
                    {Number(e.amount).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>
            إجمالي المصروفات: {totalExpenses.toLocaleString()}
          </h3>

          <hr />

          <h2>
            الصافي: {(totalPayments - totalExpenses).toLocaleString()}
          </h2>
        </div>
      </div>
    </>
  );
}
