// src/App.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Stock from "./pages/Stock";
import Customers from "./pages/Customers";
import Invoices from "./pages/Invoices";
import Payments from "./pages/Payments";
import Expenses from "./pages/Expenses";
import Ledger from "./pages/Ledger";
import DailyCashReport from "./pages/DailyCashReport";
import CashBoxReport from "./pages/CashBoxReport";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import Vendors from "./pages/Vendors";
import Employees from "./pages/Employees";
import Payroll from "./pages/Payroll";
import SalaryReport from "./pages/SalaryReport";
import EmployeeAdvances from "./pages/EmployeeAdvances";
import EmployeeStatement from "./pages/EmployeeStatement";
import Login from "./pages/Login";

export default function App() {
  return (
    <Routes>
      {/* Login (بدون سايدبار) */}
      <Route path="/login" element={<Login />} />

      {/* كل النظام تحت Layout مرة واحدة */}
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />

        <Route path="dashboard" element={<Dashboard />} />
        <Route path="stock" element={<Stock />} />
        <Route path="customers" element={<Customers />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="payments" element={<Payments />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="ledger" element={<Ledger />} />

        {/* تقرير اليومية الجديد */}
        <Route path="daily-report" element={<DailyCashReport />} />

        <Route path="users" element={<Users />} />
        <Route path="settings" element={<Settings />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="employees" element={<Employees />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="salary-report" element={<SalaryReport />} />
<Route path="employee-advances" element={<EmployeeAdvances />} />
<Route path="employee-statement" element={<EmployeeStatement />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route
  path="cashbox"
  element={<CashBoxReport />}
/>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
