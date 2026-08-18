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
    // سندات القبض الفعلية
    const { data: payRows, error: payError } = await supabase
      .from("payments")
      .select("id, amount, invoice_id, note, pay_date, method")
      .gte("pay_date", fromDate)
      .lte("pay_date", toDate)
      .neq("method", "from_balance")
      .order("pay_date", { ascending: false });

    if (payError) console.error("Payment Error:", payError);

    const safePayRows = (payRows || []).filter(
      (p) => !(p.note || "").includes("[WRITEOFF]")
    );

    const invoiceIds = [
      ...new Set(safePayRows.map((p) => p.invoice_id).filter(Boolean)),
    ];

    let invoiceMap = {};
    let invoiceRows = [];

    if (invoiceIds.length > 0) {
      const { data: invRows, error: invError } = await supabase
        .from("invoices")
        .select("id, number, is_refund, total_after_discount, customer_id")
        .in("id", invoiceIds);

      if (invError) console.error("Invoice Error:", invError);
      invoiceRows = invRows || [];
    }

    // تحميل أسماء العملاء للحفاظ على نفس شكل التقرير القديم
    const customerIds = [
      ...new Set(invoiceRows.map((i) => i.customer_id).filter(Boolean)),
    ];

    let customerMap = {};

    if (customerIds.length > 0) {
      const { data: customerRows, error: customerError } = await supabase
        .from("customers")
        .select("id, name")
        .in("id", customerIds);

      if (customerError) console.error("Customer Error:", customerError);

      customerMap = Object.fromEntries(
        (customerRows || []).map((c) => [c.id, c.name])
      );
    }

    invoiceMap = Object.fromEntries(
      invoiceRows.map((i) => [
        i.id,
        {
          number: i.number,
          is_refund: i.is_refund,
          customer_id: i.customer_id,
          customer_name: customerMap[i.customer_id] || "-",
          total_after_discount: Number(i.total_after_discount || 0),
        },
      ])
    );

    // سندات القبض العادية + اسم العميل
    const normalPayments = safePayRows
      .map((p) => ({
        ...p,
        invoice_number: invoiceMap[p.invoice_id]?.number || "-",
        customer_name: invoiceMap[p.invoice_id]?.customer_name || "-",
        is_refund: invoiceMap[p.invoice_id]?.is_refund || false,
      }))
      .filter((p) => !p.is_refund);

    // المصروفات
    const { data: expRows, error: expError } = await supabase
      .from("expenses")
      .select("*")
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("expense_date", { ascending: false });

    if (expError) console.error("Expense Error:", expError);

    const safeExpRows = expRows || [];

    // الدخل اليدوي
    const manualIncome = safeExpRows.filter(
      (r) => r.direction === "income"
    );

    // مصروفات فقط
    const onlyExpenses = safeExpRows.filter(
      (r) => r.direction !== "income"
    );

    /*
      المرتجع/الاستبدال:
      إذا كانت هناك فاتورة مرتجع سالبة ولا يوجد لها مصروف نقدي "مرتجع مبيعات"
      في نفس الفترة، نعرضها كسطر سالب في سندات القبض.
      بهذه الطريقة:
        INV-000520   +8,400
        REF-000519   -8,400
      ويكون تأثير الاستبدال على اليومية = صفر.

      وإذا كان المرتجع النقدي مسجلاً أيضاً كمصروف "مرتجع مبيعات"،
      لا نكرر المبلغ مرتين.
    */
    const refundExpenses = onlyExpenses.filter(
      (r) =>
        r.expense_type === "refund" ||
        r.expense_group === "sales_refund" ||
        String(r.category || "").includes("مرتجع مبيعات")
    );

    const refundExpenseNotes = refundExpenses.map((r) =>
      String(r.note || "")
    );

    const refundRows = [];

    const { data: refundInvoices, error: refundError } = await supabase
      .from("invoices")
      .select("id, number, is_refund, total_after_discount, customer_id, invoice_date")
      .eq("is_refund", true)
      .gte("invoice_date", fromDate)
      .lte("invoice_date", `${toDate}T23:59:59`);

    if (refundError) console.error("Refund Invoice Error:", refundError);

    const refundCustomerIds = [
      ...new Set((refundInvoices || []).map((i) => i.customer_id).filter(Boolean)),
    ];

    let refundCustomerMap = {};

    if (refundCustomerIds.length > 0) {
      const { data: refundCustomers, error: refundCustomerError } = await supabase
        .from("customers")
        .select("id, name")
        .in("id", refundCustomerIds);

      if (refundCustomerError) {
        console.error("Refund Customer Error:", refundCustomerError);
      }

      refundCustomerMap = Object.fromEntries(
        (refundCustomers || []).map((c) => [c.id, c.name])
      );
    }

    for (const r of refundInvoices || []) {
      const refundNumber = String(r.number || "");
      const refundAmount = Number(r.total_after_discount || 0);

      // المرتجع يكون سالباً في التقرير.
      if (refundAmount >= 0) continue;

      // إذا كان له مصروف نقدي مسجل، نترك المصروف هو الذي يحسب الخروج النقدي
      // حتى لا يتكرر المبلغ مرتين.
      const alreadyCashRefunded = refundExpenseNotes.some((note) =>
        note.includes(refundNumber)
      );

      if (alreadyCashRefunded) continue;

      refundRows.push({
        id: `refund-${r.id}`,
        pay_date: String(r.invoice_date || "").slice(0, 10),
        invoice_number: refundNumber || "-",
        customer_name: refundCustomerMap[r.customer_id] || "-",
        amount: refundAmount,
        note: "مرتجع / استبدال",
        is_refund: true,
      });
    }

    // أضف الدخل اليدوي إلى سندات القبض
    const allPayments = [
      ...normalPayments,
      ...refundRows,
      ...manualIncome.map((r) => ({
        id: `income-${r.id}`,
        pay_date: r.expense_date,
        invoice_number: "-",
        customer_name: "-",
        amount: Number(r.amount || 0),
        note: r.category,
      })),
    ].sort((a, b) =>
      String(b.pay_date || "").localeCompare(String(a.pay_date || ""))
    );

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
                <th>العميل</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.pay_date}</td>
                  <td>{p.invoice_number}</td>
                  <td>{p.customer_name || "-"}</td>
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
                <th>الملاحظات</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.expense_date}</td>
                  <td>{e.category}</td>
                  <td>{e.note || "-"}</td>
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
