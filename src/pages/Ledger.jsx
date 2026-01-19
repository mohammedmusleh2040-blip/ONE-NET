// src/pages/Ledger.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ================= Helpers =================
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const money = (v) => safeNum(v).toFixed(2);

function pick(obj, keys, def = "") {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return def;
}

function fmtDate(iso) {
  try {
    return new Date(iso || Date.now()).toLocaleString("ar-EG");
  } catch {
    return String(iso || "");
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildRunning(rows, opening = 0) {
  let run = safeNum(opening);
  const out = [];
  for (const r of rows || []) {
    const debit = safeNum(r.debit);
    const credit = safeNum(r.credit);
    run = run + debit - credit;
    out.push({ ...r, running: run });
  }
  return out;
}

function getCardBalanceFromRow(row) {
  // نحاول نلقط أي عمود رصيد موجود (غالباً يجي من card_stock)
  return safeNum(
    pick(
      row,
      [
        "quantity", // card_stock.quantity
        "current_qty",
        "stock_qty",
        "balance",
        "current_stock",
        "available_qty",
        "remaining_qty",
      ],
      0
    )
  );
}

export default function Ledger() {
  // Tabs
  const [tab, setTab] = useState("cardMoves");


  // ===== Auth / Seller Guard =====
  const [authUser, setAuthUser] = useState(null);
  const [isSeller, setIsSeller] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = data?.user || null;
        setAuthUser(u);
        // نفترض وجود seller_user_id في الفواتير وحركات الكروت
        // إذا عندك نظام صلاحيات أدق (perms/role) عدّله هنا فقط
        setIsSeller(!!u);
      } catch {}
    })();
  }, []);
 // cardMoves | itemMoves | customerLedger | giga

  // Shared Filters
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  // ===== Giga Reports (قراءات الجيجا) =====
  const [gigaLoading, setGigaLoading] = useState(false);
  const [gigaRows, setGigaRows] = useState([]); // flat rows per invoice line
  const [gigaCustomerId, setGigaCustomerId] = useState("all");
  const [gigaQ, setGigaQ] = useState("");

  // ===== Card Moves =====
  const [loading, setLoading] = useState(false);
  const [moves, setMoves] = useState([]);
  const [cardTypes, setCardTypes] = useState([]);
  const [usingView, setUsingView] = useState(true);
  const [cardTypeId, setCardTypeId] = useState("all");
  const [mType, setMType] = useState("all"); // all | IN | OUT
  const [q, setQ] = useState("");

  // ===== Item Moves (ملخص حركة صنف + الرصيد) =====
  const [itemSearch, setItemSearch] = useState("");
  const [itemOnlyWithMoves, setItemOnlyWithMoves] = useState(true); // افتراضياً نخفي الأصناف بدون حركة

  // ===== Customer Ledger =====
  const [customers, setCustomers] = useState([]);
  const [custId, setCustId] = useState("");
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerUsingView, setLedgerUsingView] = useState(true);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerDetailed, setLedgerDetailed] = useState(false);

  // ===================== Loaders =====================
  async function loadCardTypes() {
    // نجيب الأنواع + رصيد كل نوع من card_stock (عشان يظهر الرصيد الحالي صح)
    const [{ data: types, error: typeErr }, { data: stocks, error: stockErr }] = await Promise.all([
      supabase.from("card_types").select("*").order("name", { ascending: true }),
      supabase.from("card_stock").select("card_type_id,quantity"),
    ]);

    if (typeErr) throw typeErr;
    if (stockErr) throw stockErr;

    const stockMap = new Map();
    (stocks || []).forEach((r) => stockMap.set(r.card_type_id, safeNum(r.quantity)));

    const merged = (types || []).map((t) => ({ ...t, quantity: stockMap.get(t.id) ?? 0 }));
    setCardTypes(Array.isArray(merged) ? merged : []);
  }

  async function loadCustomers() {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,type,opening_balance,phone,address,notes,created_at,price_per_gb,last_reading_gb")
      .order("name", { ascending: true });
    if (error) throw error;
    setCustomers(Array.isArray(data) ? data : []);
  }

  // ===================== Card Movements =====================
  async function loadMovements() {
    setLoading(true);
    try {
      // ✅ الآن نعتمد على View التقرير الموحد (v_card_movements_report)
      // لأنه فيه: رقم الفاتورة + العميل + المصدر + الرصيد قبل/بعد
      // وفي حالة ما كان الـ View موجود لأي سبب، نرجع تلقائياً للجدول الأساسي.

      const fromDate = `${from}`; // YYYY-MM-DD
      const toDate = `${to}`; // YYYY-MM-DD

      const tryView = async () => {
        setUsingView(true);
        let qv = supabase
          .from("v_card_movements_report")
          .select(
            "id,movement_date,stock_account_id,card_type_id,card_name,card_price,movement_type,qty,note,invoice_number,customer_name,invoice_source,balance_before,balance_after"
          )
          .gte("movement_date", fromDate)
          .lte("movement_date", toDate)
          .order("movement_date", { ascending: false })
          .order("id", { ascending: false });

        if (cardTypeId !== "all") qv = qv.eq("card_type_id", cardTypeId);
        if (mType !== "all") qv = qv.eq("movement_type", mType);
        return await qv;
      };

      const viewRes = await tryView();
      if (viewRes.error) {
        console.warn("v_card_movements_report not available, fallback to card_movements", viewRes.error);

        // fallback
        setUsingView(false);
        const fromTs = `${from}T00:00:00`;
        const toTs = `${to}T23:59:59.999`;
        let tq = supabase
          .from("card_movements")
          .select(
            "id,card_type_id,movement_type,qty,before_qty,after_qty,note,created_at,card_types(name)"
          )
          .gte("created_at", fromTs)
          .lte("created_at", toTs)
          .order("created_at", { ascending: false });
        if (cardTypeId !== "all") tq = tq.eq("card_type_id", cardTypeId);
        if (mType !== "all") tq = tq.eq("movement_type", mType);
        const res = await tq;
        if (res.error) throw res.error;
        setMoves(Array.isArray(res.data) ? res.data : []);
      } else {
        setMoves(Array.isArray(viewRes.data) ? viewRes.data : []);
      }
    } catch (e) {
      console.error(e);
      alert(e?.message || "فشل تحميل حركة الكروت");
    } finally {
      setLoading(false);
    }
  }

  // normalize card moves (View or Table)  ✅ مهم: هذا كان مخرب بالنسخة السابقة (اختلاط الأقواس داخل useMemo)
  const normalizedMoves = useMemo(() => {
    const baseRows = (moves || []).map((r, idx) => {
      const created =
        r.created_at || r.date || r.movement_date || r.createdAt || r.created || null;
      const movementType =
        r.movement_type || r.type || r.movement || r.direction || "";

      const qty = Number(r.qty ?? r.quantity ?? r.amount ?? 0) || 0;
      const noteText = String(r.note ?? r.notes ?? "");
      const invMatch = noteText.match(/INV-\d+/);
      const inferredInvoice = invMatch ? invMatch[0] : "";

      return {
        ...r,
        _idx: idx,
        created_at: created,
        movement_type: movementType,
        qty,
        card_type_id:
          r.card_type_id ?? r.cardTypeId ?? r.card_type ?? r.card_id ?? null,
        card_name: r.card_name ?? r.card_types?.name ?? r.card ?? r.name ?? r.cardTypeName ?? "",
        customer_name: r.customer_name ?? r.customer ?? "",
        invoice_no:
          r.invoice_no ?? r.invoice_number ?? r.invoice ?? inferredInvoice,
        source:
          r.invoice_source ?? r.source ?? r.src ?? (inferredInvoice ? "invoice" : ""),
        note: noteText,
        // قد تأتي من View جاهز، وإذا غير موجودة سنحسبها
        before_qty: r.before_qty ?? r.balance_before ?? r.before ?? null,
        after_qty: r.after_qty ?? r.balance_after ?? r.after ?? null,
      };
    });

    // نحسب الرصيد (قبل/بعد) لكل كرت حسب الترتيب الزمني
    baseRows.sort(
      (a, b) =>
        new Date(a.created_at || 0) - new Date(b.created_at || 0) ||
        a._idx - b._idx
    );

    const running = new Map();
    const withRunning = baseRows.map((row) => {
      const key = String(row.card_type_id ?? row.card_name ?? "unknown");
      const prevComputed = Number(running.get(key) ?? 0) || 0;

      // لو الـ before_qty موجود، نعتبره هو بداية الرصيد الحقيقي
      const before = Number(row.before_qty ?? prevComputed) || 0;
      const q = Number(row.qty) || 0;
      const afterComputed = row.movement_type === "IN" ? before + q : before - q;

      const afterFinal = Number(row.after_qty ?? afterComputed) || 0;
      running.set(key, afterFinal);

      return {
        ...row,
        before_qty: before,
        after_qty: afterFinal,
      };
    });

    // للعرض نرجّع الأحدث أولاً
    withRunning.sort(
      (a, b) =>
        new Date(b.created_at || 0) - new Date(a.created_at || 0) ||
        b._idx - a._idx
    );

    return withRunning;
  }, [moves]);

  const filteredMoves = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return normalizedMoves;
    return (normalizedMoves || []).filter((r) => {
      const a = (r.card_name || "").toLowerCase();
      const b = (r.note || "").toLowerCase();
      const c = (r.invoice_no || "").toLowerCase();
      const d = (r.customer_name || "").toLowerCase();
      const e = String(r.id || "").toLowerCase();
      return a.includes(s) || b.includes(s) || c.includes(s) || d.includes(s) || e.includes(s);
    });
  }, [normalizedMoves, q]);

  const totalsMoves = useMemo(() => {
    let inQty = 0;
    let outQty = 0;
    for (const r of filteredMoves || []) {
      if (String(r.movement_type) === "IN") inQty += safeNum(r.qty);
      if (String(r.movement_type) === "OUT") outQty += safeNum(r.qty);
    }
    return { inQty, outQty, net: inQty - outQty };
  }, [filteredMoves]);

  // ===================== Item Moves Summary =====================
  const itemSummaryRows = useMemo(() => {
    // نجمع من filteredMoves حسب الصنف
    const byId = new Map(); // card_type_id -> summary
    for (const m of filteredMoves || []) {
      const id = String(m.card_type_id ?? "");
      if (!id) continue;
      if (!byId.has(id)) {
        byId.set(id, { card_type_id: m.card_type_id, card_name: m.card_name, inQty: 0, outQty: 0, net: 0, moves: 0 });
      }
      const s = byId.get(id);
      s.moves += 1;
      if (String(m.movement_type) === "IN") s.inQty += safeNum(m.qty);
      if (String(m.movement_type) === "OUT") s.outQty += safeNum(m.qty);
      s.net = s.inQty - s.outQty;
    }

    // نضيف الرصيد من card_types حتى لو ما في حركة (اختياري)
    const out = [];
    for (const ct of cardTypes || []) {
      const id = String(ct.id);
      const name = ct.name || ct.card_name || ct.title || "-";
      const bal = getCardBalanceFromRow(ct);

      const s = byId.get(id) || { card_type_id: ct.id, card_name: name, inQty: 0, outQty: 0, net: 0, moves: 0 };
      out.push({
        ...s,
        card_name: s.card_name && s.card_name !== "-" ? s.card_name : name,
        balance_now: bal,
      });
    }

    // فلترة بحث داخل ملخص الأصناف
    const ss = String(itemSearch || "").trim().toLowerCase();
    let res = out;
    if (ss) {
      res = res.filter((r) => String(r.card_name || "").toLowerCase().includes(ss) || String(r.card_type_id).includes(ss));
    }

    if (itemOnlyWithMoves) res = res.filter((r) => safeNum(r.moves) > 0);

    // ترتيب: الأكثر حركة ثم الاسم
    res.sort((a, b) => safeNum(b.moves) - safeNum(a.moves) || String(a.card_name).localeCompare(String(b.card_name), "ar"));
    return res;
  }, [filteredMoves, cardTypes, itemSearch, itemOnlyWithMoves]);

  const selectedCardType = useMemo(() => {
    if (cardTypeId === "all") return null;
    return (cardTypes || []).find((x) => String(x.id) === String(cardTypeId)) || null;
  }, [cardTypes, cardTypeId]);

  const selectedBalanceNow = useMemo(() => {
    if (!selectedCardType) return 0;
    return getCardBalanceFromRow(selectedCardType);
  }, [selectedCardType]);

  // ===================== Customer Ledger =====================
  async function fetchInvoiceDetails(invoiceIds) {
    const map = new Map();

    // 1) try view
    try {
      const { data, error } = await supabase.from("v_invoice_lines").select("*").in("invoice_id", invoiceIds);
      if (error) throw error;

      (data || []).forEach((l) => {
        const invId = Number(l.invoice_id);
        const name = l.card_name ?? l.name ?? l.card_type_name ?? l.item_name ?? "-";
        const qty = safeNum(l.qty);
        const price = safeNum(l.price);
        const total = safeNum(l.line_total ?? qty * price);

        if (!map.has(invId)) map.set(invId, []);
        map.get(invId).push({ item: name, qty, price, total, note: l.note || "" });
      });

      return map;
    } catch (e) {
      console.warn("v_invoice_lines not available, fallback to invoice_line_items", e);
    }

    // 2) fallback: invoice_line_items + card_types
    const { data, error } = await supabase
      .from("invoice_line_items")
      .select("invoice_id,card_type_id,qty,price,line_total,usage_gb,prev_reading_gb,curr_reading_gb,price_per_gb,card_types(name)")
      .in("invoice_id", invoiceIds);

    if (error) throw error;

    (data || []).forEach((l) => {
      const invId = Number(l.invoice_id);
      const isGiga = l.usage_gb !== null && l.usage_gb !== undefined;

      const name = isGiga
        ? `جيجا: ${safeNum(l.prev_reading_gb)} → ${safeNum(l.curr_reading_gb)} (استهلاك ${safeNum(l.usage_gb)})`
        : l.card_types?.name || `كرت ${l.card_type_id}`;

      const qty = isGiga ? safeNum(l.usage_gb) : safeNum(l.qty);
      const price = isGiga ? safeNum(l.price_per_gb) : safeNum(l.price);
      const total = safeNum(l.line_total ?? qty * price);

      if (!map.has(invId)) map.set(invId, []);
      map.get(invId).push({ item: name, qty, price, total, note: "" });
    });

    return map;
  }

  function expandLedgerWithDetails(baseRows, detailsMap) {
    const out = [];
    for (const r of baseRows || []) {
      out.push(r);

      const isInvoice = String(r.kind || "").includes("فاتورة");
      const invId = Number(r.invoice_id || 0);
      if (!isInvoice || !invId) continue;

      const lines = detailsMap.get(invId) || [];
      for (const ln of lines) {
        out.push({
          created_at: r.created_at,
          kind: "— بند فاتورة",
          ref: r.ref,
          debit: 0,
          credit: 0,
          note:
            `${ln.item} | qty=${safeNum(ln.qty)} | price=${money(ln.price)} | total=${money(ln.total)}` +
            (ln.note ? ` | ${ln.note}` : ""),
          invoice_id: invId,
          is_detail: true,
        });
      }
    }
    return out;
  }

  async function loadCustomerLedger() {
    if (!custId) return;
    setLedgerLoading(true);
    try {
      const dTo = new Date(to);
      dTo.setDate(dTo.getDate() + 1);
      const toPlus1 = dTo.toISOString().slice(0, 10);

      const fromTs = `${from}T00:00:00`;
      const toTs = `${toPlus1}T00:00:00`;

      const cid = Number(custId);
      const cust = (customers || []).find((c) => Number(c.id) === cid);
      const opening = safeNum(cust?.opening_balance);

      // 1) try view first (if exists)
      try {
        const { data, error } = await supabase
          .from("v_customer_ledger")
          .select("*")
          .eq("customer_id", cid)
          .gte("created_at", fromTs)
          .lt("created_at", toTs)
          .order("created_at", { ascending: true });

      // إجبارية للبائع
      if (isSeller && authUser?.id) {
        // في حال كان البائع مربوط بفواتيره فقط
        // نفترض وجود seller_user_id
        // @ts-ignore
        // eslint-disable-next-line
        // supabase يعيد query جديد
      }

        if (error) throw error;

        // حماية: أحيانًا يرجع Supabase null أو Object بدل Array
        const safeData = Array.isArray(data) ? data : [];
        const rows = safeData.map((r) => ({
          created_at: r.created_at,
          kind: r.kind || r.type || "-",
          ref: r.ref_no || r.invoice_no || r.payment_no || r.reference || "-",
          debit: safeNum(r.debit),
          credit: safeNum(r.credit),
          note: r.note || r.memo || "",
          invoice_id: r.invoice_id || null,
          is_detail: false,
        }));

        setLedgerUsingView(true);

        if (ledgerDetailed) {
          const invIds = Array.from(new Set(rows.filter((x) => x.invoice_id).map((x) => Number(x.invoice_id))));
          if (invIds.length) {
            const details = await fetchInvoiceDetails(invIds);
            const expanded = expandLedgerWithDetails(rows, details);
            setLedgerRows(buildRunning(expanded, opening));
          } else {
            setLedgerRows(buildRunning(rows, opening));
          }
        } else {
          setLedgerRows(buildRunning(rows, opening));
        }
        return;
      } catch (e) {
        setLedgerUsingView(false);
        console.warn("v_customer_ledger not available, using invoices+payments", e);
      }

      // 2) fallback: invoices + payments
      const { data: invs, error: invErr } = await supabase
        .from("invoices")
        .select("id,number,invoice_date,total_after_discount,note,created_at")
        .eq("customer_id", cid)
        .gte("created_at", fromTs)
        .lt("created_at", toTs)
        .order("created_at", { ascending: true });

      if (invErr) throw invErr;

      const { data: pays, error: payErr } = await supabase
        .from("payments")
        .select("id,amount,method,payment_type,reference,note,created_at,invoice_id")
        .eq("customer_id", cid)
        .gte("created_at", fromTs)
        .lt("created_at", toTs)
        .order("created_at", { ascending: true });

      if (payErr) throw payErr;

      const safeInvs = Array.isArray(invs) ? invs : [];
      const invRows = safeInvs.map((x) => ({
        created_at: x.created_at || `${x.invoice_date}T12:00:00`,
        kind: "فاتورة",
        ref: x.number || `INV-${String(x.id).padStart(6, "0")}`,
        debit: safeNum(x.total_after_discount),
        credit: 0,
        note: x.note || "",
        invoice_id: x.id,
        is_detail: false,
      }));

      const safePays = Array.isArray(pays) ? pays : [];
      const payRows = safePays.map((p) => {
        const amt = safeNum(p.amount);
        return {
          created_at: p.created_at,
          kind: amt >= 0 ? "سداد" : "مرتجع",
          ref: p.reference || (p.invoice_id ? `فاتورة#${p.invoice_id}` : `PAY-${p.id}`),
          debit: amt < 0 ? Math.abs(amt) : 0,
          credit: amt >= 0 ? amt : 0,
          note: p.note || "",
          invoice_id: p.invoice_id || null,
          is_detail: false,
        };
      });

      const merged = [...invRows, ...payRows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      if (ledgerDetailed) {
        const invIds = Array.from(new Set(invRows.map((x) => Number(x.invoice_id)).filter(Boolean)));
        const details = invIds.length ? await fetchInvoiceDetails(invIds) : new Map();
        const expanded = expandLedgerWithDetails(merged, details);
        setLedgerRows(buildRunning(expanded, opening));
      } else {
        setLedgerRows(buildRunning(merged, opening));
      }
    } catch (e) {
      console.error(e);
      alert(e?.message || "فشل تحميل كشف الحساب");
    } finally {
      setLedgerLoading(false);
    }
  }

  const selectedCustomer = useMemo(() => {
    if (!custId) return null;
    return (customers || []).find((c) => String(c.id) === String(custId)) || null;
  }, [customers, custId]);

  const ledgerFiltered = useMemo(() => {
    const s = String(ledgerSearch || "").trim().toLowerCase();
    if (!s) return ledgerRows;

    return (ledgerRows || []).filter((r) => {
      const a = String(r.kind || "").toLowerCase();
      const b = String(r.ref || "").toLowerCase();
      const c = String(r.note || "").toLowerCase();
      return a.includes(s) || b.includes(s) || c.includes(s);
    });
  }, [ledgerRows, ledgerSearch]);

  const ledgerSummary = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const r of ledgerFiltered || []) {
      debit += safeNum(r.debit);
      credit += safeNum(r.credit);
    }
    const opening = safeNum(selectedCustomer?.opening_balance);
    const closing = opening + debit - credit;
    return { debit, credit, opening, closing };
  }, [ledgerFiltered, selectedCustomer]);

  // ===================== Giga Report =====================
  const gigaFilteredRows = useMemo(() => {
    const rows = gigaRows || [];
    const s = String(gigaQ || "").trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) => (r.customer_name || "").toLowerCase().includes(s) || String(r.invoice_id || "").includes(s)
    );
  }, [gigaRows, gigaQ]);

  const gigaSummary = useMemo(() => {
    const rows = gigaFilteredRows || [];
    const invCount = new Set(rows.map((r) => r.invoice_id)).size;
    const custCount = new Set(rows.map((r) => r.customer_id)).size;
    const usageSum = rows.reduce((a, r) => a + safeNum(r.usage_gb), 0);
    const amountSum = rows.reduce((a, r) => a + safeNum(r.line_total), 0);
    return { invoices: invCount, customers: custCount, usage: usageSum, amount: amountSum };
  }, [gigaFilteredRows]);

  async function loadGigaReport() {
    setGigaLoading(true);
    try {
      // 1) invoices (giga only) in date range
      let qInv = supabase
        .from("invoices")
        .select("id,invoice_date,customer_id,invoice_type,total_after_discount,paid_amount,remaining_amount,created_at")
        .eq("invoice_type", "giga")
        .gte("invoice_date", from)
        .lte("invoice_date", to)
        .order("invoice_date", { ascending: true });

      if (gigaCustomerId !== "all") qInv = qInv.eq("customer_id", gigaCustomerId);

      const { data: invs, error: eInv } = await qInv;
      if (eInv) throw eInv;

      const safeInvs = Array.isArray(invs) ? invs : [];

      const invoiceIds = safeInvs.map((x) => Number(x.id)).filter(Boolean);
      if (invoiceIds.length === 0) {
        setGigaRows([]);
        return;
      }

      // 2) lines (usage only)
      const { data: lines, error: eLines } = await supabase
        .from("invoice_line_items")
        .select("invoice_id,prev_reading_gb,curr_reading_gb,usage_gb,price_per_gb,line_total")
        .in("invoice_id", invoiceIds);

      if (eLines) throw eLines;

      // 3) customers map
      const custIds = Array.from(new Set(safeInvs.map((x) => Number(x.customer_id)).filter(Boolean)));
      const { data: custs, error: eCust } = await supabase
        .from("customers")
        .select("id,name,type,price_per_gb,last_reading_gb")
        .in("id", custIds);

      if (eCust) throw eCust;

      const custMap = new Map((custs || []).map((c) => [Number(c.id), c]));
      const invMap = new Map(safeInvs.map((i) => [Number(i.id), i]));

      // flat rows
      const safeLines = Array.isArray(lines) ? lines : [];
      const rows = safeLines
        .filter((l) => l.usage_gb !== null && l.usage_gb !== undefined)
        .map((l, idx) => {
          const inv = invMap.get(Number(l.invoice_id)) || {};
          const cust = custMap.get(Number(inv.customer_id)) || {};
          const prev = safeNum(l.prev_reading_gb);
          const curr = safeNum(l.curr_reading_gb);
          const usage = safeNum(l.usage_gb ?? Math.max(0, curr - prev));
          const ppg = safeNum(l.price_per_gb ?? cust.price_per_gb ?? 0);
          const total = safeNum(l.line_total ?? usage * ppg);
          return {
            key: `${l.invoice_id}-${idx}`,
            invoice_id: Number(l.invoice_id),
            invoice_date: inv.invoice_date || (inv.created_at ? String(inv.created_at).slice(0, 10) : ""),
            customer_id: Number(inv.customer_id || 0),
            customer_name: cust.name || "",
            prev_reading_gb: prev,
            curr_reading_gb: curr,
            usage_gb: usage,
            price_per_gb: ppg,
            line_total: total,
          };
        });

      setGigaRows(rows);
    } catch (err) {
      console.error(err);
      alert(err?.message || "تعذر تحميل تقرير الجيجا");
    } finally {
      setGigaLoading(false);
    }
  }

  function printGigaReport() {
    const rows = gigaFilteredRows || [];
    const title = "تقرير الجيجا";
    const hdr = `
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
        <div>
          <div style="font-weight:800;font-size:18px;margin-bottom:4px;">${title}</div>
          <div style="color:#666;font-size:12px;">الفترة: ${from} → ${to}</div>
        </div>
        <div style="text-align:left;color:#666;font-size:12px;">طباعة: ${new Date().toLocaleString()}</div>
      </div>
      <hr style="border:none;border-top:1px solid #ddd;margin:12px 0;" />
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#333;">
        <div>عدد الفواتير: <b>${gigaSummary.invoices}</b></div>
        <div>عدد العملاء: <b>${gigaSummary.customers}</b></div>
        <div>إجمالي الاستهلاك (GB): <b>${money(gigaSummary.usage)}</b></div>
        <div>إجمالي المبلغ: <b>${money(gigaSummary.amount)}</b></div>
      </div>
    `;
    const table = `
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px;">
        <thead>
          <tr><th style="border:1px solid #ddd;padding:6px;">#</th><th style="border:1px solid #ddd;padding:6px;">التاريخ</th><th style="border:1px solid #ddd;padding:6px;">العميل</th><th style="border:1px solid #ddd;padding:6px;">فاتورة</th><th style="border:1px solid #ddd;padding:6px;">قراءة سابقة</th><th style="border:1px solid #ddd;padding:6px;">قراءة حالية</th><th style="border:1px solid #ddd;padding:6px;">استهلاك</th><th style="border:1px solid #ddd;padding:6px;">سعر الجيجا</th><th style="border:1px solid #ddd;padding:6px;">الإجمالي</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r, i) => `
            <tr><td style="border:1px solid #ddd;padding:6px;">${i + 1}</td><td style="border:1px solid #ddd;padding:6px;">${r.invoice_date || ""}</td><td style="border:1px solid #ddd;padding:6px;">${r.customer_name || ""}</td><td style="border:1px solid #ddd;padding:6px;">${r.invoice_id}</td><td style="border:1px solid #ddd;padding:6px;">${r.prev_reading_gb}</td><td style="border:1px solid #ddd;padding:6px;">${r.curr_reading_gb}</td><td style="border:1px solid #ddd;padding:6px;">${r.usage_gb}</td><td style="border:1px solid #ddd;padding:6px;">${money(r.price_per_gb)}</td><td style="border:1px solid #ddd;padding:6px;">${money(r.line_total)}</td></tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;

    const html = `
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <title>${title}</title>
          <style>
            body{ font-family: Arial, sans-serif; padding:16px; }
            @media print { .no-print{ display:none !important; } }
          </style>
        </head>
        <body>
          ${hdr}
          ${table}
          <script>window.onload=function(){ window.print(); };</script>
        </body>
      </html>
    `;
    const w = window.open("", "_blank");
    if (!w) return alert("المتصفح منع نافذة الطباعة");
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // auto reload on tab/filters
  useEffect(() => {
    if (tab === "giga") loadGigaReport();
    // eslint-disable-next-line
  }, [tab, from, to, gigaCustomerId]);

  // ===================== Printing =====================
  async function getSettingsHeader() {
    try {
      const { data } = await supabase.from("settings").select("*").limit(1).maybeSingle();
      return {
        name: data?.company_name || data?.shop_name || data?.network_name || "شبكة ون نت اللاسلكية",
        nameEn: data?.company_name_en || data?.shop_name_en || "Network One Net Wireless",
        phone: data?.phone || "",
        address: data?.address || "",
        logo: data?.logo_base64 || data?.logo_url || "",
      };
    } catch {
      return { name: "OneNet", phone: "", address: "", logo: "" };
    }
  }

  function basePrintCss() {
    // ستايل قريب من الفواتير: نظيف، حدود خفيفة، عنوان قوي
    return `
      body{font-family: Arial, sans-serif; padding:18px; color:#111}
      .head{display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:14px}
      .title{font-size:18px; font-weight:900}
      .sub{font-size:12px; color:#555; margin-top:4px}
      .box{border:1px solid #ddd; border-radius:12px; padding:10px 12px}
      table{width:100%; border-collapse:collapse; margin-top:12px}
      th,td{border:1px solid #ddd; padding:8px; font-size:12px; vertical-align:top}
      th{background:#f4f6fb}
      .sum{display:flex; gap:10px; justify-content:flex-end; margin-top:10px; flex-wrap:wrap}
      .kpi{min-width:140px}
      .kpi .v{font-size:16px; font-weight:900}
      .muted{color:#666; font-size:12px}
      @media print{ body{padding:0} }
    `;
  }

  async function printCardMoves() {
    const hdr = await getSettingsHeader();
    const rows = filteredMoves || [];

    const htmlRows = rows
      .map((r, idx) => {
        const isIn = String(r.movement_type) === "IN";
        return `
          <tr><td>${idx + 1}</td><td>${escapeHtml(fmtDate(r.created_at))}</td><td>${escapeHtml(r.card_name)}</td><td>${isIn ? "IN" : "OUT"}</td><td>${escapeHtml(r.source)}</td><td>${escapeHtml(r.invoice_no)}</td><td>${escapeHtml(r.customer_name)}</td><td style="font-weight:800">${escapeHtml(r.qty)}</td><td>${escapeHtml(r.before_qty ?? "")}</td><td>${escapeHtml(r.after_qty ?? "")}</td><td>${escapeHtml(r.note || "-")}</td></tr>
        `;
      })
      .join("");

    const w = window.open("", "_blank");
    if (!w) return alert("السماح بالنوافذ المنبثقة مطلوب للطباعة");

    w.document.write(`
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>تقرير حركة الكروت</title>
        <style>${basePrintCss()}</style>
      </head>
      <body>
        <div class="head">
          <div class="box">
            <div class="title">${hdr.logo ? `<img src="${hdr.logo}" style="height:54px;object-fit:contain" />` : ""}${escapeHtml(
              hdr.name
            )} — تقرير حركة الكروت</div>
            <div class="sub">من: ${escapeHtml(from)} | إلى: ${escapeHtml(to)}</div>
            <div class="sub">${usingView ? "المصدر: View v_card_movements" : "المصدر: Table card_movements"}</div>
          </div>
          <div class="box">
            <div class="sub">هاتف: ${escapeHtml(hdr.phone)}</div>
            <div class="sub">عنوان: ${escapeHtml(hdr.address)}</div>
            <div class="sub">وقت الطباعة: ${escapeHtml(new Date().toLocaleString("ar-EG"))}</div>
          </div>
        </div>

        <div class="sum">
          <div class="box kpi"><div class="muted">IN</div><div class="v">${money(totalsMoves.inQty)}</div></div>
          <div class="box kpi"><div class="muted">OUT</div><div class="v">${money(totalsMoves.outQty)}</div></div>
          <div class="box kpi"><div class="muted">الصافي</div><div class="v">${money(totalsMoves.net)}</div></div>
          ${cardTypeId !== "all" ? `<div class="box kpi"><div class="muted">الرصيد الحالي</div><div class="v">${money(
            selectedBalanceNow
          )}</div></div>` : ""}
        </div>

        <table>
          <thead>
            <tr><th>#</th><th>التاريخ</th><th>الكرت</th><th>الحركة</th><th>المصدر</th><th>فاتورة</th><th>العميل</th><th>الكمية</th><th>قبل</th><th>بعد</th><th>ملاحظة</th></tr>
          </thead>
          <tbody>
            ${htmlRows || `<tr><td colspan="11" style="text-align:center;color:#777">لا توجد بيانات</td></tr>`}
          </tbody>
        </table>

        <script>setTimeout(()=>window.print(), 250);</script>
      </body>
      </html>
    `);
    w.document.close();
  }

  async function printItemMovesSummary() {
    const hdr = await getSettingsHeader();
    const rows = itemSummaryRows || [];

    const htmlRows = rows
      .map((r, idx) => {
        return `
          <tr><td>${idx + 1}</td><td>${escapeHtml(r.card_name)}</td><td>${escapeHtml(r.card_type_id)}</td><td style="font-weight:800">${escapeHtml(money(r.balance_now))}</td><td>${escapeHtml(money(r.inQty))}</td><td>${escapeHtml(money(r.outQty))}</td><td>${escapeHtml(money(r.net))}</td><td>${escapeHtml(r.moves)}</td></tr>
        `;
      })
      .join("");

    const w = window.open("", "_blank");
    if (!w) return alert("السماح بالنوافذ المنبثقة مطلوب للطباعة");

    w.document.write(`
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>تقرير حركة الأصناف + الرصيد</title>
        <style>${basePrintCss()}</style>
      </head>
      <body>
        <div class="head">
          <div class="box">
            <div class="title">${hdr.logo ? `<img src="${hdr.logo}" style="height:54px;object-fit:contain" />` : ""}${escapeHtml(
              hdr.name
            )} — تقرير حركة الأصناف + الرصيد</div>
            <div class="sub">من: ${escapeHtml(from)} | إلى: ${escapeHtml(to)}</div>
            <div class="sub">يعرض: الرصيد الحالي + إجمالي IN/OUT خلال الفترة</div>
          </div>
          <div class="box">
            <div class="sub">هاتف: ${escapeHtml(hdr.phone)}</div>
            <div class="sub">عنوان: ${escapeHtml(hdr.address)}</div>
            <div class="sub">وقت الطباعة: ${escapeHtml(new Date().toLocaleString("ar-EG"))}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr><th>#</th><th>الصنف</th><th>ID</th><th>الرصيد الحالي</th><th>IN</th><th>OUT</th><th>الصافي</th><th>عدد الحركات</th></tr>
          </thead>
          <tbody>
            ${htmlRows || `<tr><td colspan="8" style="text-align:center;color:#777">لا توجد بيانات</td></tr>`}
          </tbody>
        </table>

        <script>setTimeout(()=>window.print(), 250);</script>
      </body>
      </html>
    `);
    w.document.close();
  }

  async function printCustomerLedger() {
    const hdr = await getSettingsHeader();
    const cust = selectedCustomer;
    if (!cust) return alert("اختر عميل");

    const rows = ledgerFiltered || [];

    const htmlRows = rows
      .map((r, idx) => {
        const isDetail = !!r.is_detail;
        return `
          <tr style="${isDetail ? "opacity:0.85;" : ""}"><td>${idx + 1}</td><td>${escapeHtml(fmtDate(r.created_at))}</td><td>${escapeHtml(r.kind)}</td><td>${escapeHtml(r.ref || "-")}</td><td>${isDetail ? "" : escapeHtml(money(r.debit))}</td><td>${isDetail ? "" : escapeHtml(money(r.credit))}</td><td>${isDetail ? "" : escapeHtml(money(r.running))}</td><td>${escapeHtml(r.note || "-")}</td></tr>
        `;
      })
      .join("");

    const w = window.open("", "_blank");
    if (!w) return alert("السماح بالنوافذ المنبثقة مطلوب للطباعة");

    w.document.write(`
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>كشف حساب عميل</title>
        <style>${basePrintCss()}</style>
      </head>
      <body>
        <div class="head">
          <div class="box">
            <div class="title">${hdr.logo ? `<img src="${hdr.logo}" style="height:54px;object-fit:contain" />` : ""}${escapeHtml(
              hdr.name
            )} — كشف حساب عميل</div>
            <div class="sub">العميل: <b>${escapeHtml(cust.name || "-")}</b></div>
            <div class="sub">من: ${escapeHtml(from)} | إلى: ${escapeHtml(to)}</div>
            <div class="sub">${ledgerUsingView ? "المصدر: View v_customer_ledger" : "المصدر: invoices + payments"}</div>
            <div class="sub">الوضع: ${ledgerDetailed ? "مفصل" : "مختصر"}</div>
          </div>
          <div class="box">
            <div class="sub">هاتف: ${escapeHtml(hdr.phone)}</div>
            <div class="sub">عنوان: ${escapeHtml(hdr.address)}</div>
            <div class="sub">وقت الطباعة: ${escapeHtml(new Date().toLocaleString("ar-EG"))}</div>
          </div>
        </div>

        <div class="sum">
          <div class="box kpi"><div class="muted">افتتاحي</div><div class="v">${money(ledgerSummary.opening)}</div></div>
          <div class="box kpi"><div class="muted">مدين</div><div class="v">${money(ledgerSummary.debit)}</div></div>
          <div class="box kpi"><div class="muted">دائن</div><div class="v">${money(ledgerSummary.credit)}</div></div>
          <div class="box kpi"><div class="muted">ختامي</div><div class="v">${money(ledgerSummary.closing)}</div></div>
        </div>

        <table>
          <thead>
            <tr><th>#</th><th>التاريخ</th><th>النوع</th><th>مرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th>ملاحظة</th></tr>
          </thead>
          <tbody>
            ${htmlRows || `<tr><td colspan="8" style="text-align:center;color:#777">لا توجد بيانات</td></tr>`}
          </tbody>
        </table>

        <script>setTimeout(()=>window.print(), 250);</script>
      </body>
      </html>
    `);
    w.document.close();
  }

  // ===================== init =====================
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadCardTypes(), loadCustomers()]);
        await loadMovements();
      } catch (e) {
        console.error(e);
        alert(e?.message || "فشل تحميل صفحة التقارير");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===================== UI =====================
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="badge">التقارير</div>
          <h2 style={{ margin: "8px 0 0" }}>التقارير</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            {tab === "cardMoves" && <>حركة الكروت تشمل IN/OUT (ومن الفواتير أيضاً). {usingView ? "✅ View" : "ℹ️ Table"}.</>}
            {tab === "itemMoves" && <>حركة صنف + الرصيد الحالي (من card_types) مع إجمالي IN/OUT خلال الفترة.</>}
            {tab === "customerLedger" && <>كشف حساب عميل (مختصر/مفصل) مع طباعة بنفس ستايل الفواتير.</>}
            {tab === "giga" && <>تقرير الجيجا (قراءات/استهلاك/سعر) خلال فترة، مع طباعة.</>}
          </div>
        </div>

        <div className="actions-row no-print" style={{ gap: 8 }}>
          <button className={"btn " + (tab === "cardMoves" ? "" : "btn-outline")} onClick={() => setTab("cardMoves")}>
            حركة الكروت
          </button>
          <button className={"btn " + (tab === "itemMoves" ? "" : "btn-outline")} onClick={() => setTab("itemMoves")}>
            حركة صنف + الرصيد
          </button>
          <button className={"btn " + (tab === "customerLedger" ? "" : "btn-outline")} onClick={() => setTab("customerLedger")}>
            كشف حساب عميل
          </button>
          <button className={"btn " + (tab === "giga" ? "" : "btn-outline")} onClick={() => setTab("giga")}>
            تقرير الجيجا
          </button>

          {tab === "cardMoves" && (
            <>
              <button className="btn btn-outline" onClick={loadMovements} disabled={loading}>
                تحديث
              </button>
              <button className="btn" onClick={printCardMoves} disabled={loading}>
                طباعة
              </button>
            </>
          )}

          {tab === "itemMoves" && (
            <>
              <button className="btn btn-outline" onClick={loadMovements} disabled={loading}>
                تحديث
              </button>
              <button className="btn" onClick={printItemMovesSummary} disabled={loading}>
                طباعة
              </button>
            </>
          )}

          {tab === "customerLedger" && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px", color: "var(--muted)", fontSize: 12 }}>
                <input type="checkbox" checked={ledgerDetailed} onChange={(e) => setLedgerDetailed(e.target.checked)} />
                مفصل
              </label>

              <button className="btn btn-outline" onClick={loadCustomerLedger} disabled={ledgerLoading || !custId}>
                تحديث
              </button>
              <button className="btn" onClick={printCustomerLedger} disabled={ledgerLoading || !custId}>
                طباعة
              </button>
            </>
          )}

          {tab === "giga" && (
            <>
              <select className="input" style={{ minWidth: 220 }} value={gigaCustomerId} onChange={(e) => setGigaCustomerId(e.target.value)}>
                <option value="all">كل عملاء الجيجا</option>
                {(customers || []).filter((c) => String(c.type || "") === "giga").map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>

              <input className="input" style={{ minWidth: 220 }} placeholder="بحث (اسم العميل أو رقم الفاتورة)" value={gigaQ} onChange={(e) => setGigaQ(e.target.value)} />

              <button className="btn btn-outline" onClick={loadGigaReport} disabled={gigaLoading}>
                تحديث
              </button>
              <button className="btn" onClick={printGigaReport} disabled={gigaLoading || !(gigaFilteredRows || []).length}>
                طباعة
              </button>
            </>
          )}
        </div>
      </div>

      {/* =============== حركة الكروت =============== */}
      {tab === "cardMoves" && (
        <>
          <div className="card no-print" style={{ marginBottom: 12 }}>
            <div className="grid4">
              <label>
                من
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                إلى
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>

              <label>
                نوع الحركة
                <select className="input" value={mType} onChange={(e) => setMType(e.target.value)}>
                  <option value="all">الكل</option>
                  <option value="IN">إدخال (IN)</option>
                  <option value="OUT">إخراج (OUT)</option>
                </select>
              </label>

              <label>
                نوع الكرت
                <select className="input" value={cardTypeId} onChange={(e) => setCardTypeId(e.target.value)}>
                  <option value="all">الكل</option>
                  {(cardTypes || []).map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid2" style={{ marginTop: 10 }}>
              <label>
                بحث
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الكرت / فاتورة / عميل / ملاحظة / رقم الحركة" />
                  <button type="button" className="btn btn-outline" onClick={() => setQ("")} style={{ whiteSpace: "nowrap" }}>
                    مسح
                  </button>
                </div>
              </label>

              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <div className="mini-card">
                  <div className="mini-title">إجمالي IN</div>
                  <div className="mini-value">{money(totalsMoves.inQty)}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">إجمالي OUT</div>
                  <div className="mini-value">{money(totalsMoves.outQty)}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">الصافي</div>
                  <div className="mini-value">{money(totalsMoves.net)}</div>
                </div>
                {cardTypeId !== "all" && (
                  <div className="mini-card">
                    <div className="mini-title">الرصيد الحالي</div>
                    <div className="mini-value">{money(selectedBalanceNow)}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>التاريخ</th><th>الكرت</th><th>الحركة</th><th>المصدر</th><th>فاتورة</th><th>العميل</th><th>الكمية</th><th>قبل</th><th>بعد</th><th>ملاحظة</th></tr>
                </thead>
                <tbody>
                  {(filteredMoves || []).length === 0 ? (
                    <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)" }}>
                        لا توجد حركات
                      </td></tr>
                  ) : (
                    (filteredMoves || []).map((r, idx) => {
                      const isIn = String(r.movement_type) === "IN";
                      return (
                        <tr key={r.id}><td>{idx + 1}</td><td>{fmtDate(r.created_at)}</td><td>{r.card_name}</td><td>
                            <span className={"pill " + (isIn ? "pill-in" : "pill-out")}>{isIn ? "IN" : "OUT"}</span>
                          </td><td>{r.source}</td><td>{r.invoice_no}</td><td>{r.customer_name}</td><td style={{ fontWeight: 900 }}>{r.qty}</td><td>{r.before_qty}</td><td>{r.after_qty}</td><td style={{ maxWidth: 320, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.note || "-"}</td></tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {loading && <div style={{ padding: 12, color: "var(--muted)", fontSize: 12 }}>جارٍ التحميل...</div>}
          </div>
        </>
      )}

      {/* =============== حركة صنف + الرصيد =============== */}
      {tab === "itemMoves" && (
        <>
          <div className="card no-print" style={{ marginBottom: 12 }}>
            <div className="grid4">
              <label>
                من
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                إلى
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>

              <label>
                بحث صنف
                <input className="input" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="ابحث بالصنف..." />
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={itemOnlyWithMoves} onChange={(e) => setItemOnlyWithMoves(e.target.checked)} />
                إظهار الأصناف التي لها حركة فقط
              </label>
            </div>

            <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
              ملاحظة: الرصيد الحالي يتم قراءته من جدول <b>card_types</b> (عمود qty/current_qty/stock_qty... حسب الموجود عندك).
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>الصنف</th><th>ID</th><th>الرصيد الحالي</th><th>IN</th><th>OUT</th><th>الصافي</th><th>عدد الحركات</th></tr>
                </thead>
                <tbody>
                  {(itemSummaryRows || []).length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)" }}>
                        لا توجد بيانات
                      </td></tr>
                  ) : (
                    (itemSummaryRows || []).map((r, idx) => (
                      <tr key={String(r.card_type_id) + "_" + idx}><td>{idx + 1}</td><td>{r.card_name}</td><td>{r.card_type_id}</td><td style={{ fontWeight: 900 }}>{money(r.balance_now)}</td><td>{money(r.inQty)}</td><td>{money(r.outQty)}</td><td>{money(r.net)}</td><td>{r.moves}</td></tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {loading && <div style={{ padding: 12, color: "var(--muted)", fontSize: 12 }}>جارٍ التحميل...</div>}
          </div>
        </>
      )}

      {/* =============== كشف حساب عميل =============== */}
      {tab === "customerLedger" && (
        <>
          <div className="card no-print" style={{ marginBottom: 12 }}>
            <div className="grid4">
              <label>
                من
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                إلى
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>

              <label>
                العميل *
                <select className="input" value={custId} onChange={(e) => setCustId(e.target.value)}>
                  <option value="">اختر عميل...</option>
                  {(customers || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                بحث
                <input className="input" value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)} placeholder="نوع/مرجع/ملاحظة..." />
              </label>
            </div>

            <div className="grid2" style={{ marginTop: 10 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div className="mini-card">
                  <div className="mini-title">افتتاحي</div>
                  <div className="mini-value">{money(ledgerSummary.opening)}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">مدين</div>
                  <div className="mini-value">{money(ledgerSummary.debit)}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">دائن</div>
                  <div className="mini-value">{money(ledgerSummary.credit)}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">ختامي</div>
                  <div className="mini-value">{money(ledgerSummary.closing)}</div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-end" }}>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {ledgerUsingView ? "✅ View v_customer_ledger" : "ℹ️ invoices + payments"} — {ledgerDetailed ? "مفصل" : "مختصر"}
                </div>
              </div>
            </div>

            {selectedCustomer && (
              <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 12 }}>
                العميل: <b style={{ color: "var(--text)" }}>{selectedCustomer.name}</b> — الافتتاحي:
                <b style={{ color: "var(--text)" }}>{money(selectedCustomer.opening_balance)}</b>
              </div>
            )}
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>التاريخ</th><th>النوع</th><th>مرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th>ملاحظة</th></tr>
                </thead>
                <tbody>
                  {!custId ? (
                    <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)" }}>
                        اختر عميل ثم اضغط (تحديث)
                      </td></tr>
                  ) : (ledgerFiltered || []).length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)" }}>
                        لا توجد بيانات
                      </td></tr>
                  ) : (
                    (ledgerFiltered || []).map((r, idx) => (
                      <tr key={idx} style={r.is_detail ? { opacity: 0.85 } : undefined}><td>{idx + 1}</td><td>{fmtDate(r.created_at)}</td><td style={r.is_detail ? { color: "var(--muted)" } : undefined}>{r.kind}</td><td>{r.ref || "-"}</td><td>{r.is_detail ? "" : money(r.debit)}</td><td>{r.is_detail ? "" : money(r.credit)}</td><td>{r.is_detail ? "" : money(r.running)}</td><td style={{ maxWidth: 420, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.note || "-"}</td></tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {ledgerLoading && <div style={{ padding: 12, color: "var(--muted)", fontSize: 12 }}>جارٍ التحميل...</div>}
          </div>
        </>
      )}

      {/* =============== تقرير الجيجا =============== */}
      {tab === "giga" && (
        <>
          <div className="card no-print" style={{ marginBottom: 12 }}>
            <div className="grid4">
              <label>
                من
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                إلى
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>

              <label>
                العميل
                <select className="input" value={gigaCustomerId} onChange={(e) => setGigaCustomerId(e.target.value)}>
                  <option value="all">كل عملاء الجيجا</option>
                  {(customers || []).filter((c) => String(c.type || "") === "giga").map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                بحث
                <input className="input" value={gigaQ} onChange={(e) => setGigaQ(e.target.value)} placeholder="اسم العميل أو رقم الفاتورة..." />
              </label>
            </div>

            <div className="grid2" style={{ marginTop: 10 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div className="mini-card">
                  <div className="mini-title">عدد الفواتير</div>
                  <div className="mini-value">{gigaSummary.invoices}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">عدد العملاء</div>
                  <div className="mini-value">{gigaSummary.customers}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">إجمالي GB</div>
                  <div className="mini-value">{money(gigaSummary.usage)}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">إجمالي المبلغ</div>
                  <div className="mini-value">{money(gigaSummary.amount)}</div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-end", gap: 8 }}>
                <button className="btn btn-outline" onClick={loadGigaReport} disabled={gigaLoading}>
                  تحديث
                </button>
                <button className="btn" onClick={printGigaReport} disabled={gigaLoading || !(gigaFilteredRows || []).length}>
                  طباعة
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>التاريخ</th><th>العميل</th><th>فاتورة</th><th>قراءة سابقة</th><th>قراءة حالية</th><th>استهلاك</th><th>سعر الجيجا</th><th>الإجمالي</th></tr>
                </thead>
                <tbody>
                  {(gigaFilteredRows || []).length === 0 ? (
                    <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
                        لا توجد بيانات
                      </td></tr>
                  ) : (
                    gigaFilteredRows.map((r, idx) => (
                      <tr key={r.key || idx}><td>{idx + 1}</td><td>{r.invoice_date}</td><td>{r.customer_name}</td><td>{r.invoice_id}</td><td>{r.prev_reading_gb}</td><td>{r.curr_reading_gb}</td><td style={{ fontWeight: 900 }}>{r.usage_gb}</td><td>{money(r.price_per_gb)}</td><td style={{ fontWeight: 900 }}>{money(r.line_total)}</td></tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {gigaLoading && <div style={{ padding: 12, color: "var(--muted)", fontSize: 12 }}>جارٍ التحميل...</div>}
          </div>
        </>
      )}
    </div>
  );
}