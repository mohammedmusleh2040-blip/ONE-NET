// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ===== Helpers =====
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => safeNum(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const qty = (v) => safeNum(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const todayISO = () => new Date().toISOString().slice(0, 10);

function isIncomeRow(x){
  const d = String(x?.direction ?? x?.type ?? "").toLowerCase();
  return d === "income" || d === "in" || d === "add" || d === "credit";
}
function isCashMethod(m){
  const s = String(m || "").toLowerCase();
  return s === "cash" || s === "نقد" || s === "نقداً" || s === "نقدا";
}
function readStock(ct) {
  return safeNum(pick(ct, ["balance", "quantity", "current_qty", "stock_qty", "on_hand", "qty", "remaining_qty"], 0));
}
function pick(obj, keys, def = null) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return def;
}

export default function Dashboard({ onNavigate }) {
  const [lowStockThreshold, setLowStockThreshold] = useState(
    Number(localStorage.getItem("low_stock_threshold") || 10)
  );

  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(false);

  const [cardTypes, setCardTypes] = useState([]);
  const [customersCount, setCustomersCount] = useState(0);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [moves, setMoves] = useState([]);

  // ===== Loaders =====
  async function loadLowStockThreshold() {
    try {
      const { data } = await supabase.from("settings").select("*").limit(1).maybeSingle();
      if (data && typeof data.low_stock_threshold === "number") {
        setLowStockThreshold(data.low_stock_threshold);
        localStorage.setItem("low_stock_threshold", String(data.low_stock_threshold));
      }
    } catch {}
  }

  async function loadCardTypes() {
    try {
      const { data } = await supabase.from("v_card_balances").select("*").limit(5000);
      setCardTypes((data || []).map(r => ({
        ...r, id: r.card_type_id, name: r.card_name, price: r.price, cost: r.cost
      })));
    } catch { setCardTypes([]); }
  }

  async function loadCustomersCount() {
    try {
      const { count } = await supabase.from("customers").select("id", { count: "exact", head: true });
      setCustomersCount(count || 0);
      const { data } = await supabase.from("customers").select("id,opening_balance").limit(5000);
      setCustomers(data || []);
    } catch { setCustomers([]); }
  }

  async function refreshAll() {
    setLoading(true);
    try {
      await loadLowStockThreshold();
      await Promise.all([loadCardTypes(), loadCustomersCount()]);
      const { data: invRows } = await supabase.from("invoices").select("*").gte("invoice_date", from).lte("invoice_date", to);
      setInvoices(invRows || []);
      const { data: payRows } = await supabase.from("payments").select("*").gte("pay_date", from).lte("pay_date", to);
      setPayments(payRows || []);
      const { data: expRows } = await supabase.from("expenses").select("*").gte("expense_date", from).lte("expense_date", to);
      setExpenses(expRows || []);
      const { data: moveRows } = await supabase.from("v_card_movements").select("*").gte("movement_date", from).lte("movement_date", to);
      setMoves(moveRows || []);
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { refreshAll(); }, [from, to]);

  // ===== الحسابات والمطابقات المالية الحية لـ Dashboard V1 =====
  const salesTotal = useMemo(() => (invoices || []).reduce((acc, inv) => acc + safeNum(inv.total_after_discount), 0), [invoices]);
  const cardsStockValue = useMemo(() => (cardTypes || []).reduce((acc, ct) => acc + (readStock(ct) * safeNum(ct.cost || ct.price * 0.6)), 0), [cardTypes]);
  
  const debtsTotal = useMemo(() => {
    const invoiceDebts = (invoices || []).reduce((sum, inv) => sum + Math.max(0, safeNum(inv.remaining_amount)), 0);
    const openingTotal = (customers || []).reduce((sum, c) => sum + Math.max(0, safeNum(c.opening_balance)), 0);
    const openingPaid = (payments || []).filter(p => p.invoice_id == null).reduce((sum, p) => sum + Math.max(0, safeNum(p.amount)), 0);
    return invoiceDebts + Math.max(0, openingTotal - openingPaid);
  }, [invoices, customers, payments]);

  const cashInBox = useMemo(() => {
    const cashIn = (payments || []).reduce((acc, p) => !String(p.note).includes("[REFUND_CASH_OUT]") && String(p.method).toLowerCase().includes("cash") && safeNum(p.amount) > 0 ? acc + safeNum(p.amount) : acc, 0);
    const cashOutRefunds = (payments || []).reduce((acc, p) => String(p.note).includes("[REFUND_CASH_OUT]") && String(p.method).toLowerCase().includes("cash") && safeNum(p.amount) > 0 ? acc + safeNum(p.amount) : acc, 0);
    const cashIncome = (expenses || []).reduce((acc, x) => isIncomeRow(x) && isCashMethod(x.method) ? acc + safeNum(x.amount) : acc, 0);
    const cashExpense = (expenses || []).reduce((acc, x) => !isIncomeRow(x) && isCashMethod(x.method) ? acc + safeNum(x.amount) : acc, 0);
    return cashIn - cashOutRefunds + cashIncome - cashExpense;
  }, [payments, expenses]);

  // حساب العملاء المدينين الفعليين للفترة
  const debtorsCount = useMemo(() => {
    const uniqueDebtors = new Set((invoices || []).filter(inv => safeNum(inv.remaining_amount) > 0).map(inv => inv.customer_id));
    return uniqueDebtors.size;
  }, [invoices]);

  return (
    <div className="page" style={{ padding: '20px', direction: "rtl" }}>
      
      {/* رأس الصفحة وفلاتر التحكم */}
      <div className="page-head" style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "15px" }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'rgba(34, 197, 94, 0.15)', padding: '4px 8px', borderRadius: '4px' }}>الرئيسية</span>
            <h2 style={{ margin: "8px 0 0", fontSize: '2.2rem', color: 'var(--text)' }}>لوحة التحكم <span style={{ fontSize: "14px", color: "var(--muted)" }}>ONE-NET ERP</span></h2>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "13px", color: 'var(--muted)' }}>من
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 140 }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "13px", color: 'var(--muted)' }}>إلى
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 140 }} />
            </label>
            <button className="btn btn-primary" onClick={refreshAll} disabled={loading}>{loading ? '...' : 'تحديث'}</button>
          </div>
        </div>
      </div>

      {/* 🚀 الصف الأول: المؤشرات الرئيسية الأربعة المستوحاة من الأنظمة العالمية */}
      <div style={{ display: "grid", gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        
        {/* 1. إجمالي المبيعات */}
        <div className="card" style={{ padding: '20px', borderTop: '4px solid #3182ce', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: "13px", color: "var(--muted)", fontWeight: "bold" }}>💰 إجمالي المبيعات</div>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--text)", margin: "8px 0" }}>{money(salesTotal)} <span style={{ fontSize: "13px", fontWeight: "normal" }}>ريال</span></div>
          <div style={{ fontSize: "11px", color: "var(--muted)" }}>حسب النطاق الزمني المحدد</div>
        </div>

        {/* 2. النقد بالصندوق */}
        <div className="card" style={{ padding: '20px', borderTop: '4px solid #38a169', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: "13px", color: "var(--muted)", fontWeight: "bold" }}>🟢 النقد بالصندوق</div>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: "#38a169", margin: "8px 0" }}>{money(cashInBox)} <span style={{ fontSize: "13px", fontWeight: "normal" }}>ريال</span></div>
          <div style={{ fontSize: "11px", color: "var(--muted)" }}>السيولة النقدية المتوفرة حالياً</div>
        </div>

        {/* 3. إجمالي الديون */}
        <div className="card" style={{ padding: '20px', borderTop: '4px solid #e53e3e', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: "13px", color: "var(--muted)", fontWeight: "bold" }}>🔴 إجمالي الديون</div>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: "#e53e3e", margin: "8px 0" }}>{money(debtsTotal)} <span style={{ fontSize: "13px", fontWeight: "normal" }}>ريال</span></div>
          <div style={{ fontSize: "11px", color: "var(--muted)" }}>على {debtorsCount} عميل مدين حالياً</div>
        </div>

        {/* 4. قيمة المخزون */}
        <div className="card" style={{ padding: '20px', borderTop: '4px solid #dd6b20', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: "13px", color: "var(--muted)", fontWeight: "bold" }}>📦 قيمة المخزون التقديرية</div>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: "#dd6b20", margin: "8px 0" }}>{money(cardsStockValue)} <span style={{ fontSize: "13px", fontWeight: "normal" }}>ريال</span></div>
          <div style={{ fontSize: "11px", color: "var(--muted)" }}>بناءً على التكلفة التقريبية للكروت</div>
        </div>

      </div>

      {/* 🚀 الأزرار السريعة لتبسيط وصول المدير المباشر */}
      <div className="card" style={{ padding: '20px', marginBottom: '24px', background: 'rgba(255,255,255,0.02)' }}>
        <h3 style={{ margin: "0 0 15px 0", fontSize: '15px', fontWeight: "bold", color: "var(--text)" }}>⚡ اختصارات العمليات السريعة</h3>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={() => onNavigate ? onNavigate("invoices") : (window.location.hash = "#/invoices")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px" }}>
            ➕ فاتورة جديدة
          </button>
          <button className="btn btn-outline" onClick={() => onNavigate ? onNavigate("payments") : (window.location.hash = "#/payments")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px" }}>
            💰 سند قبض
          </button>
          <button className="btn btn-outline" onClick={() => onNavigate ? onNavigate("cards") : (window.location.hash = "#/cards")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px" }}>
            📦 إضافة مخزون
          </button>
          <button className="btn btn-outline" onClick={() => onNavigate ? onNavigate("customers") : (window.location.hash = "#/customers")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px" }}>
            👥 عميل جديد
          </button>
          <button className="btn btn-outline" onClick={() => onNavigate ? onNavigate("ledger") : (window.location.hash = "#/ledger")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", borderColor: "var(--accent)", color: "var(--accent)" }}>
            📊 التقارير والمطابقات
          </button>
        </div>
      </div>

    </div>
  );
}
