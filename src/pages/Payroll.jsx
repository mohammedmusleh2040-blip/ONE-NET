import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Payroll() {

  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

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

                <button>

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
