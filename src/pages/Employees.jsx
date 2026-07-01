
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Employees() {
  const [rows,setRows]=useState([]);
  const [form,setForm]=useState({id:null,name:"",phone:"",job_title:"",salary:"",notes:"",is_active:true});

  async function loadEmployees(){
    const {data}=await supabase.from("employees").select("*").order("name");
    setRows(data||[]);
  }

  useEffect(()=>{loadEmployees();},[]);

  async function saveEmployee(){
    const payload={
      name:form.name,
      phone:form.phone,
      job_title:form.job_title,
      salary:Number(form.salary||0),
      notes:form.notes,
      is_active:form.is_active
    };
    if(form.id){
      await supabase.from("employees").update(payload).eq("id",form.id);
    }else{
      await supabase.from("employees").insert(payload);
    }
    setForm({id:null,name:"",phone:"",job_title:"",salary:"",notes:"",is_active:true});
    loadEmployees();
  }

  async function deleteEmployee(id){
    if(!window.confirm("حذف الموظف؟")) return;
    await supabase.from("employees").delete().eq("id",id);
    loadEmployees();
  }

  return (
    <div style={{padding:20}}>
      <h2>إدارة الموظفين</h2>
      <input placeholder="الاسم" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
      <input placeholder="الجوال" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>
      <input placeholder="الوظيفة" value={form.job_title} onChange={e=>setForm({...form,job_title:e.target.value})}/>
      <input placeholder="الراتب" type="number" value={form.salary} onChange={e=>setForm({...form,salary:e.target.value})}/>
      <textarea placeholder="ملاحظات" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
      <label><input type="checkbox" checked={form.is_active} onChange={e=>setForm({...form,is_active:e.target.checked})}/>نشط</label>
      <button onClick={saveEmployee}>{form.id?"تحديث":"إضافة موظف"}</button>
      <table border="1" cellPadding="5" width="100%">
        <thead><tr><th>الاسم</th><th>الوظيفة</th><th>الراتب</th><th>الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>
        {rows.map(r=>(
          <tr key={r.id}>
            <td>{r.name}</td><td>{r.job_title}</td><td>{r.salary}</td><td>{r.is_active?"نشط":"موقوف"}</td>
            <td>
              <button onClick={()=>setForm(r)}>تعديل</button>
              <button onClick={()=>deleteEmployee(r.id)}>حذف</button>
            </td>
          </tr>
        ))}
        </tbody>
      </table>
    </div>
  );
}
