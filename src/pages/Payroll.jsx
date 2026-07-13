import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Payroll() {

  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [paymentDate, setPaymentDate] = useState(
  new Date().toISOString().split("T")[0]
);
  const [paymentAmount, setPaymentAmount] = useState(0);

const [paymentMethod, setPaymentMethod] = useState("cash");

  const [rows, setRows] = useState([]);

  useEffect(() => {
    loadPayroll();
  }, [month, year]);

  async function loadPayroll() {

    const { data: employees } = await supabase
      .from("employees")
      .select("*")
      .eq("is_active", true)
      .order("name");

    const result = [];

    for (const emp of employees || []) {

      const { data: advances } = await supabase
        .from("employee_advances")
        .select("amount")
        .eq("employee_id", emp.id)
        .eq("settled", false);

      const totalAdvance =
        (advances || []).reduce(
          (s, a) => s + Number(a.amount),
          0
        );

      result.push({
        ...emp,
        allowances: 0,
        deductions: 0,
        advances: totalAdvance,
        net_salary:
          Number(emp.salary)
          - totalAdvance,
      });

    }

    setRows(result);

  }
  async function paySalary(emp) {
    if (paymentAmount > emp.net_salary) {
  alert("المبلغ أكبر من صافي الراتب");
  return;
}

  // التحقق من عدم صرف الراتب سابقاً
  const { data: paid } = await supabase
    .from("salary_payments")
    .select("id, amount_paid, net_salary")
    .eq("employee_id", emp.id)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (paid && paid.amount_paid >= paid.net_salary) {
    alert("تم صرف الراتب بالكامل");
    return;
}

    let paidAmount = paid ? paid.amount_paid : 0;
let remaining = emp.net_salary - paidAmount;

const amountToPay =
  paymentAmount > 0 ? paymentAmount : remaining;
    if (amountToPay > remaining) {
  alert("المبلغ أكبر من الرصيد المتبقي للراتب");
  return;
}
  // حفظ سجل الراتب
    const { error } = await supabase
    .from("salary_payments")
    .insert({
      employee_id: emp.id,
      year,
      month,
      basic_salary: emp.salary,
      allowances: emp.allowances,
      deductions: emp.deductions,
      advances: emp.advances,
      net_salary: emp.net_salary,
      amount_paid: paidAmount + amountToPay,
      payment_method: paymentMethod, paid_at: paymentDate
    });

  if (error) {
    alert(error.message);
    return;
  }

  // تسجيل مصروف الراتب
  await supabase
    .from("expenses")
    .insert({
  expense_date: paymentDate,
  category: "راتب موظف",
  amount: amountToPay,
  direction: "expense",
  method: paymentMethod,
  note: `راتب ${emp.name} - ${month}/${year}`,
  employee_id: emp.id,
  expense_type: "salary",
  expense_group: "Payroll"
});

  // إذا توجد سلف
  if (emp.advances > 0) {

    // تسجيل دخل سداد السلفة
    await supabase
      .insert({
  expense_date: new Date().toISOString().split("T")[0],
  category: "سداد سلفة موظف",
  amount: emp.advances,
  direction: "income",
  method: "cash",
  note: `سداد سلفة ${emp.name}`,
  employee_id: emp.id,
  expense_type: "advance_settlement",
  expense_group: "Payroll"
});

    // تحديث السلف إلى مسددة
    await supabase
      .from("employee_advances")
      .update({ settled: true })
      .eq("employee_id", emp.id)
      .eq("settled", false);

  }

  alert("تم صرف الراتب بنجاح");

  loadPayroll();
}

  return (
    <div style={{padding:20}}>

      <h2>💰 إدارة الرواتب</h2>

      <div style={{display:"flex",gap:15,marginBottom:20}}>

        <input
          type="number"
          value={month}
          onChange={(e)=>setMonth(Number(e.target.value))}
        />

        <input
          type="number"
          value={year}
          onChange={(e)=>setYear(Number(e.target.value))}
        />
        
        <input
  type="date"
  value={paymentDate}
  onChange={(e) => setPaymentDate(e.target.value)}
/>
        <select
  value={paymentMethod}
  onChange={(e) => setPaymentMethod(e.target.value)}
>
  <option value="cash">نقد</option>
  <option value="bank">تحويل بنكي</option>
</select>
        <input
  type="number"
  value={paymentAmount}
  onChange={(e) => setPaymentAmount(Number(e.target.value))}
  placeholder="مبلغ الصرف"
/>

      </div>

      <table
        border="1"
        width="100%"
        cellPadding="8"
      >

        <thead>

          <tr>

            <th>الموظف</th>

            <th>الراتب</th>

            <th>السلف</th>

            <th>البدلات</th>

            <th>الخصومات</th>

            <th>الصافي</th>

            <th>الإجراء</th>

          </tr>

        </thead>

        <tbody>

          {rows.map(emp=>(
            <tr key={emp.id}>

              <td>{emp.name}</td>

              <td>{emp.salary}</td>

              <td>{emp.advances}</td>

              <td>{emp.allowances}</td>

              <td>{emp.deductions}</td>

              <td>{emp.net_salary}</td>

              <td>

                <button
  onClick={() => paySalary(emp)}
>
  صرف الراتب
</button>

              </td>

            </tr>
          ))}

        </tbody>

      </table>

    </div>
  );

}
