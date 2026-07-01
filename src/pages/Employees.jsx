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
  const [search, setSearch] = useState("");

  const [form, setForm] = useState(emptyEmployee);

  const [loading, setLoading] = useState(false);

  async function loadEmployees() {

    setLoading(true);

    const { data } = await supabase
      .from("employees")
      .select("*")
      .order("name");

    setRows(data || []);

    setLoading(false);

  }

  useEffect(() => {

    loadEmployees();

  }, []);

  const filteredRows = useMemo(() => {

    if (!search) return rows;

    return rows.filter((x) =>

      (x.name || "")
        .toLowerCase()
        .includes(search.toLowerCase()) ||

      (x.phone || "")
        .toLowerCase()
        .includes(search.toLowerCase()) ||

      (x.job_title || "")
        .toLowerCase()
        .includes(search.toLowerCase())

    );

  }, [rows, search]);

  const totalEmployees = rows.length;

  const activeEmployees = rows.filter(x => x.is_active).length;

  const inactiveEmployees = rows.filter(x => !x.is_active).length;

  const totalSalary = rows.reduce(

    (s, x) => s + Number(x.salary || 0),

    0

  );
  async function saveEmployee() {

  if (!form.name.trim()) {
    alert("يرجى كتابة اسم الموظف");
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

  if (form.id) {

    const { error } = await supabase
      .from("employees")
      .update(payload)
      .eq("id", form.id);

    if (error) {
      alert(error.message);
      return;
    }

  } else {

    const { error } = await supabase
      .from("employees")
      .insert(payload);

    if (error) {
      alert(error.message);
      return;
    }

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

<h2 style={{marginBottom:20}}>
👨‍💼 إدارة الموظفين
</h2>

</div>

);

}
