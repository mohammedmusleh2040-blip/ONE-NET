// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ===== Helpers (No change to logic) =====
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => safeNum(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const qty = (v) => safeNum(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const todayISO = () => new Date().toISOString().slice(0, 10);

function fmtDateTime(iso) {
  try {
    return new Date(iso || Date.now()).toLocaleString("ar-EG", { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso || "");
  }
}

function pick(obj, keys, def = null) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return def;
}

function isIncomeRow(x){
  const d = String(x?.direction ?? x?.type ?? "").toLowerCase();
  return d === "income" || d === "in" || d === "add" || d === "credit";
}

function readStock(ct) {
  return safeNum(pick(ct, ["balance", "quantity", "current_qty", "stock_qty", "on_hand", "qty", "remaining_qty"], 0));
}
function readCost(ct) { return safeNum(pick(ct, ["cost", "unit_cost", "purchase_price"], 0)); }
function readPrice(ct) { return safeNum(pick(ct, ["price", "sell_price", "unit_price"], 0)); }

const customStyles = {
    miniTitle: { color: 'var(--muted, #94a3b8)', fontSize: 13, marginBottom: 4 },
    miniValue: (isAccent) => ({ 
      fontSize: isAccent ? '2rem' : '1.8rem', 
      fontWeight: 700, 
      color: isAccent ? 'var(--accent, #22c55e)' : 'var(--text, #e5e7eb)', 
    }),
    badgePrimary: { 
      fontSize: 10, 
      fontWeight: 600, 
      textTransform: 'uppercase', 
      letterSpacing: '0.05em',
      color: 'var(--accent, #22c55e)', 
      backgroundColor: 'rgba(34, 197, 94, 0.2)', 
      padding: '4px 8px',
      borderRadius: '4px',
    },
    movementBadge: (type) => ({
      display: 'inline-block',
      padding: '4px 10px',
      borderRadius: '6px',
      fontWeight: 700,
      fontSize: '0.8rem',
      backgroundColor: type === "IN" ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
      color: '#fff',
    }),
};

// نقبل هنا onViewPage أو دالة تغيير التبويبات لتوجيه المحاسب مباشرة عند النقر
export default function Dashboard({ onNavigateToLedgerDebts }) {
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
  const [movesUsingView, setMovesUsingView] = useState(true);

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
      const { data, error } = await supabase.from("v_card_balances").select("*").limit(5000);
      if (error) throw error;
      setCardTypes((data || []).map(r => ({
        ...r, id: r.card_type_id, name: r.card_name, price: r.price, cost: r.cost
      })));
    } catch {
      setCardTypes([]);
    }
  }

  async function loadCustomersCount() {
    try {
      const { count } = await supabase.from("customers").select("id", { count: "exact", head: true });
      setCustomersCount(count || 0);
      const { data } = await supabase.from("customers").select("id,opening_balance").limit(5000);
      setCustomers(data || []);
    } catch { setCustomers([]); }
  }

  async function loadInvoicesRange(fromISO, toISO) {
    try {
      const { data } = await supabase.from("invoices").select("*").gte("invoice_date", fromISO).lte("invoice_date", toISO);
      setInvoices(data || []);
    } catch { setInvoices([]); }
  }

  async function loadPaymentsRange(fromISO, toISO) {
    try {
      const { data } = await supabase.from("payments").select("*").gte("pay_date", fromISO).lte("pay_date", toISO);
      setPayments(data || []);
    } catch { setPayments([]); }
  }

  async function loadExpensesRange(fromISO, toISO) {
    try {
      const { data } = await supabase.from("expenses").select("*").gte("expense_date", fromISO).lte("expense_date", toISO);
      setExpenses(data || []);
    } catch { setExpenses([]); }
  }

  async function loadMovementsRange(fromISO, toISO) {
    try {
      const { data } = await supabase.from("v_card_movements").select("*").gte("movement_date", fromISO).lte("movement_date", toISO);
      setMoves(data || []);
    } catch { setMoves([]); }
  }

  async function refreshAll() {
    setLoading(true);
    try {
      await loadLowStockThreshold();
      await Promise.all([loadCardTypes(), loadCustomersCount()]);
      await Promise.all([
        loadInvoicesRange(from, to),
        loadPaymentsRange(from, to),
        loadExpensesRange(from, to),
        loadMovementsRange(from, to),
      ]);
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { refreshAll(); }, []);

  const cardsBalance = useMemo(() => (cardTypes || []).reduce((acc, ct) => acc + readStock(ct), 0), [cardTypes]);
  const sales = useMemo(() => (invoices || []).reduce((acc, inv) => acc + safeNum(inv.total_after_discount), 0), [invoices]);
  
  const debts = useMemo(() => {
    const invoiceDebts = (invoices || []).reduce((sum, inv) => sum + Math.max(0, safeNum(inv.remaining_amount)), 0);
    const openingTotal = (customers || []).reduce((sum, c) => sum + Math.max(0, safeNum(c.opening_balance)), 0);
    const openingPaid = (payments || []).filter(p => p.invoice_id == null).reduce((sum, p) => sum + Math.max(0, safeNum(p.amount)), 0);
    return invoiceDebts + Math.max(0, openingTotal - openingPaid);
  }, [invoices, customers, payments]);

  const addsQty = useMemo(() => (moves || []).reduce((acc, m) => String(m.movement_type).toUpperCase() === "IN" ? acc + safeNum(m.qty) : acc, 0), [moves]);
  const outQty = useMemo(() => (moves || []).reduce((acc, m) => String(m.movement_type).toUpperCase() === "OUT" ? acc + safeNum(m.qty) : acc, 0), [moves]);
  
  const cashIn = useMemo(() => (payments || []).reduce((acc, p) => !String(p.note).includes("[REFUND_CASH_OUT]") && safeNum(p.amount) > 0 ? acc + safeNum(p.amount) : acc, 0), [payments]);
  const cashOutRefunds = useMemo(() => (payments || []).reduce((acc, p) => String(p.note).includes("[REFUND_CASH_OUT]") && safeNum(p.amount) > 0 ? acc + safeNum(p.amount) : acc, 0), [payments]);
  
  const paymentsTotal = useMemo(() => (payments || []).reduce((acc, p) => acc + Math.max(0, safeNum(p.amount)), 0), [payments]);
  const expenseOutTotal = useMemo(() => (expenses || []).reduce((acc, x) => isIncomeRow(x) ? acc : acc + safeNum(x.amount), 0), [expenses]);
  const incomeOtherTotal = useMemo(() => (expenses || []).reduce((acc, x) => isIncomeRow(x) ? acc + safeNum(x.amount) : acc, 0), [expenses]);

  const stockDist = useMemo(() => {
    const arr = (cardTypes || []).map(ct => ({ id: ct.id, name: ct.name, stock: readStock(ct), price: readPrice(ct) }));
    arr.sort((a, b) => b.stock - a.stock);
    return arr;
  }, [cardTypes]);

  return (
    <div className="page" style={{ padding: '20px' }}>
      <div className="page-head" style={{ marginBottom: '24px' }}>
        <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
          <div style={customStyles.badgePrimary}>الرئيسية</div>
          <h2 style={{ margin: "10px 0 0", fontSize: '2.5rem', color: 'var(--accent)' }}>لوحة التحكم</h2>
          <div style={customStyles.miniTitle}>فلاتر التاريخ واختصارات التنقل المالي الذكي للشبكة.</div>
        </div>

        <div className="row" style={{ gap: 12, marginTop: '16px' }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: 'var(--muted)' }}>من
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: 'var(--muted)' }}>إلى
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </label>
          <button className="btn btn-primary" onClick={refreshAll} disabled={loading}>{loading ? 'جاري التحديث...' : 'تحديث البيانات'}</button>
        </div>
      </div>

      {/* ===== KPI Cards (6) - تحويل كارد الديون إلى كارد تفاعلي ذكي ===== */}
      <div className="grid grid-3" style={{ marginBottom: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
        <div className="card" style={{ padding: '16px' }}>
          <div style={customStyles.miniTitle}>رصيد الكروت</div>
          <div style={customStyles.miniValue(true)}>{qty(cardsBalance)}</div>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <div style={customStyles.miniTitle}>المبيعات</div>
          <div style={customStyles.miniValue(false)}>{money(sales)}</div>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <div style={customStyles.miniTitle}>الإضافات (IN)</div>
          <div style={customStyles.miniValue(false)}>{qty(addsQty)}</div>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <div style={customStyles.miniTitle}>عدد العملاء</div>
          <div style={customStyles.miniValue(false)}>{customersCount}</div>
        </div>

        {/* 🔥 كارد الديون التفاعلي - ينقل المحاسب فوراً عند النقر */}
        <div 
          className="card" 
          onClick={() => {
            if (onNavigateToLedgerDebts) {
              onNavigateToLedgerDebts();
            } else {
              // التوجيه التلقائي عبر المسار لو لم تتوفر الـ prop
              window.location.hash = "#/ledger?tab=customerDebts";
            }
          }}
          style={{ padding: '16px', cursor: 'pointer', border: '1px dashed var(--accent)', transition: 'transform 0.2s' }}
          onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.03)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
          title="اضغط هنا لفتح تفاصيل وتقرير ديون العملاء فوراً"
        >
          <div style={{ ...customStyles.miniTitle, color: 'var(--accent)' }}>🔗 الديون (اضغط للمعاينة)</div>
          <div style={{ ...customStyles.miniValue(false), color: '#ef4444' }}>{money(debts)}</div>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <div style={customStyles.miniTitle}>الصافي (تقريبي)</div>
          <div style={customStyles.miniValue(sales + incomeOtherTotal - expenseOutTotal > 0)}>{money(sales + incomeOtherTotal - expenseOutTotal)}</div>
        </div>
      </div>

      {/* ===== Financial Summary ===== */}
      <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={customStyles.badgePrimary}>ملخص الفترة المالية</div>
            <h3 style={{ margin: "10px 0 0", fontSize: '1.5rem', color: 'var(--accent2)' }}>Financial Overview</h3>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 12, flexGrow: 1 }}>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(56, 189, 248, 0.1)' }}>
              <div style={customStyles.miniTitle}>نقدًا</div><div style={customStyles.miniValue(false)}>{money(cashIn - cashOutRefunds + incomeOtherTotal - expenseOutTotal)}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(34, 197, 94, 0.1)' }}>
              <div style={customStyles.miniTitle}>دخل (سداد)</div><div style={customStyles.miniValue(true)}>{money(paymentsTotal + incomeOtherTotal)}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)' }}>
              <div style={customStyles.miniTitle}>مصروفات</div><div style={customStyles.miniValue(false)}>{money(expenseOutTotal)}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(255, 200, 70, 0.1)' }}>
              <div style={customStyles.miniTitle}>ديون</div><div style={customStyles.miniValue(false)}>{money(debts)}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(34, 197, 94, 0.1)' }}>
              <div style={customStyles.miniTitle}>صافي نقد</div><div style={customStyles.miniValue(true)}>{money(paymentsTotal + incomeOtherTotal - expenseOutTotal)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== المخزون والحركات ===== */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="card" style={{ padding: '16px' }}>
          <h3>توزيع رصيد المخزون (توزيع المخزون)</h3>
          <div className="table-wrap" style={{ overflowX: 'auto', maxHeight: 260 }}>
            <table className="table">
              <thead><tr><th>#</th><th>الكرت</th><th style={{ textAlign: 'center' }}>الرصيد الفعلي</th><th style={{ textAlign: 'center' }}>السعر</th></tr></thead>
              <tbody>
                {stockDist.slice(0, 25).map((x, idx) => (
                  <tr key={idx}><td>{idx + 1}</td><td><strong>{x.name}</strong></td><td style={{ textAlign: 'center', fontWeight: 900 }}>{qty(x.stock)}</td><td style={{ textAlign: 'center' }}>{money(x.price)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
