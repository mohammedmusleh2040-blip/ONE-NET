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
.select(`         id,
        amount,
        invoice_id,
        note,
        pay_date
      `)
.gte("pay_date", fromDate)
.lte("pay_date", toDate)
.order("id", { ascending: false });

```
const invoiceIds = [
  ...new Set(
    (payRows || [])
      .map((p) => p.invoice_id)
      .filter(Boolean)
  ),
];

let invoiceMap = {};

if (invoiceIds.length) {
  const { data: invRows } = await supabase
    .from("invoices")
    .select("id,number")
    .in("id", invoiceIds);

  invoiceMap = Object.fromEntries(
    (invRows || []).map((i) => [i.id, i.number])
  );
}

const finalPayments = (payRows || []).map((p) => ({
  ...p,
  invoice_number: invoiceMap[p.invoice_id] || "-",
}));

const { data: expRows } = await supabase
  .from("expenses")
  .select("*")
  .gte("expense_date", fromDate)
  .lte("expense_date", toDate)
  .order("id", { ascending: false });

setPayments(finalPayments);
setExpenses(expRows || []);

setTotalPayments(
  finalPayments.reduce(
    (s, r) => s + Number(r.amount || 0),
    0
  )
);

setTotalExpenses(
  (expRows || []).reduce(
    (s, r) => s + Number(r.amount || 0),
    0
  )
);
```

}

useEffect(() => {
loadReport();
}, [fromDate, toDate]);

function printReport() {
window.print();
}

return (
<> <style>
{`
@media print {

```
      @page {
        size: A4 portrait;
        margin: 10mm;
      }

      body {
        margin: 0;
        background: white;
      }

      .no-print {
        display: none !important;
      }

      #daily-report {
        width: 100%;
        direction: rtl;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        page-break-inside: avoid;
      }

      tr {
        page-break-inside: avoid;
      }

      th,td {
        border: 1px solid #000;
        padding: 6px;
      }
    }
  `}
  </style>

  <div className="card">

    <div
      className="no-print"
      style={{
        display: "flex",
        gap: 10,
        marginBottom: 20,
        flexWrap: "wrap"
      }}
    >
      <input
        type="date"
        value={fromDate}
        onChange={(e) =>
          setFromDate(e.target.value)
        }
      />

      <input
        type="date"
        value={toDate}
        onChange={(e) =>
          setToDate(e.target.value)
        }
      />

      <button onClick={loadReport}>
        تحديث
      </button>

      <button onClick={printReport}>
        طباعة
      </button>
    </div>

    <div
      id="daily-report"
      style={{
        background: "#fff",
        padding: 20,
        borderRadius: 10,
        direction: "rtl"
      }}
    >
      <h1 style={{ textAlign: "center" }}>
        تقرير اليومية
      </h1>

      <h3 style={{ textAlign: "center" }}>
        من {fromDate} إلى {toDate}
      </h3>

      <hr />

      <h2>سندات القبض</h2>

      <table>
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
              <td>
                {Number(
                  p.amount
                ).toLocaleString()}
              </td>
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

      <h2>المصروفات</h2>

      <table>
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
              <td>
                {Number(
                  e.amount
                ).toLocaleString()}
              </td>
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

      <h2
        style={{
          textAlign: "center",
          color: "#0a7a2f"
        }}
      >
        الصافي :
        {" "}
        {(totalPayments - totalExpenses).toLocaleString()}
      </h2>
    </div>
  </div>
</>
```

);
}
