// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ===== Helpers (No change to logic) =====
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// Use a consistent, clean number format for money and quantity
const money = (v) => safeNum(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const qty = (v) => safeNum(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const todayISO = () => new Date().toISOString().slice(0, 10);

function addDaysISO(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function tsFromISO(iso) {
  return `${iso}T00:00:00`;
}
function fmtDateTime(iso) {
  try {
    // Use 'short' time style for a cleaner look
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
function isExpenseRow(x){
  const d = String(x?.direction ?? x?.type ?? "").toLowerCase();
  return d === "expense" || d === "out" || d === "debit" || d === "" || d === "spend";
}
function isCashMethod(m){
  const s = String(m || "").toLowerCase();
  return s === "cash" || s === "نقد" || s === "نقداً" || s === "نقدا";
}

// Try to read a stock field from card_types (your schema may differ)
function readStock(ct) {
  // Prefer the "actual balance" coming from views (balance/current_qty/stock_qty) before generic qty
  return safeNum(
    pick(ct, ["balance", "quantity", "current_qty", "stock_qty", "on_hand", "qty", "remaining_qty"], 0)
  );
}
function readCost(ct) {
  return safeNum(pick(ct, ["cost", "unit_cost", "purchase_price"], 0));
}
function readPrice(ct) {
  return safeNum(pick(ct, ["price", "sell_price", "unit_price"], 0));
}

// ====================================================================
// NEW: Custom Styles based on styles.css variables
// ====================================================================
const customStyles = {
    // Rely on .card class, but add padding for large sections
    cardSection: { padding: '20px', marginBottom: '24px' }, 
    
    // KPI Mini Cards - relies on theme colors
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
      backgroundColor: 'rgba(34, 197, 94, 0.2)', // var(--accent) with opacity
      padding: '4px 8px',
      borderRadius: '4px',
    },
    // Table specific:
    movementBadge: (type) => ({
      display: 'inline-block',
      padding: '4px 10px',
      borderRadius: '6px',
      fontWeight: 700,
      fontSize: '0.8rem',
      // IN uses Accent (Green), OUT uses Danger (Red)
      backgroundColor: type === "IN" ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
      color: '#fff',
    }),
};

export default function Dashboard() {
  // حد تنبيه المخزون: من الإعدادات (إن وجد) وإلا من localStorage وإلا 10
  const [lowStockThreshold, setLowStockThreshold] = useState(
    Number(localStorage.getItem("low_stock_threshold") || 10)
  );

  // ===== Filters =====
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  // ===== Data state =====
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
      const { data, error } = await supabase
        .from("settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) return;
      if (data && typeof data.low_stock_threshold === "number") {
        setLowStockThreshold(data.low_stock_threshold);
        localStorage.setItem("low_stock_threshold", String(data.low_stock_threshold));
      }
    } catch {
      /* ignore */
    }
  }

  // ===== Loaders =====
  async function loadCardTypes() {
    // Prefer Supabase views that contain the computed/actual stock first
    const trySources = ["v_card_balances", "card_types_with_stock_view", "card_types"];
    let lastErr = null;

    for (const srcName of trySources) {
      try {
        const orderCol =
          srcName === "card_types"
            ? "name"
            : srcName === "v_card_balances"
            ? "card_type_id"
            : "card_type_id";

        const { data, error } = await supabase
          .from(srcName)
          .select("*")
          .order(orderCol, { ascending: true })
          .limit(5000);

        if (error) throw error;

        const normalized = (data || [])
          .map((r) => {
            const base = r?.card_types || r || {};
            const id = pick(base, ["id"], null) ?? pick(r, ["card_type_id", "id"], null);
            const name =
              pick(base, ["name"], "") ||
              pick(r, ["card_name", "card_type_name", "name"], "") ||
              (id != null ? `#${id}` : "");

            return {
              ...base,
              id,
              name,
              price: pick(base, ["price"], null) ?? pick(r, ["price"], null),
              cost: pick(base, ["cost"], null) ?? pick(r, ["cost"], null),
              // stock-related columns (may exist depending on source)
              balance: pick(r, ["balance"], null),
              quantity: pick(r, ["quantity"], null),
              qty: pick(r, ["qty"], null),
              remaining_qty: pick(r, ["remaining_qty"], null),
              current_qty: pick(r, ["current_qty"], null),
              stock_qty: pick(r, ["stock_qty"], null),
              on_hand: pick(r, ["on_hand"], null),
           
              // per-card alert thresholds
              low_stock_threshold: pick(base, ["low_stock_threshold"], null) ?? pick(r, ["low_stock_threshold"], null),
              alert_qty: pick(base, ["alert_qty"], null) ?? pick(r, ["alert_qty"], null),
            };
          })
          .filter((x) => x && x.id !== null && x.id !== undefined);

        setCardTypes(normalized);
        return;
      } catch (e) {
        lastErr = e;
      }
    }

    console.warn("Failed to load card types from views; falling back to empty.", lastErr);
    setCardTypes([]);
  }

  async function loadCustomersCount() {
    const { count, error } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    setCustomersCount(count || 0);

    // fetch opening balances for debts summary
    try{
      const { data } = await supabase.from("customers").select("id,opening_balance").limit(5000);
      setCustomers(data || []);
    }catch{
      setCustomers([]);
    }
  }

  async function loadInvoicesRange(fromISO, toISO) {
    try {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,number,customer_id,invoice_type,invoice_date,total_after_discount,paid_amount,remaining_amount,status,created_at")
        .gte("invoice_date", fromISO)
        .lte("invoice_date", toISO)
        .order("invoice_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(5000);
      if (error) throw error;
      setInvoices(data || []);
      return;
    } catch (e) {
      console.warn("loadInvoicesRange failed", e);
      setInvoices([]);
    }
  }

  async function loadPaymentsRange(fromISO, toISO) {
    try {
      const { data, error } = await supabase
        .from("payments")
        .select("id,customer_id,invoice_id,pay_date,amount,payment_type,method,reference,note,created_at")
        .gte("pay_date", fromISO)
        .lte("pay_date", toISO)
        .order("pay_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(5000);
      if (error) throw error;
      setPayments(data || []);
      return;
    } catch (e) {
      console.warn("loadPaymentsRange failed", e);
      setPayments([]);
    }
  }

  async function loadExpensesRange(fromISO, toISO) {
    try {
      const { data, error } = await supabase
        .from("expenses")
        .select("id,expense_date,category,amount,direction,method,note,created_at")
        .gte("expense_date", fromISO)
        .lte("expense_date", toISO)
        .order("expense_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(5000);
      if (error) throw error;
      setExpenses(data || []);
      return;
    } catch (e) {
      console.warn("loadExpensesRange failed", e);
      setExpenses([]);
    }
  }

  async function loadMovementsRange(fromISO, toISO) {
    try {
      const { data, error } = await supabase
        .from("v_card_movements")
        .select("*")
        .gte("movement_date", fromISO)
        .lte("movement_date", toISO)
        .order("movement_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      setMovesUsingView(true);
      setMoves(data || []);
      return;
    } catch (e) {
      console.warn("v_card_movements not available, fallback to card_movements", e);
      setMovesUsingView(false);
    }

    const { data, error } = await supabase
      .from("card_movements")
      .select('id,card_type_id,movement_type,qty,"before","after",before_qty,after_qty,note,created_at,card_types(name)')
      .gte("movement_date", fromISO)
      .lte("movement_date", toISO)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    setMoves(data || []);
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
    } catch (e) {
      console.error(e);
      alert(e?.message || "فشل تحميل لوحة التحكم");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Computed =====
  const cardsBalance = useMemo(() => {
    return (cardTypes || []).reduce((acc, ct) => acc + readStock(ct), 0);
  }, [cardTypes]);

  const sales = useMemo(() => {
    return (invoices || []).reduce((acc, inv) => {
      const tot = safeNum(pick(inv, ["total_after_discount", "grand_total", "total"], 0));
      return acc + tot;
    }, 0);
  }, [invoices]);

  const debts = useMemo(() => {
    // 1️⃣ ديون الفواتير المتبقية فقط
    const invoiceDebts = (invoices || []).reduce(
      (sum, inv) => sum + Math.max(0, safeNum(inv.remaining_amount)),
      0
    );

    // 2️⃣ الرصيد الافتتاحي
    const openingTotal = (customers || []).reduce(
      (sum, c) => sum + Math.max(0, safeNum(c.opening_balance)),
      0
    );

    // 3️⃣ سندات سداد الدين (غير مرتبطة بفاتورة)
    const openingPaid = (payments || [])
      .filter(p => p.invoice_id == null)
      .reduce((sum, p) => sum + Math.max(0, safeNum(p.amount)), 0);

    // 4️⃣ المتبقي من الدين الافتتاحي
    const openingRemaining = Math.max(0, openingTotal - openingPaid);

    // ✅ الدين الحقيقي فقط
    return invoiceDebts + openingRemaining;
  }, [invoices, customers, payments]);

  const addsQty = useMemo(() => {
    return (moves || []).reduce((acc, m) => {
      const t = String(m.movement_type || "").toUpperCase();
      if (t === "IN") return acc + safeNum(m.qty);
      return acc;
    }, 0);
  }, [moves]);

  const outQty = useMemo(() => {
    return (moves || []).reduce((acc, m) => {
      const t = String(m.movement_type || "").toUpperCase();
      if (t === "OUT") return acc + safeNum(m.qty);
      return acc;
    }, 0);
  }, [moves]);

  const cashPayments = useMemo(() => {
    return (payments || []).reduce((acc, p) => {
      const m = String(p.method || p.payment_method || "").toLowerCase();
      const amt = safeNum(p.amount);
      if (amt <= 0) return acc;
      if (m === "cash" || m === "نقد" || m === "نقداً" || m === "نقدا") return acc + amt;
      return acc;
    }, 0);
  }, [payments]);

  // 💰 Cash IN (قبض نقدي حقيقي) — يستبعد سندات المرتجع
  const cashIn = useMemo(() => {
    return (payments || []).reduce((acc, p) => {
      const m = String(p.method || p.payment_method || "").toLowerCase();
      const note = String(p.note || "");
      const amt = safeNum(p.amount);
      if (amt <= 0) return acc;
      if (!(m === "cash" || m === "نقد" || m === "نقداً" || m === "نقدا")) return acc;
      if (note.includes("[REFUND_CASH_OUT]")) return acc;
      return acc + amt;
    }, 0);
  }, [payments]);

  // 🔻 Cash OUT (مرتجعات نقدية) — تُحسب كسحب من الصندوق
  const cashOutRefunds = useMemo(() => {
    return (payments || []).reduce((acc, p) => {
      const m = String(p.method || p.payment_method || "").toLowerCase();
      const note = String(p.note || "");
      const amt = safeNum(p.amount);
      if (amt <= 0) return acc;
      if (!(m === "cash" || m === "نقد" || m === "نقداً" || m === "نقدا")) return acc;
      if (!note.includes("[REFUND_CASH_OUT]")) return acc;
      return acc + amt;
    }, 0);
  }, [payments]);

  const paymentsTotal = useMemo(() => {
    return (payments || []).reduce((acc, p) => {
      const amt = safeNum(p.amount);
      return acc + (amt > 0 ? amt : 0);
    }, 0);
  }, [payments]);

  const expenseOutTotal = useMemo(() => {
    return (expenses || []).reduce((acc, x) => (isIncomeRow(x) ? acc : acc + safeNum(x.amount)), 0);
  }, [expenses]);

  const incomeOtherTotal = useMemo(() => {
    return (expenses || []).reduce((acc, x) => (isIncomeRow(x) ? acc + safeNum(x.amount) : acc), 0);
  }, [expenses]);

  const netCash = useMemo(() => {
    return paymentsTotal + incomeOtherTotal - expenseOutTotal;
  }, [paymentsTotal, incomeOtherTotal, expenseOutTotal]);

  const approxProfit = useMemo(() => {
    return sales + incomeOtherTotal - expenseOutTotal;
  }, [sales, incomeOtherTotal, expenseOutTotal]);

  const financialSummary = useMemo(() => {
    const cashIncome = (expenses || []).reduce((acc, x) => (isIncomeRow(x) && isCashMethod(x.method) ? acc + safeNum(x.amount) : acc), 0);
    const cashExpense = (expenses || []).reduce((acc, x) => (!isIncomeRow(x) && isCashMethod(x.method) ? acc + safeNum(x.amount) : acc), 0);
    return {
      cash: cashIn - cashOutRefunds + cashIncome - cashExpense,
      income: paymentsTotal + incomeOtherTotal,
      expenses: expenseOutTotal,
      debts,
      net: netCash,
    };
  }, [cashIn, cashOutRefunds, paymentsTotal, incomeOtherTotal, expenseOutTotal, debts, netCash, expenses]);

  const stockDist = useMemo(() => {
    const arr = (cardTypes || [])
      .map((ct) => ({
        id: ct.id,
        name: ct.name || `#${ct.id}`,
        stock: readStock(ct),
        price: readPrice(ct),
        cost: readCost(ct),
        low_stock_threshold: ct.low_stock_threshold ?? null,
        alert_qty: ct.alert_qty ?? null,
      }))
      .filter((x) => x.name);
    arr.sort((a, b) => b.stock - a.stock);
    return arr;
  }, [cardTypes]);

  const moveRows = useMemo(() => {
    return (moves || []).slice(0, 7).map((r) => { 
      const cardName =
        pick(r, ["card_name", "card_type_name", "name"], "") || pick(r?.card_types, ["name"], "-");

      const after = pick(r, ["after_qty", "balance_after", "after"], null) ?? pick(r, ['"after"'], null);

      return {
        id: r.id,
        created_at: r.created_at,
        type: String(r.movement_type || "").toUpperCase(),
        card: cardName || "-",
        qty: safeNum(r.qty),
        after: after !== null ? safeNum(after) : "",
      };
    });
  }, [moves]);
  
  return (
    <div className="page" style={{ padding: '20px' }}>
      <div className="page-head" style={{ marginBottom: '24px' }}>
        <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
          <div style={customStyles.badgePrimary}>الرئيسية</div>
          <h2 style={{ margin: "10px 0 0", fontSize: '2.5rem', color: 'var(--accent)' }}>لوحة التحكم</h2>
          <div style={customStyles.miniTitle}>
            فلاتر التاريخ تتحكم في كل الأرقام. حركة اليوم تعتمد على {movesUsingView ? "✅ View v_card_movements" : "ℹ️ Table card_movements"}.
          </div>
        </div>

        <div className="row" style={{ gap: 12, marginTop: '16px' }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: 'var(--muted)' }}>
            من
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: 'var(--muted)' }}>
            إلى
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </label>
          <button className="btn btn-primary" onClick={refreshAll} disabled={loading}>
            {loading ? 'جارٍ التحديث...' : 'تحديث البيانات'}
          </button>
        </div>
      </div>

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
          <div style={customStyles.miniTitle}>إضافات (IN)</div>
          <div style={customStyles.miniValue(false)}>{qty(addsQty)}</div>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <div style={customStyles.miniTitle}>عدد العملاء</div>
          <div style={customStyles.miniValue(false)}>{customersCount}</div>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <div style={customStyles.miniTitle}>الديون</div>
          <div style={customStyles.miniValue(false)}>{money(debts)}</div>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <div style={customStyles.miniTitle}>الصافي (تقريبي)</div>
          <div style={customStyles.miniValue(netCash > 0)}>{money(approxProfit)}</div>
        </div>
      </div>

      <div className="card" style={{ ...customStyles.cardSection }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={customStyles.badgePrimary}>ملخص الفترة المالية</div>
            <h3 style={{ margin: "10px 0 0", fontSize: '1.5rem', color: 'var(--accent2)' }}>Financial Overview</h3>
            <div style={customStyles.miniTitle}>
              نقدًا/دخل/مصروفات/ديون/صافي نقد — حسب الفترة المحددة.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 12, flexGrow: 1 }}>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(56, 189, 248, 0.1)' }}>
              <div style={customStyles.miniTitle}>نقدًا</div>
              <div style={customStyles.miniValue(false)}>{money(financialSummary.cash)}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(34, 197, 94, 0.1)' }}>
              <div style={customStyles.miniTitle}>دخل (سداد)</div>
              <div style={customStyles.miniValue(true)}>{money(financialSummary.income)}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)' }}>
              <div style={customStyles.miniTitle}>مصروفات</div>
              <div style={customStyles.miniValue(false)}>{money(financialSummary.expenses)}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(255, 200, 70, 0.1)' }}>
              <div style={customStyles.miniTitle}>ديون</div>
              <div style={customStyles.miniValue(false)}>{money(financialSummary.debts)}</div>
            </div>
            <div className="card" style={{ padding: '12px 16px', background: financialSummary.net > 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)' }}>
              <div style={customStyles.miniTitle}>صافي نقد</div>
              <div style={customStyles.miniValue(financialSummary.net > 0)}>{money(financialSummary.net)}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ marginBottom: '16px' }}>
            <div style={customStyles.badgePrimary}>المخزون</div>
            <h3 style={{ margin: "8px 0 0", fontSize: '1.25rem' }}>Stock Distribution</h3>
            <div style={customStyles.miniTitle}>
              جدول سريع يوضح الرصيد لكل كرت (أكثر 25 كرت متوفر).
            </div>
          </div>

          <div className="table-wrap" style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>#</th><th>الكرت</th><th style={{ textAlign: 'center' }}>الرصيد الفعلي</th><th style={{ textAlign: 'center' }}>السعر</th></tr>
              </thead>
              <tbody>
                {stockDist.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: "center", color: 'var(--muted)', padding: '20px' }}>
                      لا توجد بيانات كروت
                    </td></tr>
                ) : (
                  stockDist.slice(0, 25).map((x, idx) => {
                    const qtyNow = Number(x.stock || 0) || 0;
                    const th = Number(x.low_stock_threshold ?? x.alert_qty ?? lowStockThreshold ?? 0) || 0;
                    const isZero = qtyNow === 0;
                    const isLow  = qtyNow > 0 && qtyNow <= th;
                    const stockColor = isZero ? "var(--danger)" : isLow ? "var(--warning)" : "var(--accent)";
                    return (
                      <tr key={x.id ?? idx} style={{ backgroundColor: isZero ? "rgba(239, 68, 68, 0.10)" : isLow ? "rgba(245, 158, 11, 0.10)" : "transparent" }}>
                        <td>{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>{x.name}</td>
                        <td style={{ fontWeight: 900, textAlign: "center", color: stockColor }}>
                          {qty(qtyNow)}
                          {isZero && <div style={{ fontSize: 11 }}>(نفذ)</div>}
                          {!isZero && isLow && <div style={{ fontSize: 11 }}>(قريب ينفذ)</div>}
                        </td>
                        <td style={{ textAlign: "center" }}>{money(x.price)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 16, color: 'var(--muted)', fontSize: 12, borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
            ملاحظة: “الرصيد الفعلي” يعتمد على أحد الأعمدة (qty / stock_qty / current_qty / balance…).
          </div>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: '16px' }}>
            <div>
              <div style={customStyles.badgePrimary}>سجل الحركة</div>
              <h3 style={{ margin: "8px 0 0", fontSize: '1.25rem' }}>IN / OUT Movements (آخر 7 حركات)</h3>
              <div style={customStyles.miniTitle}>
                وقت/نوع/كمية/الرصيد بعد الحركة.
              </div>
            </div>
            <div className="card" style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)' }}>
              <div style={customStyles.miniTitle}>إجمالي OUT</div>
              <div style={customStyles.miniValue(false)}>{qty(outQty)}</div>
            </div>
          </div>

          <div className="table-wrap" style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>#</th><th>الوقت</th><th style={{ textAlign: 'center' }}>النوع</th><th>الكرت</th><th style={{ textAlign: 'center' }}>الكمية</th><th style={{ textAlign: 'center' }}>الرصيد بعد</th></tr>
              </thead>
              <tbody>
                {moveRows.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: 'var(--muted)' }}>
                      لا توجد حركات
                    </td></tr>
                ) : (
                  moveRows.map((r, idx) => (
                    <tr key={r.id ?? idx}><td>{idx + 1}</td><td>{fmtDateTime(r.created_at)}</td><td style={{ textAlign: 'center' }}><span style={customStyles.movementBadge(r.type)}>{r.type}</span></td><td>{r.card}</td><td style={{ fontWeight: 700, textAlign: 'center' }}>{qty(r.qty)}</td><td style={{ textAlign: 'center', color: 'var(--muted)' }}>{r.after === "" ? "-" : qty(r.after)}</td></tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {loading && <div style={{ padding: 10, color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>جرٍ التحميل...</div>}
        </div>
      </div>
    </div>
  );
}
