import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const emptyForm = {
  id: null,
  employee_id: "",
  amount: "",
  advance_date: new Date().toISOString().substring(0,10),
  notes: "",
  settled: false,
};

export default function EmployeeAdvances() {

  const [employees,setEmployees]=useState([]);
  const [rows,setRows]=useState([]);
  const [search,setSearch]=useState("");
  const [form,setForm]=useState(emptyForm);

  useEffect(()=>{
    loadEmployees();
    loadAdvances();
  },[]);

  async function loadEmployees(){

    const {data}=await supabase
      .from("employees")
      .select("id,name")
      .eq("is_active",true)
      .order("name");

    setEmployees(data||[]);

  }

  async function loadAdvances(){

    const {data}=await supabase
      .from("employee_advances")
      .select(`
        *,
        employees(name)
      `)
      .order("advance_date",{ascending:false});

    setRows(data||[]);

  }
  const filtered = useMemo(() => {

  return rows.filter((r) => {

    const emp = r.employees?.name || "";

    return emp.toLowerCase().includes(search.toLowerCase());

  });

}, [rows, search]);

async function saveAdvance() {

  if (!form.employee_id) {
    alert("اختر الموظف");
    return;
  }

  if (!form.amount) {
    alert("أدخل مبلغ السلفة");
    return;
  }

  const payload = {
    employee_id: Number(form.employee_id),
    amount: Number(form.amount),
    advance_date: form.advance_date,
    notes: form.notes,
    settled: form.settled,
  };

  let error;

  if (form.id) {

    ({ error } = await supabase
      .from("employee_advances")
      .update(payload)
      .eq("id", form.id));

  } else {

    ({ error } = await supabase
      .from("employee_advances")
      .insert(payload));

  }

  if (error) {
    alert(error.message);
    return;
  }

  setForm(emptyForm);

  loadAdvances();

}

function editAdvance(row) {

  setForm({

    id: row.id,

    employee_id: row.employee_id,

    amount: row.amount,

    advance_date: row.advance_date,

    notes: row.notes || "",

    settled: row.settled,

  });

}

async function deleteAdvance(id) {

  if (!window.confirm("حذف السلفة؟"))
    return;

  await supabase
    .from("employee_advances")
    .delete()
    .eq("id", id);

  loadAdvances();

}const totalAdvances = rows.reduce(
  (s, r) => s + Number(r.amount || 0),
  0
);

const unsettledCount = rows.filter(
  (r) => !r.settled
).length;

return (

<div style={{padding:20}}>

<h2>💵 سلف الموظفين</h2>

<div
style={{
display:"grid",
gridTemplateColumns:"repeat(3,1fr)",
gap:15,
marginBottom:20
}}
>

<div className="card">
<h3>عدد السلف</h3>
<h1>{rows.length}</h1>
</div>

<div className="card">
<h3>غير المسددة</h3>
<h1>{unsettledCount}</h1>
</div>

<div className="card">
<h3>إجمالي السلف</h3>
<h1>{totalAdvances.toLocaleString()}</h1>
</div>

</div>

<input

placeholder="بحث باسم الموظف"

value={search}

onChange={(e)=>setSearch(e.target.value)}

style={{
width:"100%",
padding:12,
marginBottom:20
}}

/>

<div
style={{
display:"grid",
gridTemplateColumns:"2fr 1fr 1fr",
gap:10,
marginBottom:15
}}
>

<select
value={form.employee_id}
onChange={(e)=>setForm({...form,employee_id:e.target.value})}
>

<option value="">اختر الموظف</option>

{employees.map(emp=>(
<option key={emp.id} value={emp.id}>
{emp.name}
</option>
))}

</select>

<input
type="number"
placeholder="مبلغ السلفة"
value={form.amount}
onChange={(e)=>setForm({...form,amount:e.target.value})}
/>

<input
type="date"
value={form.advance_date}
onChange={(e)=>setForm({...form,advance_date:e.target.value})}
/>

</div>

<textarea

rows={3}

placeholder="ملاحظات"

value={form.notes}

onChange={(e)=>setForm({...form,notes:e.target.value})}

style={{
width:"100%",
marginBottom:15
}}

/>

<label>

<input

type="checkbox"

checked={form.settled}

onChange={(e)=>setForm({

...form,

settled:e.target.checked

})}

/>

تم تسديد السلفة

</label>

<div style={{marginTop:15}}>

<button onClick={saveAdvance}>

💾 حفظ

</button>

</div>
<div style={{ marginTop: 25 }}>

<table
  style={{
    width: "100%",
    borderCollapse: "collapse",
    background: "#fff",
  }}
>

<thead>

<tr style={{background:"#f3f4f6"}}>

<th style={{padding:10}}>الموظف</th>

<th>المبلغ</th>

<th>التاريخ</th>

<th>الحالة</th>

<th>ملاحظات</th>

<th>الإجراءات</th>

</tr>

</thead>

<tbody>

{filtered.map(row=>(

<tr
key={row.id}
style={{borderBottom:"1px solid #eee"}}
>

<td style={{padding:10}}>
{row.employees?.name}
</td>

<td>
{Number(row.amount).toLocaleString()}
</td>

<td>
{row.advance_date}
</td>

<td>

<span
style={{
color:row.settled ? "green":"red",
fontWeight:"bold"
}}
>

{row.settled ? "مسددة":"غير مسددة"}

</span>

</td>

<td>
{row.notes}
</td>

<td>

<button
onClick={()=>editAdvance(row)}
style={{marginLeft:8}}
>

✏️ تعديل

</button>

<button
onClick={()=>deleteAdvance(row.id)}
>

🗑 حذف

</button>

</td>

</tr>

))}

</tbody>

</table>

</div>

</div>

);

}
