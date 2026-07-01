import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const emptyEmployee = {
  id: null,
  name: "",
  phone: "",
  job_title: "",
  salary: "",
  notes: "",
  is_active: true,
};

export default function Employees() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyEmployee);

  async function loadEmployees() {
    setLoading(true);

    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("name");

    if (!error) {
      setRows(data || []);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;

    return rows.filter((r) => {
      return (
        (r.name || "").toLowerCase().includes(search.toLowerCase()) ||
        (r.phone || "").toLowerCase().includes(search.toLowerCase()) ||
        (r.job_title || "").toLowerCase().includes(search.toLowerCase())
      );
    });
  }, [rows, search]);

  const totalEmployees = rows.length;

  const activeEmployees = rows.filter((x) => x.is_active).length;

  const inactiveEmployees = rows.filter((x) => !x.is_active).length;

  const totalSalary = rows.reduce(
    (s, x) => s + Number(x.salary || 0),
    0
  );
  async function saveEmployee() {

  if (!form.name.trim()) {
    alert("يرجى إدخال اسم الموظف");
    return;
  }

  const payload = {
    name: form.name,
    phone: form.phone,
    job_title: form.job_title,
    salary: Number(form.salary || 0),
    notes: form.notes,
    is_active: form.is_active,
  };

  let error;

  if (form.id) {

    ({ error } = await supabase
      .from("employees")
      .update(payload)
      .eq("id", form.id));

  } else {

    ({ error } = await supabase
      .from("employees")
      .insert(payload));

  }

  if (error) {
    alert(error.message);
    return;
  }

  clearForm();

  loadEmployees();

}

function clearForm() {

  setForm({
    id: null,
    name: "",
    phone: "",
    job_title: "",
    salary: "",
    notes: "",
    is_active: true,
  });

}

function editEmployee(emp) {

  setForm({
    id: emp.id,
    name: emp.name || "",
    phone: emp.phone || "",
    job_title: emp.job_title || "",
    salary: emp.salary || "",
    notes: emp.notes || "",
    is_active: emp.is_active,
  });

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });

}

async function deleteEmployee(id) {

  if (!window.confirm("هل تريد حذف الموظف؟"))
    return;

  const { error } = await supabase
    .from("employees")
    .delete()
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }

  loadEmployees();

}
return (

<div style={{padding:25}}>

<h1
style={{
marginBottom:25,
fontSize:30,
fontWeight:"bold"
}}
>
👨‍💼 إدارة الموظفين
</h1>

<div
style={{
display:"grid",
gridTemplateColumns:"repeat(4,1fr)",
gap:20,
marginBottom:25
}}
>

<div style={{
background:"#fff",
padding:20,
borderRadius:15,
boxShadow:"0 5px 15px rgba(0,0,0,.08)"
}}>
<div style={{fontSize:14,color:"#888"}}>عدد الموظفين</div>
<div style={{fontSize:30,fontWeight:"bold"}}>
{totalEmployees}
</div>
</div>

<div style={{
background:"#fff",
padding:20,
borderRadius:15,
boxShadow:"0 5px 15px rgba(0,0,0,.08)"
}}>
<div style={{fontSize:14,color:"#888"}}>الموظفون النشطون</div>
<div style={{
fontSize:30,
fontWeight:"bold",
color:"green"
}}>
{activeEmployees}
</div>
</div>

<div style={{
background:"#fff",
padding:20,
borderRadius:15,
boxShadow:"0 5px 15px rgba(0,0,0,.08)"
}}>
<div style={{fontSize:14,color:"#888"}}>الموقوفون</div>
<div style={{
fontSize:30,
fontWeight:"bold",
color:"red"
}}>
{inactiveEmployees}
</div>
</div>

<div style={{
background:"#fff",
padding:20,
borderRadius:15,
boxShadow:"0 5px 15px rgba(0,0,0,.08)"
}}>
<div style={{fontSize:14,color:"#888"}}>إجمالي الرواتب</div>
<div style={{
fontSize:30,
fontWeight:"bold",
color:"#2563eb"
}}>
{totalSalary.toLocaleString()}
</div>
</div>

</div>

<div
style={{
background:"#fff",
padding:20,
borderRadius:15,
boxShadow:"0 5px 15px rgba(0,0,0,.08)",
marginBottom:25
}}
>

<input

placeholder="🔍 بحث باسم الموظف أو الوظيفة"

value={search}

onChange={(e)=>setSearch(e.target.value)}

style={{
width:"100%",
padding:14,
fontSize:16,
borderRadius:10,
border:"1px solid #ddd",
marginBottom:20
}}

/>

</div>
<div
  style={{
    background: "#fff",
    borderRadius: 15,
    padding: 20,
    boxShadow: "0 5px 15px rgba(0,0,0,.08)",
    marginBottom: 25,
  }}
>

<h3 style={{ marginBottom: 20 }}>
{form.id ? "✏️ تعديل موظف" : "➕ إضافة موظف"}
</h3>

<div
style={{
display:"grid",
gridTemplateColumns:"repeat(2,1fr)",
gap:15
}}
>

<input
placeholder="اسم الموظف"
value={form.name}
onChange={(e)=>setForm({...form,name:e.target.value})}
/>

<input
placeholder="رقم الجوال"
value={form.phone}
onChange={(e)=>setForm({...form,phone:e.target.value})}
/>

<input
placeholder="الوظيفة"
value={form.job_title}
onChange={(e)=>setForm({...form,job_title:e.target.value})}
/>

<input
type="number"
placeholder="الراتب"
value={form.salary}
onChange={(e)=>setForm({...form,salary:e.target.value})}
/>

</div>

<textarea

rows={4}

placeholder="ملاحظات"

style={{
marginTop:15,
width:"100%"
}}

value={form.notes}

onChange={(e)=>setForm({...form,notes:e.target.value})}

/>

<div
style={{
marginTop:15,
display:"flex",
justifyContent:"space-between",
alignItems:"center"
}}
>

<label>

<input

type="checkbox"

checked={form.is_active}

onChange={(e)=>setForm({

...form,

is_active:e.target.checked

})}

/>

نشط

</label>

<div>

<button
onClick={clearForm}
style={{
marginLeft:10
}}
>

جديد

</button>

<button
onClick={saveEmployee}
>

💾 حفظ

</button>

</div>

</div>

</div>
<div
  style={{
    background: "#fff",
    borderRadius: 15,
    padding: 20,
    boxShadow: "0 5px 15px rgba(0,0,0,.08)",
  }}
>

<table
style={{
width:"100%",
borderCollapse:"collapse"
}}
>

<thead>

<tr
style={{
background:"#f3f4f6"
}}
>

<th style={{padding:12}}>الاسم</th>

<th>الوظيفة</th>

<th>الجوال</th>

<th>الراتب</th>

<th>الحالة</th>

<th>الإجراءات</th>

</tr>

</thead>

<tbody>

{loading ? (

<tr>

<td colSpan={6}
style={{
padding:30,
textAlign:"center"
}}
>

جار تحميل الموظفين...

</td>

</tr>

) : filteredRows.length===0 ? (

<tr>

<td
colSpan={6}
style={{
padding:30,
textAlign:"center"
}}
>

لا يوجد موظفون

</td>

</tr>

) : (

filteredRows.map(emp=>(

<tr
key={emp.id}
style={{
borderBottom:"1px solid #eee"
}}
>

<td style={{padding:12}}>{emp.name}</td>

<td>{emp.job_title}</td>

<td>{emp.phone}</td>

<td>{Number(emp.salary).toLocaleString()}</td>

<td>

{emp.is_active
?
"🟢 نشط"
:
"🔴 موقوف"}

</td>

<td>

<button
onClick={()=>editEmployee(emp)}
style={{
marginLeft:8
}}
>

✏ تعديل

</button>

<button
onClick={()=>deleteEmployee(emp.id)}
>

🗑 حذف

</button>

</td>

</tr>

))

)}

</tbody>

</table>

</div>
</div>

);

}
