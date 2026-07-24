import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function CashBoxReport() {
  const today = new Date().toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);

  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);

  const [totalPayments, setTotalPayments] = useState(0);
  const [operatingExpenses, setOperatingExpenses] = useState(0);
  const [bankDeposits, setBankDeposits] = useState(0);

  async function loadReport() {
    const {
  data: payRows = [],
  count,
  error,
} = await supabase
  .from("payments") .select("id,pay_date,amount", { count: "exact" }) .order("pay_date", { ascending: true })
      console.log(payRows.map(r => r.pay_date));
  .select("*", { count: "exact" })
  .neq("method", "from_balance")
  .not("note", "ilike", "%[WRITEOFF]%")
  .gte("pay_date", fromDate)
  .lte("pay_date", toDate);

console.log("Returned rows =", payRows.length);
console.log("Count =", count);
console.log("Error =", error);

    const { data: expRows = [] } = await supabase
      .from("expenses")
      .select("*")
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate);

    const manualIncome = expRows.filter(
  (r) => r.direction === "income"
);

setPayments([
  ...payRows,
  ...manualIncome.map((r) => ({
    id: `income-${r.id}`,
    pay_date: r.expense_date,
    amount: r.amount,
    invoice_id: null,
    note: r.category,
  })),
]);
    setExpenses(expRows);
    
    const totalPay = payRows.reduce(
      (sum, r) => sum + Number(r.amount || 0),
      0
    );
    console.log("payRows count =", payRows.length);
console.log("totalPay =", totalPay);
    const totalManualIncome = manualIncome.reduce(
  (sum, r) => sum + Number(r.amount || 0),
  0
);

    const BANK_CATEGORIES = [   "ايداع البنك",   "ايداع للبنك",   "ايداع في البنك",   "إيداع البنك", ];

const bankRows = expRows.filter(
  (e) => BANK_CATEGORIES.includes(e.category)
);

const normalRows = expRows.filter(
  (e) => !BANK_CATEGORIES.includes(e.category)
);

    

    const totalBank = bankRows.reduce(
      (sum, r) => sum + Number(r.amount || 0),
      0
    );

    const totalNormal = normalRows.reduce(
      (sum, r) => sum + Number(r.amount || 0),
      0
    );

    setTotalPayments(totalPay + totalManualIncome);
    console.log("Displayed total =", totalPay + totalManualIncome);
    setBankDeposits(totalBank);
    setOperatingExpenses(totalNormal);
  }

  useEffect(() => {
    loadReport();
  }, [fromDate, toDate]);

  const cashBalance =
    totalPayments -
    operatingExpenses -
    bankDeposits;

  return (
    <>
      <style>
        {`
          @media print {
            .no-print {
              display:none !important;
            }

            aside {
              display:none !important;
            }

            @page {
              size:A4;
              margin:10mm;
            }
          }

          table {
            width:100%;
            border-collapse:collapse;
          }

          th,
          td {
            border:1px solid #ccc;
            padding:8px;
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
            flexWrap: "wrap"
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

          <button onClick={() => window.print()}>
            طباعة
          </button>
        </div>

        <h1>كشف الصندوق</h1>

        <h3>
          من {fromDate} إلى {toDate}
        </h3>

        <hr />

        <h2>ملخص الصندوق</h2>

        <table>
          <tbody>
            <tr>
              <td>إجمالي سندات القبض</td>
              <td>
                {totalPayments.toLocaleString()}
              </td>
            </tr>

            <tr>
              <td>المصروفات التشغيلية</td>
              <td>
                {operatingExpenses.toLocaleString()}
              </td>
            </tr>

            <tr>
              <td>إيداعات البنك</td>
              <td>
                {bankDeposits.toLocaleString()}
              </td>
            </tr>

            <tr
              style={{
                fontWeight: "bold",
                background: "#f3f4f6"
              }}
            >
              <td>الرصيد المتبقي بالصندوق</td>
              <td>
                {cashBalance.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <br />

        <h2>عمليات البنك</h2>

        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>البند</th>
              <th>المبلغ</th>
              <th>الملاحظات</th>
            </tr>
          </thead>

          <tbody>
            {expenses
              .filter(
                (e) =>
                  e.category === "ايداع للبنك" ||
                  e.category === "ايداع في البنك"
              )
              .map((e) => (
                <tr key={e.id}>
                  <td>{e.expense_date}</td>
                  <td>{e.category}</td>
                  <td>
                    {Number(e.amount).toLocaleString()}
                  </td>
                  <td>{e.note || "-"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
