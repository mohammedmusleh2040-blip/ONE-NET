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
