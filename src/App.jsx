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
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import Vendors from "./pages/Vendors";
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
        <Route path="users" element={<Users />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="settings" element={<Settings />} />
        <Route path="vendors" element={<Vendors />} />

        {/* fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
