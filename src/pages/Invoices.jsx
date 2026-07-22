// src/pages/Invoices.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { effectivePerms, currentUser } from "../lib/auth";

// ===== Helpers =====
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => safeNum(v).toFixed(2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

function calcCustomerDebt(openingDebt, invoicesRemaining, unlinkedPayments) {
  let pay = Number(unlinkedPayments || 0);
  const opening = Number(openingDebt || 0);
  const invRem = Number(invoicesRemaining || 0);

  const openingAfter = Math.max(0, opening - pay);
  pay = Math.max(0, pay - opening);

  const invoicesAfter = Math.max(0, invRem - pay);
  return openingAfter + invoicesAfter;
}

function asPaidStatus(remaining) {
  return safeNum(remaining) <= 0 ? "paid" : "unpaid";
}

function statusUi(inv) {
  const note = String(inv?.note || "");
  if (note.includes("[VOID]")) return { key: "void", ar: "ملغاة" };
  if (note.includes("[REFUND]")) return { key: "refund", ar: "مرتجع" };

  const paid = safeNum(inv.paid_amount);
  const rem = safeNum(inv.remaining_amount);
  if (rem <= 0) return { key: "paid", ar: "مدفوعة" };
  if (paid > 0 && rem > 0) return { key: "partial", ar: "مدفوعة جزئياً" };
  return { key: "unpaid", ar: "غير مدفوعة" };
}

export default function Invoices() {
  // ===== Permissions =====
  const perms = useMemo(() => effectivePerms(), []);
  const user = currentUser?.() || null;
  const isSuper = (user?.role === 'super_admin') || perms?.super_admin === true;
  const isSeller = String(user?.role || '').toLowerCase() === 'seller';
  const canUseCashier = isSeller;
  const [posMode, setPosMode] = useState(() => isSeller);
  const [vendorStock, setVendorStock] = useState([]);
  const canEditInvoice = isSuper || perms?.invoices_edit === true;
  const canDeleteInvoice = isSuper || perms?.invoices_delete === true;
  const canRefundInvoice = isSuper || perms?.invoices_edit === true; 
  
  const canRefundThis = (inv) => {
    const note = String(inv?.note || "");
    if (note.includes("[VOID]") || note.includes("[REFUND]")) return false;
    if (inv?.is_refund) return false;
    return safeNum(inv?.paid_amount) > 0;
  };

  const [tab, setTab] = useState("create"); 
  const [loading, setLoading] = useState(false);
  const [networkSettings, setNetworkSettings] = useState({ name: "شبكة ون نت اللاسلكية", phone: "", address: "", logo: "" });

  // ===== Toast =====
  const [toast, setToast] = useState({ open: false, text: "", type: "ok" }); 
  const toastTimer = useRef(null);
  const showToast = (text, type = "ok") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ open: true, text, type });
    toastTimer.current = setTimeout(() => setToast({ open: false, text: "", type: "ok" }), 2200);
  };

  // ===== Cashier summary (for seller) =====
  const [cashierFrom, setCashierFrom] = useState(todayISO());
  const [cashierTo, setCashierTo] = useState(todayISO());
  const [cashierLoading, setCashierLoading] = useState(false);
  const [cashierSummary, setCashierSummary] = useState({
    invoicesCount: 0,
    salesTotal: 0, 
    invoicesCollectedTotal: 0, 
    invoicesRemainingTotal: 0, 
    paymentsInTotal: 0, 
    paymentsOutTotal: 0, 
    collectedTotal: 0,
    remainingTotal: 0,
  });

  // ===== Master data =====
  const [customers, setCustomers] = useState([]);
  const [unlinkedPaymentsByCustomer, setUnlinkedPaymentsByCustomer] = useState({});
  const [cards, setCards] = useState([]); 

  const cardsForUi = useMemo(() => {
    if (!(isSeller && posMode)) return cards;
    const priceMap = new Map((cards || []).map((c) => [String(c.card_type_id), c]));
    return (vendorStock || [])
      .map((v) => {
        const key = String(v.card_type_id);
        const c = priceMap.get(key);
        return {
          card_type_id: v.card_type_id,
          name: v.card_name || c?.name || `كرت ${v.card_type_id}`,
          price: safeNum(c?.price ?? 0),
          quantity: safeNum(v.qty ?? 0), 
        };
      })
      .filter((x) => x.card_type_id != null);
  }, [isSeller, posMode, vendorStock, cards]);
  
  const [invoices, setInvoices] = useState([]);

  // ===== منع التكرار + وضع تعديل =====
  const [saving, setSaving] = useState(false);
  const [clientUid, setClientUid] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const isEditMode = !!editMode;
  const [editInvoiceId, setEditInvoiceId] = useState(null);
  const [editOldLines, setEditOldLines] = useState([]);

  // ===== Create invoice =====
  const [invoiceType, setInvoiceType] = useState("cards"); 
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 16));
  const [customerId, setCustomerId] = useState("");
  const [note, setNote] = useState("");

  // Customer Autocomplete
  const [customerQuery, setCustomerQuery] = useState("");
  const [showCustomerList, setShowCustomerList] = useState(false);
  const customerBoxRef = useRef(null);

  // Discount + payment now
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [cashReceived, setCashReceived] = useState("");

  // Lines (cards)
  const [selCardId, setSelCardId] = useState("");
  const [selQty, setSelQty] = useState(1);
  const [selPrice, setSelPrice] = useState(0);
  const [lines, setLines] = useState([]);

  // Giga fields
  const [prevReading, setPrevReading] = useState(0);
  const [currReading, setCurrReading] = useState("");
  const [pricePerGb, setPricePerGb] = useState(0);

  // Search in list
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invScope, setInvScope] = useState("all"); 
  const [paymentFilter, setPaymentFilter] = useState("all"); 

  // Pay modal
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState("cash");
  const [payRef, setPayRef] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 16));

  const didInit = useRef(false);

  // ===== Derived =====
  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(customerId)),
    [customers, customerId]
  );

  const isGigaCustomer = useMemo(() => {
    const t = (selectedCustomer?.type || "").toLowerCase();
    return t === "giga" || t === "جيجا";
  }, [selectedCustomer]);

  const subtotal = useMemo(() => {
    if (invoiceType === "cards") return lines.reduce((s, x) => s + safeNum(x.line_total), 0);
    const usage = safeNum(currReading) - safeNum(prevReading);
    return Math.max(0, usage) * safeNum(pricePerGb);
  }, [invoiceType, lines, currReading, prevReading, pricePerGb]);

  const discountValue = useMemo(() => {
    const p = Math.max(0, Math.min(100, safeNum(discountPercent)));
    return subtotal * (p / 100);
  }, [subtotal, discountPercent]);

  const totalAfterDiscount = useMemo(() => Math.max(0, subtotal - discountValue), [subtotal, discountValue]);
  const remaining = useMemo(() => Math.max(0, totalAfterDiscount - safeNum(paidAmount)), [totalAfterDiscount, paidAmount]);

  const cashReceivedNum = useMemo(() => safeNum(cashReceived), [cashReceived]);
  const cashierPaid = useMemo(() => Math.min(totalAfterDiscount, cashReceivedNum), [totalAfterDiscount, cashReceivedNum]);
  const cashierChange = useMemo(() => Math.max(0, cashReceivedNum - totalAfterDiscount), [cashReceivedNum, totalAfterDiscount]);
  const cashierRemaining = useMemo(() => Math.max(0, totalAfterDiscount - cashReceivedNum), [totalAfterDiscount, cashReceivedNum]);

  useEffect(() => {
    if (!posMode) return;
    if (isEditMode) return;
    if (cashReceived === "" || cashReceived == null) return;
    const nextPaid = cashierPaid;
    if (Math.abs(safeNum(paidAmount) - safeNum(nextPaid)) > 0.00001) {
      setPaidAmount(nextPaid);
    }
  }, [posMode, isEditMode, cashReceived, cashierPaid, paidAmount]);

  const customerDebt = useMemo(() => {
    if (!selectedCustomer) return 0;
    const cid = Number(selectedCustomer.id);
    const opening = safeNum(selectedCustomer.opening_balance);
    const invoicesRemaining = (invoices || [])
      .filter((i) => Number(i.customer_id) === cid)
      .reduce((s, i) => s + safeNum(i.remaining_amount), 0);
    const unlinked = safeNum(unlinkedPaymentsByCustomer?.[String(cid)] || 0);
    return calcCustomerDebt(opening, invoicesRemaining, unlinked);
  }, [selectedCustomer, invoices, unlinkedPaymentsByCustomer]);

  // ===== Loaders =====
  async function loadSettings() {
    try {
      const { data } = await supabase.from("settings").select("*").limit(1).maybeSingle();
      if (data) {
        setNetworkSettings({
          name: data.company_name || data.shop_name || data.network_name || "شبكة ون نت اللاسلكية",
          phone: data.phone || "",
          address: data.address || "",
          logo: data.logo_base64 || data.logo_url || ""
        });
      }
    } catch (e) {
      console.error("فشل جلب إعدادات الشبكة", e);
    }
  }

  async function loadCustomers() {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,type,opening_balance,phone,address,notes,created_at,price_per_gb,last_reading_gb,discount_percent")
      .order("name", { ascending: true });
    if (error) throw error;
    setCustomers(data || []);
    return data || [];
  }

  async function loadUnlinkedPayments() {
    const { data, error } = await supabase
      .from("payments")
      .select("customer_id, amount, invoice_id")
      .is("invoice_id", null);
    if (error) throw error;

    const map = {};
    (data || []).forEach((r) => {
      const cid = String(r.customer_id ?? "");
      if (!cid) return;
      const amt = safeNum(r.amount || 0);
      map[cid] = safeNum(map[cid] || 0) + Math.max(0, amt);
    });
    setUnlinkedPaymentsByCustomer(map);
    return map;
  }

  async function loadCardBalances() {
    if (isSeller) {
      const q = supabase
        .from("v_vendor_stock_balances")
        .select("card_type_id, card_name, price, balance")
        .eq("seller_user_id", user?.id)
        .order("price", { ascending: true });

      const { data, error } = await q;
      if (error) {
        setCards([]);
        return;
      }
      setCards((data || []).map((r) => ({
        card_type_id: r.card_type_id,
        name: r.card_name,
        price: Number(r.price || 0),
        quantity: Number(r.balance || 0),
      })));
      return;
    }

    const { data: balances, error } = await supabase.from("v_card_balances").select("card_type_id, balance");
    if (error) return;

    const balMap = new Map((balances || []).map((r) => [r.card_type_id, Number(r.balance || 0)]));
    const { data: types, error: typeErr } = await supabase.from("card_types").select("id,name,price").order("price", { ascending: true });
    if (typeErr) return;

    setCards((types || []).map((t) => ({
      card_type_id: t.id,
      name: t.name,
      price: Number(t.price || 0),
      quantity: Number(balMap.get(t.id) || 0),
    })));
  }

  async function loadVendorStock() {
    try {
      if (!isSeller) { setVendorStock([]); return; }
      const { data, error } = await supabase
        .from("v_vendor_stock_balances")
        .select("card_type_id, card_name, price, balance")
        .eq("seller_user_id", user?.id)
        .order("price", { ascending: true });

      if (error) throw error;
      setVendorStock(Array.isArray(data) ? data.map((r) => ({ card_type_id: r.card_type_id, qty: Number(r.balance || 0), card_name: r.card_name })) : []);
    } catch (e) {
      setVendorStock([]);
    }
  }

  async function rpcVendorMove({ card_type_id, qty, noteText, movement_type, ref_id, invoice_id, movement_date }) {
    const refIdNum = Number(ref_id) || Number(String(ref_id || '').match(/(\d+)/)?.[1]);
    const invIdNum = Number(invoice_id) || Number(String(invoice_id || '').match(/(\d+)/)?.[1]) || refIdNum;

    if (!Number.isFinite(refIdNum)) return { ok: false, skipped: true };

    const payload = {
      p_card_type_id: Number(card_type_id),
      p_movement_type: String(movement_type || 'OUT').toUpperCase(),
      p_qty: Number(qty || 0),
      p_note: noteText || null,
      p_ref_type: 'invoice',
      p_ref_id: refIdNum,
      p_invoice_id: invIdNum,
      p_movement_date: (movement_date ? String(movement_date) : '').slice(0, 10) || null,
    };

    try {
      const { data: existing } = await supabase
        .from('card_movements')
        .select('id')
        .eq('ref_type', 'invoice')
        .eq('ref_id', payload.p_ref_id)
        .eq('movement_type', payload.p_movement_type)
        .maybeSingle();

      if (existing?.id) {
        await supabase.from('card_movements').update({ card_type_id: payload.p_card_type_id, qty: payload.p_qty, note: payload.p_note, invoice_id: payload.p_invoice_id, movement_date: payload.p_movement_date }).eq('id', existing.id);
        return { ok: true };
      }

      await supabase.rpc('vendor_stock_move_v2', payload);
      return { ok: true };
    } catch (e) {
      return { ok: false, skipped: true };
    }
  }

  async function applyVendorOutByLines(invNumberOrId, invDateStr, invLines, sellerId) {
    if (!sellerId) return;
    const totals = lines.reduce((m, l) => m.set(Number(l.card_type_id), (m.get(Number(l.card_type_id)) || 0) + safeNum(l.qty)), new Map());
    for (const [cardTypeId, totalQty] of totals.entries()) {
      await rpcVendorMove({ card_type_id: cardTypeId, qty: totalQty, noteText: 'invoice movement', movement_type: 'OUT', ref_id: invNumberOrId, invoice_id: invNumberOrId, movement_date: invDateStr });
    }
  }

  async function applyVendorInByLines(invNumberOrId, invDateStr, invLines, sellerId, reasonTag) {
    if (!sellerId) return;
    const totals = lines.reduce((m, l) => m.set(Number(l.card_type_id), (m.get(Number(l.card_type_id)) || 0) + safeNum(l.qty)), new Map());
    for (const [cardTypeId, totalQty] of totals.entries()) {
      await rpcVendorMove({ card_type_id: cardTypeId, qty: totalQty, noteText: reasonTag || 'رجوع', movement_type: 'IN', ref_id: invNumberOrId, invoice_id: invNumberOrId, movement_date: invDateStr });
    }
  }

  async function loadInvoices(customersList = customers) {
    let q = supabase.from("v_invoices").select("*").order("id", { ascending: false });
    if (isSeller && user?.id) q = q.eq("seller_user_id", user.id);

    const { data: vData } = await q;
    if (vData) {
      setInvoices((vData || []).map((r) => ({
        ...r,
        total_before_discount: r.total_before_discount ?? 0,
        discount_percent: r.discount_percent ?? 0,
        discount_value: r.discount_value ?? 0,
        total_after_discount: r.total_after_discount ?? 0,
        paid_amount: r.paid_amount ?? 0,
        remaining_amount: r.remaining_amount ?? 0,
      })));
      return;
    }

    let q2 = supabase.from("invoices").select("*").order("id", { ascending: false });
    if (isSeller && user?.id) q2 = q2.eq("seller_user_id", user.id);

    const { data } = await q2;
    const cm = new Map((customersList || []).map((c) => [c.id, c.name]));
    setInvoices((data || []).map((x) => ({ ...x, customer_name: cm.get(x.customer_id) || "" })));
  }

  const loadCashierSummary = async () => {
    if (!isSeller || !user?.id) return;
    setCashierLoading(true);
    try {
      const fromDate = cashierFrom || todayISO();
      const toDate = cashierTo || fromDate;

      const { data: invRows } = await supabase
        .from("invoices")
        .select("id,total_after_discount,paid_amount,remaining_amount,invoice_date")
        .eq("seller_user_id", user.id)
        .gte("invoice_date", fromDate)
        .lte("invoice_date", toDate);

      const invs = invRows || [];
      const invoicesCount = invs.length;
      const salesTotal = invs.reduce((s, x) => s + safeNum(x.total_after_discount), 0);
      const invoicesRemainingTotal = invs.reduce((s, x) => s + safeNum(x.remaining_amount), 0);
      const invoicesCollectedTotal = invs.reduce((s, x) => s + safeNum(x.paid_amount), 0);

      let paymentsInTotal = 0;
      let paymentsOutTotal = 0;

      const { data: payRows } = await supabase
        .from("payments")
        .select("amount")
        .eq("seller_user_id", user.id)
        .gte("pay_date", fromDate)
        .lte("pay_date", toDate);

      if (payRows) {
        for (const p of payRows) {
          const a = safeNum(p.amount);
          if (a >= 0) paymentsInTotal += a;
          else paymentsOutTotal += Math.abs(a);
        }
      }

      setCashierSummary({
        invoicesCount, salesTotal, invoicesCollectedTotal, invoicesRemainingTotal, paymentsInTotal, paymentsOutTotal,
        collectedTotal: invoicesCollectedTotal + paymentsInTotal - paymentsOutTotal, remainingTotal: invoicesRemainingTotal,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setCashierLoading(false);
    }
  };

  useEffect(() => {
    if (!canUseCashier || !posMode) return;
    loadCashierSummary();
    // eslint-disable-next-line
  }, [canUseCashier, posMode, user?.id, cashierFrom, cashierTo]);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        setLoading(true);
        await loadSettings();
        const cs = await loadCustomers();
        await loadUnlinkedPayments();
        await loadCardBalances();
        await loadVendorStock();
        await loadInvoices(cs);
      } catch (e) {
        showToast("خطأ في تحميل البيانات", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedCustomer) return;
    if (isGigaCustomer) {
      setPrevReading(safeNum(selectedCustomer.last_reading_gb));
      setPricePerGb(safeNum(selectedCustomer.price_per_gb));
      setCurrReading("");
      setInvoiceType((cur) => (cur === "cards" ? "giga" : cur));
    } else {
      if (invoiceType === "giga") setInvoiceType("cards");
    }
    // eslint-disable-next-line
  }, [selectedCustomer, isGigaCustomer]);

  useEffect(() => {
    if (selectedCustomer) setCustomerQuery(selectedCustomer.name || "");
  }, [selectedCustomer]);

  useEffect(() => {
    if (!customerQuery && !editMode) setCustomerId("");
    // eslint-disable-next-line
  }, [customerQuery]);

  useEffect(() => {
    function onDocClick(e) {
      if (!customerBoxRef.current) return;
      if (!customerBoxRef.current.contains(e.target)) setShowCustomerList(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (invoiceType !== "cards") return;
    const c = cardsForUi.find((x) => String(x.card_type_id) === String(selCardId));
    if (c) setSelPrice(safeNum(c.price));
  }, [selCardId, invoiceType, cardsForUi]);

  function addLine() {
    const c = cardsForUi.find((x) => String(x.card_type_id) === String(selCardId));
    if (!c) return showToast("اختر كرت من المخزون", "warn");

    const qty = Math.max(1, safeNum(selQty));
    const price = Math.max(0, safeNum(selPrice));

    const already = lines.find((l) => String(l.card_type_id) === String(c.card_type_id));
    const usedQty = already ? safeNum(already.qty) : 0;
    if (qty + usedQty > safeNum(c.quantity)) return showToast(`الرصيد غير كافي. المتاح: ${c.quantity}`, "warn");

    setLines((prev) => {
      const idx = prev.findIndex((l) => String(l.card_type_id) === String(c.card_type_id));
      if (idx >= 0) {
        const copy = [...prev];
        const newQty = safeNum(copy[idx].qty) + qty;
        copy[idx] = { ...copy[idx], qty: newQty, price, line_total: newQty * price };
        return copy;
      }
      return [...prev, { card_type_id: c.card_type_id, name: c.name, qty, price, line_total: qty * price }];
    });
    setSelQty(1);
  }

  function removeLine(i) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  function resetForm() {
    setEditMode(false);
    setEditInvoiceId(null);
    setEditOldLines([]);
    setClientUid(null);
    setInvoiceType("cards");
    setInvoiceDate(new Date().toISOString().slice(0, 16));
    setCustomerId("");
    setCustomerQuery("");
    setShowCustomerList(false);
    setNote("");
    setDiscountPercent(0);
    setPaidAmount(0);
    setLines([]);
    setPrevReading(0);
    setCurrReading("");
    setPricePerGb(0);
    setSelQty(1);
    setCashReceived("");
  }

  async function rpcCardMove({ card_type_id, movement_type, qty, noteText, movement_date }) {
    const { data } = await supabase.rpc("apply_card_movement", {
      p_card_type_id: Number(card_type_id), p_movement_type: String(movement_type).toUpperCase(), p_qty: Number(qty), p_note: noteText || null,
      ...(movement_date ? { p_movement_date: String(movement_date) } : {}),
    });
    return data;
  }

  async function revertCardInByLines(invNumberOrId, invDateStr, invLines, reasonTag = "رجوع") {
    for (const l of invLines) {
      const ctId = l.card_type_id;
      const qty = safeNum(l.qty);
      if (!ctId || qty <= 0) continue;
      await rpcCardMove({ card_type_id: ctId, movement_type: "IN", qty, noteText: `${reasonTag} فاتورة ${invNumberOrId}`, movement_date: invDateStr || null });
    }
  }

  function buildPrintHtml(inv, invLines, customerName, customerDebtValue = 0) {
    const invType = String(inv.invoice_type || "").toLowerCase();
    const isCards = invType === "cards";
    const dateStr = inv.invoice_date || "";

    const headCols = isCards
      ? `<tr><th>#</th><th>البند</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>`
      : `<tr><th>#</th><th>قراءة سابقة</th><th>قراءة حالية</th><th>استهلاك</th><th>سعر الجيجا</th><th>الإجمالي</th></tr>`;

    const rows = isCards
      ? (invLines || []).map((x, i) => `<tr><td>${i + 1}</td><td>${x.card_name ?? x.name ?? ""}</td><td>${safeNum(x.qty)}</td><td>${money(x.price)}</td><td>${money(safeNum(x.qty) * safeNum(x.price))}</td></tr>`).join("")
      : (invLines || []).map((x, i) => `<tr><td>${i + 1}</td><td>${safeNum(x.prev_reading_gb)}</td><td>${safeNum(x.curr_reading_gb)}</td><td>${safeNum(x.curr_reading_gb - x.prev_reading_gb)}</td><td>${money(x.price_per_gb)}</td><td>${money(x.line_total)}</td></tr>`).join("");

    return `
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>فاتورة عميل</title>
        <style>
          body{font-family:Arial, sans-serif; margin:24px; color:#111;}
          .header-table{width:100%; border:none; margin-bottom:20px;}
          .logo-area{text-align:left; vertical-align:top;}
          .logo-img{height:65px; object-fit:contain;}
          .top{display:flex; gap:14px; align-items:stretch;}
          .box{flex:1; border:1px solid #ddd; border-radius:12px; padding:14px;}
          h1{margin:0 0 10px 0; font-size:18px; color:#2b6cb0;}
          table{width:100%; border-collapse:collapse; margin-top:16px;}
          th,td{border:1px solid #ddd; padding:10px; font-size:13px; text-align:right;}
          th{background:#f4f6fb;}
          .sum{margin-top:16px; display:grid; grid-template-columns:1fr 1fr; gap:10px;}
          .row{display:flex; justify-content:space-between; padding:10px; border:1px solid #eee; border-radius:10px;}
        </style>
      </head>
      <body>
        <table class="header-table">
          <tr>
            <td>
              <h2>${networkSettings.name}</h2>
              <div style="font-size:12px; color:#555; margin-top:4px;">هاتف: ${networkSettings.phone} | العنوان: ${networkSettings.address}</div>
            </td>
            <td class="logo-area">
              ${networkSettings.logo ? `<img src="${networkSettings.logo}" class="logo-img" />` : ""}
            </td>
          </tr>
        </table>
        <hr style="border:none; border-top:1px solid #ddd; margin-bottom:15px;"/>
        <div class="top">
          <div class="box">
            <h1>بيانات الفاتورة</h1>
            <div>رقم الفاتورة: <b>${inv.number || inv.id}</b></div>
            <div>التاريخ: <b>${dateStr}</b></div>
          </div>
          <div class="box">
            <h1>بيانات العميل</h1>
            <div>الاسم: <b>${customerName || "-"}</b></div>
            <div>دين العميل: <b>${money(customerDebtValue)}</b></div>
          </div>
        </div>
        <table><thead>${headCols}</thead><tbody>${rows}</tbody></table>
        <div class="sum">
          <div class="row"><span>الإجمالي</span><b>${money(inv.total_before_discount)}</b></div>
          <div class="row"><span>قيمة الخصم</span><b>${money(inv.discount_value)}</b></div>
          <div class="row"><span>الصافي المطلوب</span><b>${money(inv.total_after_discount)}</b></div>
          <div class="row"><span>المدفوع</span><b>${money(inv.paid_amount)}</b></div>
          <div class="row"><span>الباقي</span><b>${money(inv.remaining_amount)}</b></div>
        </div>
      </body>
    </html>`;
  }

  async function previewOrPrint(mode = "print") {
    if (!customerId) return showToast("اختر العميل أولاً", "warn");
    if (invoiceType === "cards" && lines.length === 0) return showToast("أضف بند واحد على الأقل", "warn");
    if (invoiceType === "giga" && safeNum(currReading) - safeNum(prevReading) <= 0) return showToast("القراءة غير منطقية", "warn");

    const invFake = {
      id: "—", number: "PREVIEW", customer_id: Number(customerId), invoice_type: invoiceType, invoice_date: invoiceDate.slice(0,10),
      total_before_discount: subtotal, discount_percent: safeNum(discountPercent), discount_value: discountValue,
      total_after_discount: totalAfterDiscount, paid_amount: safeNum(paidAmount), remaining_amount: remaining,
    };

    const w = window.open("", "_blank", "width=900,height=900");
    w.document.open();
    w.document.write(buildPrintHtml(invFake, invoiceType === "cards" ? lines : [{prev_reading_gb: prevReading, curr_reading_gb: currReading, price_per_gb: pricePerGb, line_total: subtotal}], selectedCustomer?.name, customerDebt));
    w.document.close();
    if (mode === "print") setTimeout(() => w.print(), 250);
  }

  async function fetchInvoiceLines(invoiceId) {
    const { data } = await supabase.from("v_invoice_lines").select("*").eq("invoice_id", invoiceId);
    if (data) return data;
    const { data: d2 } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", invoiceId);
    return d2 || [];
  }

  async function voidInvoice(inv) {
    if (!inv?.id) return;
    if (safeNum(inv.paid_amount) > 0) return showToast("لا يمكن إلغاء فاتورة عليها سداد. استخدم (مرتجع).", "warn");
    if (!window.confirm("إلغاء الفاتورة وإرجاع المخزون؟")) return;

    try {
      setLoading(true);
      const { data: invRow } = await supabase.from("invoices").select("*").eq("id", inv.id).single();
      const invLines = await fetchInvoiceLines(inv.id);

      if (String(invRow.invoice_type).toLowerCase() === "cards") {
        if (invRow?.seller_user_id) {
          await applyVendorInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, invRow.seller_user_id, "رجوع (إلغاء)");
        } else {
          await revertCardInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, "رجوع (إلغاء)");
        }
      }

      await supabase.from("invoices").update({
        total_before_discount: 0, discount_percent: 0, discount_value: 0, total_after_discount: 0, paid_amount: 0, remaining_amount: 0, status: "paid",
        note: `[VOID] ملغاة - ${nowISO()}`,
      }).eq("id", inv.id);

      await loadCardBalances();
      await loadVendorStock();
      await loadInvoices();
      showToast("تم إلغاء الفاتورة", "ok");
    } catch (e) {
      showToast("فشل إلغاء الفاتورة", "err");
    } finally {
      setLoading(false);
    }
  }

  async function refundInvoice(invRow) {
    if (!invRow?.id) return;
    if (!window.confirm("عمل مرتجع لهذه الفاتورة؟")) return;

    setLoading(true);
    try {
      const { data: lines } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", invRow.id);

      const { data: refundInv, error: refundErr } = await supabase
        .from("invoices")
        .insert([{
          customer_id: invRow.customer_id, invoice_type: invRow.invoice_type, invoice_date: todayISO(),
          total_before_discount: -safeNum(invRow.total_before_discount), discount_percent: safeNum(invRow.discount_percent),
          discount_value: -safeNum(invRow.discount_value), total_after_discount: -safeNum(invRow.total_after_discount),
          paid_amount: 0, remaining_amount: 0, status: "paid", note: `[REFUND] مرتجع للفاتورة ${invRow.number || invRow.id}`, is_refund: true, refund_of_invoice_id: invRow.id,
        }]).select("id").single();

      if (refundErr) throw refundErr;
      const refundId = refundInv?.id;
      const refundNo = `REF-${String(refundId).padStart(6, "0")}`;
      await supabase.from("invoices").update({ number: refundNo }).eq("id", refundId);

      if (lines && lines.length) {
        const refundLines = lines.map((li) => ({
          invoice_id: refundId, card_type_id: li.card_type_id, qty: li.qty, price: li.price,
          prev_reading_gb: li.prev_reading_gb, curr_reading_gb: li.curr_reading_gb, usage_gb: li.usage_gb ? -li.usage_gb : null,
          price_per_gb: li.price_per_gb, line_total: -safeNum(li.line_total), line_kind: li.line_kind,
        }));
        await supabase.from("invoice_line_items").insert(refundLines);
      }

      const oldNote = String(invRow.note || "");
      await supabase.from("invoices").update({ note: oldNote ? `${oldNote}\n[REFUNDED->${refundNo}]` : `[REFUNDED->${refundNo}]` }).eq("id", invRow.id);
      await supabase
  .from("payments")
  .delete()
  .eq("invoice_id", invRow.id);

      const refundCash = safeNum(invRow?.paid_amount);
      if (refundCash > 0) {
        await supabase.from("expenses").insert({
  expense_date: todayISO(),
  category: "مرتجع مبيعات",
  amount: refundCash,
  direction: "OUT",
  method: "cash",
  note: `مرتجع الفاتورة ${invRow.number}`,
  employee_id: null,
  expense_type: "refund",
  expense_group: "sales_refund",
});
      }

      await loadCardBalances();
      await loadInvoices();
      showToast(`تم إنشاء المرتجع: ${refundNo}`, "ok");
    } catch (e) {
      showToast("فشل إنشاء المرتجع", "err");
    } finally {
      setLoading(false);
    }
  }

  async function startEdit(inv) {
    try {
      setLoading(true);
      const { data: invRow } = await supabase.from("invoices").select("*").eq("id", inv.id).maybeSingle();
      if (!invRow) return showToast("الفاتورة غير موجودة", "err");

      const invLines = await fetchInvoiceLines(inv.id);

      setEditMode(true);
      setEditInvoiceId(inv.id);
      setEditOldLines(invLines);
      setClientUid(invRow.client_uid || null);
      setInvoiceDate(invRow.invoice_datetime ? invRow.invoice_datetime.slice(0,16) : todayISO());
      setCustomerId(String(invRow.customer_id || ""));
      setInvoiceType(String(invRow.invoice_type).toLowerCase());
      setNote(invRow.note || "");
      setDiscountPercent(safeNum(invRow.discount_percent));
      setPaidAmount(safeNum(invRow.paid_amount));

      if (String(invRow.invoice_type).toLowerCase() === "cards") {
        setLines((invLines || []).map((l) => ({
          card_type_id: l.card_type_id, name: l.card_name ?? `كرت ${l.card_type_id}`, qty: safeNum(l.qty), price: safeNum(l.price), line_total: safeNum(l.line_total),
        })));
      } else {
        const one = invLines?.[0] || {};
        setPrevReading(safeNum(one.prev_reading_gb));
        setCurrReading(String(safeNum(one.curr_reading_gb)));
        setPricePerGb(safeNum(one.price_per_gb));
      }
      setTab("create");
    } catch (e) {
      showToast("فشل فتح التعديل", "err");
    } finally {
      setLoading(false);
    }
  }

  async function deleteInvoice(inv) {
    if (safeNum(inv.paid_amount) > 0) return showToast("لا يمكن حذف فاتورة عليها سداد. استخدم (مرتجع).", "warn");
    if (!confirm("هل تريد حذف الفاتورة نهائياً؟")) return;

    try {
      setLoading(true);
      const { data: invRow } = await supabase.from("invoices").select("*").eq("id", inv.id).single();
      const invLines = await fetchInvoiceLines(inv.id);

      if (String(invRow.invoice_type).toLowerCase() === "cards") {
        if (invRow?.seller_user_id) {
          await applyVendorInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, invRow.seller_user_id, "رجوع (حذف)");
        } else {
          await revertCardInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, "رجوع (حذف)");
        }
      }

      await supabase.from("invoice_line_items").delete().eq("invoice_id", inv.id);
      await supabase.from("invoices").delete().eq("id", inv.id);

      await loadCardBalances();
      await loadVendorStock();
      await loadInvoices();
      showToast("تم حذف الفاتورة بنجاح", "ok");
    } catch (e) {
      showToast("فشل حذف الفاتورة", "err");
    } finally {
      setLoading(false);
    }
  }

  async function saveInvoice() {
    try {
      if (saving) return;
      if (!customerId) return showToast("اختر العميل أولاً", "warn");

      if (invoiceType === "cards") {
        if (lines.length === 0) return showToast("أضف بند واحد على الأقل", "warn");
      } else {
        if (safeNum(currReading) - safeNum(prevReading) <= 0) return showToast("القراءة الحالية يجب أن تكون أكبر من السابقة", "warn");
      }

      setSaving(true);
      setLoading(true);

      const uid = clientUid || crypto.randomUUID();
      setClientUid(uid);
      const invoiceTotal = safeNum(totalAfterDiscount);
      const paid = safeNum(paidAmount);

      if (paid > invoiceTotal) {
        setLoading(false);
        setSaving(false);
        return showToast(`المبلغ المدفوع أكبر من قيمة الفاتورة`, "warn");
      }

      const invRow = {
        client_uid: uid, customer_id: Number(customerId), invoice_type: invoiceType,
        invoice_datetime: `${invoiceDate}:00.000+03:00`, 
        invoice_date: invoiceDate.slice(0, 10), seller_user_id: posMode ? (user?.id || null) : null,
        total_before_discount: subtotal, discount_percent: safeNum(discountPercent), discount_value: discountValue,
        total_after_discount: totalAfterDiscount, paid_amount: paid, remaining_amount: remaining,
        status: asPaidStatus(remaining), note: note || null,
      };

      let invoiceId = null;
      let invNumber = null;

      if (editMode && editInvoiceId) {
        invoiceId = editInvoiceId;
        const { data: dbInv } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();

        if (String(dbInv.invoice_type).toLowerCase() === "cards") {
          if (dbInv?.seller_user_id) {
            await applyVendorInByLines(dbInv.number || dbInv.id, dbInv.invoice_date, editOldLines, dbInv.seller_user_id, "تصحيح");
          } else {
            await revertCardInByLines(dbInv.number || dbInv.id, dbInv.invoice_date, editOldLines, "تصحيح");
          }
        }

        await supabase.from("invoice_line_items").delete().eq("invoice_id", invoiceId);
        
        // حدّث رأس الفاتورة بعد تنظيف السطر تماماً
        const { data: upInv, error: eUp } = await supabase.from("invoices").update(invRow).eq("id", invoiceId).select("*").single();
        if (eUp) throw eUp;
        invNumber = upInv.number || upInv.id;

        // ميزة المزامنة المالية وسؤال المحاسب
        const shouldUpdatePayments = window.confirm("هل تريد أيضًا تعديل تواريخ سندات القبض المرتبطة بهذه الفاتورة لتطابق التاريخ الجديد؟");
        if (shouldUpdatePayments) {
          try {
            await supabase.from("payments").update({
              pay_date: invoiceDate.slice(0, 10),
              created_at: `${invoiceDate.slice(0, 10)}T${invoiceDate.slice(11, 16)}:00.000+03:00`
            }).eq("invoice_id", invoiceId).eq("payment_type", "invoice");
          } catch (payUpErr) {
            console.warn("تعذر تحديث السندات التلقائية المرتبطة:", payUpErr);
          }
        }

        if (invoiceType === "cards") {
          const lineRows = lines.map((l) => ({ invoice_id: invoiceId, card_type_id: l.card_type_id, qty: safeNum(l.qty), price: safeNum(l.price), line_total: safeNum(l.line_total) }));
          await supabase.from("invoice_line_items").insert(lineRows);
        } else {
          const usage = Math.max(0, safeNum(currReading) - safeNum(prevReading));
          const lineTotal = usage * safeNum(pricePerGb);
          await supabase.from("invoice_line_items").insert({ invoice_id: invoiceId, prev_reading_gb: safeNum(prevReading), curr_reading_gb: safeNum(currReading), usage_gb: usage, price_per_gb: safeNum(pricePerGb), line_total: lineTotal });
          await supabase.from("customers").update({ last_reading_gb: safeNum(currReading) }).eq("id", Number(customerId));
        }

        await loadCardBalances();
        await loadVendorStock();
        await loadInvoices();
        showToast(`تم تعديل الفاتورة: ${invNumber}`, "ok");
        resetForm();
        setTab("list");
        return;
      }

      const { data: existing } = await supabase.from("invoices").select("id,number").eq("client_uid", uid).maybeSingle();
      if (existing?.id) {
        showToast("هذه الفاتورة محفوظة مسبقاً", "warn");
        setTab("list");
        return;
      }

      const { data: inserted, error: invErr } = await supabase.from("invoices").insert(invRow).select("*").single();
      if (invErr) throw invErr;

      invoiceId = inserted.id;
      const number = `INV-${String(invoiceId).padStart(6, "0")}`;
      await supabase.from("invoices").update({ number }).eq("id", invoiceId);
      invNumber = number;

      if (invoiceType === "cards") {
        const lineRows = lines.map((l) => ({ invoice_id: invoiceId, card_type_id: l.card_type_id, qty: safeNum(l.qty), price: safeNum(l.price), line_total: safeNum(l.line_total) }));
        await supabase.from("invoice_line_items").insert(lineRows);
      } else {
        const usage = Math.max(0, safeNum(currReading) - safeNum(prevReading));
        const lineTotal = usage * safeNum(pricePerGb);
        await supabase.from("invoice_line_items").insert({ invoice_id: invoiceId, prev_reading_gb: safeNum(prevReading), curr_reading_gb: safeNum(currReading), usage_gb: usage, price_per_gb: safeNum(pricePerGb), line_total: lineTotal });
        await supabase.from("customers").update({ last_reading_gb: safeNum(currReading) }).eq("id", Number(customerId));
      }

      if (paid > 0) {
        try {
          await supabase.from("payments").insert({
            customer_id: Number(customerId),
            invoice_id: invoiceId,
            pay_date: invoiceDate.slice(0, 10),
            amount: paid,
            payment_type: "invoice",
            method: "cash",
            reference: null,
            note: `سند تلقائي صادر ومضمون من الفاتورة ${invNumber}`,
            created_at: `${invoiceDate.slice(0, 10)}T${invoiceDate.slice(11, 16)}:00.000+03:00`, 
            seller_user_id: user?.id || null
          });
        } catch (payCatch) {
          console.error("فشل إنشاء السند صامتاً:", payCatch);
        }
      }

      await loadCardBalances();
      await loadVendorStock();
      await loadInvoices();
      showToast(`تم حفظ الفاتورة ${invNumber}`, "ok");
      resetForm();
      setTab("list");
    } catch (e) {
      console.error(e);
      showToast(e?.message || "فشل حفظ الفاتورة", "err");
    } finally {
      setLoading(false);
      setSaving(false);
    }
  }

  async function printSavedInvoice(inv) {
    try {
      setLoading(true);
      const linesData = await fetchInvoiceLines(inv.id);
      const custName = inv.customer_name || customers.find((c) => c.id === inv.customer_id)?.name || "";
      const opening = safeNum(customers.find((c) => c.id === inv.customer_id)?.opening_balance ?? 0);
      const invoicesRemaining = (invoices || []).filter((i) => Number(i.customer_id) === Number(inv.customer_id)).reduce((s, i) => s + safeNum(i.remaining_amount), 0);
      const unlinked = safeNum(unlinkedPaymentsByCustomer?.[String(inv.customer_id)] || 0);
      const debtVal = calcCustomerDebt(opening, invoicesRemaining, unlinked);

      const w = window.open("", "_blank", "width=900,height=900");
      w.document.open();
      w.document.write(buildPrintHtml(inv, linesData, custName, debtVal));
      w.document.close();
      setTimeout(() => w.print(), 250);
    } catch (e) {
      showToast("فشل الطباعة", "err");
    } finally {
      setLoading(false);
    }
  }

  function openPay(inv) {
    const st = statusUi(inv);
    if (st.key === "void" || st.key === "refund") return showToast("لا يمكن السداد لفاتورة ملغاة/مرتجعة", "warn");
    setPayInvoice(inv);
    setPayAmount(safeNum(inv?.remaining_amount));
    setPayMethod("cash");
    setPayRef("");
    setPayNote("");
    setPayDate(new Date().toISOString().slice(0, 16));
    setPayModalOpen(true);
  }

  async function doPay() {
    if (!payInvoice?.id) return;
    let amt = Math.max(0, safeNum(payAmount));
    if (amt <= 0) return showToast("أدخل مبلغ سداد صحيح", "warn");
    if (loading) return;


    try {
      setLoading(true);
      const invId = payInvoice.id;
      const { data: invRow } = await supabase.from("invoices").select("*").eq("id", invId).maybeSingle();

      const remainingNow = Math.max(0, safeNum(invRow.total_after_discount) - safeNum(invRow.paid_amount));
      if (remainingNow <= 0) return showToast("الفاتورة مسددة بالكامل", "info");
      if (amt > remainingNow + 1e-9) amt = remainingNow;

      const paidNew = safeNum(invRow.paid_amount) + amt;
      const remainingNew = Math.max(0, safeNum(invRow.total_after_discount) - paidNew);
      const autoNote =
  payNote?.trim()
    ? payNote.trim()
    : remainingNew > 0
      ? `سداد جزئي للفاتورة ${invRow.number} بمبلغ ${amt.toFixed(2)} ريال، والمتبقي بعد السداد ${remainingNew.toFixed(2)} ريال`
      : `سداد نهائي وإغلاق الفاتورة ${invRow.number} بمبلغ ${amt.toFixed(2)} ريال`;
      if (payMethod === "write_off") {

  const { error: pErr } = await supabase
    .from("payments")
    .insert({
      customer_id: invRow.customer_id,
      invoice_id: invId,
      pay_date: payDate.slice(0, 10),
      amount: amt,
      payment_type: "invoice",
method: "cash",
reference: null,
note: "[WRITEOFF] " + autoNote,
      created_at: `${payDate.slice(0,10)}T${payDate.slice(11,16)}:00.000+03:00`,
      seller_user_id: user?.id || null,
    });

  if (pErr) throw pErr;

  await loadInvoices();
  setPayModalOpen(false);
  showToast("تمت المسامحة بنجاح", "ok");
  return;
}

      if (payMethod !== "from_balance" && payMethod !== "write_off") {
        const { error: pErr } = await supabase.from("payments").insert({
          customer_id: invRow.customer_id, 
          invoice_id: invId, 
          pay_date: payDate.slice(0, 10), 
          amount: amt, 
          payment_type: "invoice", 
          method: payMethod, 
          reference: payRef || null, 
          note: autoNote,
          created_at: `${payDate.slice(0, 10)}T${payDate.slice(11, 16)}:00.000+03:00`, 
          seller_user_id: user?.id || null,
        });
        if (pErr) throw pErr;
      }

      // لا يتم تحديث الفاتورة من React.
// سيتم تحديث paid_amount و remaining_amount و status
// تلقائياً من جدول payments بواسطة sync_invoice_financials().
      await loadInvoices();
      setPayModalOpen(false);
      showToast("تم السداد بنجاح", "ok");
    } catch (e) {
      showToast("فشل السداد", "err");
    } finally {
      setLoading(false);
    }
  }

  function clearFilters() {
    setInvoiceSearch("");
    setInvScope("all");
    setPaymentFilter("all");
    showToast("تم تفريغ فلاتر البحث", "ok");
  }

  function printFilteredInvoices() {
    const w = window.open("", "_blank");
    const rows = filteredInvoices.map(inv => `
      <tr>
        <td>${inv.number || "-"}</td>
        <td>${inv.customer_name || "-"}</td>
        <td>${inv.invoice_date || ""}</td>
        <td>${money(inv.total_after_discount)}</td>
        <td>${money(inv.paid_amount)}</td>
        <td>${money(inv.remaining_amount)}</td>
        <td>${statusUi(inv).ar}</td>
      </tr>
    `).join("");

    let filterTitle = "تقرير كل فواتير السجل المستخرجة";
    if (paymentFilter === "paid") filterTitle = "تقرير الفواتير المدفوعة بالكامل";
    if (paymentFilter === "partial") filterTitle = "تقرير الفواتير المدفوعة جزئياً";
    if (paymentFilter === "unpaid") filterTitle = "تقرير الفواتير غير المدفوعة (الآجل القائم)";
    if (paymentFilter === "refund") filterTitle = "تقرير فواتير المرتجعات المالية";

    w.document.write(`
      <html dir="rtl">
      <head>
        <title>طباعة السجل المفلتر</title>
        <style>
          body{font-family:Tahoma, Arial, sans-serif; padding:20px; color:#111;}
          .header-print{width:100%; border:none; margin-bottom:20px;}
          .logo-img{height:60px; object-fit:contain;}
          h2{margin:0; color:#2b6cb0;}
          .title-report{text-align:center; font-size:16px; font-weight:bold; margin:20px 0; background:#f4f6fb; padding:8px; border-radius:6px;}
          table{width:100%; border-collapse:collapse; margin-top:10px;}
          th,td{border:1px solid #999; padding:8px; text-align:center; font-size:12px;}
          th{background:#f5f5f5;}
        </style>
      </head>
      <body>
        <table class="header-print">
          <tr>
            <td>
              <h2>${networkSettings.name}</h2>
              <div style="font-size:11px; color:#555; margin-top:3px;">هاتف: ${networkSettings.phone} | العنوان: ${networkSettings.address}</div>
            </td>
            <td style="text-align:left; vertical-align:top;">
              ${networkSettings.logo ? `<img src="${networkSettings.logo}" class="logo-img" />` : ""}
            </td>
          </tr>
        </table>
        <div class="title-report">${filterTitle}</div>
        <table>
          <thead>
            <tr>
              <th>رقم الفاتورة</th>
              <th>العميل</th>
              <th>التاريخ</th>
              <th>الإجمالي الصافي</th>
              <th>المدفوع</th>
              <th>المتبقي</th>
              <th>حالة الفاتورة</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="7">لا توجد بيانات تطابق هذا الفلتر حالياً</td></tr>`}
          </tbody>
        </table>
        <script>window.print();</script>
      </body>
      </html>
    `);
    w.document.close();
  }

  const filteredInvoices = useMemo(() => {
    let arr = invoices;
    if (!isSeller) {
      if (invScope === "seller") arr = arr.filter((x) => !!x.seller_user_id);
      if (invScope === "admin") arr = arr.filter((x) => !x.seller_user_id);
    }
    
    if (paymentFilter === "paid") arr = arr.filter(inv => safeNum(inv.remaining_amount) === 0);
    if (paymentFilter === "partial") arr = arr.filter(inv => safeNum(inv.paid_amount) > 0 && safeNum(inv.remaining_amount) > 0);
    if (paymentFilter === "unpaid") arr = arr.filter(inv => !inv.is_refund && safeNum(inv.remaining_amount) > 0 && safeNum(inv.paid_amount) === 0);
    if (paymentFilter === "refund") arr = arr.filter(inv => inv.is_refund);

    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return arr;

    return arr.filter((inv) => {
      const id = String(inv?.number || inv?.id || "").toLowerCase();
      const customer = String(inv?.customer_name || "").toLowerCase();
      const type = String(inv?.invoice_type || "").toLowerCase();
      const note = String(inv?.note || "").toLowerCase();
      return id.includes(q) || customer.includes(q) || type.includes(q) || note.includes(q);
    });
  }, [invoices, invoiceSearch, invScope, paymentFilter, isSeller]);

  const unpaidInvoices = useMemo(() => (filteredInvoices || []).filter((x) => safeNum(x.remaining_amount) > 0), [filteredInvoices]);
  const filteredCustomersForUi = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 20);
    return customers.filter((c) => String(c.name || "").toLowerCase().includes(q)).slice(0, 20);
  }, [customers, customerQuery]);

  return (
    <div style={{ padding: 18, direction: "rtl" }}>
      {toast.open && (
        <div style={{ position: "fixed", top: 16, right: 16, zIndex: 99999, padding: "12px 14px", borderRadius: 14, border: toast.type === "ok" ? "1px solid rgba(54, 208, 170, 0.55)" : "1px solid rgba(255, 90, 90, 0.55)", background: toast.type === "ok" ? "rgba(54, 208, 170, 0.18)" : "rgba(255, 90, 90, 0.18)", color: "#fff", minWidth: 260, backdropFilter: "blur(10px)" }}>
          {toast.text}
        </div>
      )}

      <div style={styles.headerRow}>
        <div>
          <h2 style={{ margin: 0 }}>الفواتير</h2>
          <div style={{ opacity: 0.75, fontSize: 12 }}>{editMode ? "وضع تعديل فاتورة" : "إنشاء / سجل / سداد (كروت + جيجا)"}</div>
        </div>

        <div style={styles.tabs}>
          {isSeller && (
            <button className="btn btn-outline no-print" onClick={() => setPosMode((v) => !v)}>
              🧾 وضع الكاشير: {posMode ? "مفعل" : "متوقف"}
            </button>
          )}
          <button onClick={() => setTab("create")} style={tab === "create" ? styles.tabActive : styles.tab}>إنشاء</button>
          <button onClick={() => { setTab("list"); loadInvoices(); }} style={tab === "list" ? styles.tabActive : styles.tab}>سجل</button>
          <button onClick={() => { setTab("pay"); loadInvoices(); }} style={tab === "pay" ? styles.tabActive : styles.tab}>سداد</button>
          <button onClick={() => { loadCustomers().then(cs => loadInvoices(cs)); showToast("تم التحديث", "ok"); }} style={styles.tab}>تحديث</button>
        </div>
      </div>

      {canUseCashier && posMode && (
        <div style={{ ...styles.card, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>🧾 كاشير البائع (ملخص الفترة)</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={styles.label}>من<input type="date" value={cashierFrom} onChange={(e) => setCashierFrom(e.target.value)} style={styles.input} /></label>
              <label style={styles.label}>إلى<input type="date" value={cashierTo} onChange={(e) => setCashierTo(e.target.value)} style={styles.input} /></label>
              <button className="btn btn-outline" onClick={loadCashierSummary}>{cashierLoading ? "..." : "تحديث الكاشير"}</button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 12 }}>
            <div style={styles.kpiCard}>
              <div style={styles.kpiTitle}>إجمالي المبيعات (الفواتير)</div>
              <div style={styles.kpiValue}>{money(cashierSummary.salesTotal)}</div>
              <div style={styles.kpiSub}>عدد الفواتير: {cashierSummary.invoicesCount}</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiTitle}>المقبوض داخل الفواتير</div>
              <div style={styles.kpiValue}>{money(cashierSummary.invoicesCollectedTotal)}</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiTitle}>المتبقي (آجل)</div>
              <div style={styles.kpiValue}>{money(cashierSummary.invoicesRemainingTotal)}</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiTitle}>صافي المقبوض (العهدة النقدية)</div>
              <div style={styles.kpiValue}>{money(cashierSummary.collectedTotal)}</div>
            </div>
          </div>
        </div>
      )}

      {tab === "create" && (
        <div style={styles.card}>
          {editMode && (
            <div style={styles.editBar}>
              <div>أنت الآن تعدّل فاتورة: <b>{editInvoiceId}</b></div>
              <button onClick={resetForm} style={styles.btnDanger}>إلغاء التعديل</button>
            </div>
          )}

          <div style={styles.grid3}>
            <label style={styles.label}>تاريخ ووقت الفاتورة
              <input type="datetime-local" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} style={styles.input} />
            </label>

            <label style={styles.label}>العميل *
              <div ref={customerBoxRef} style={{ position: "relative" }}>
                <input value={customerQuery} onChange={(e) => { setCustomerQuery(e.target.value); setShowCustomerList(true); }} onFocus={() => setShowCustomerList(true)} placeholder="اكتب اسم العميل..." style={styles.input} disabled={editMode} />
                {showCustomerList && !editMode && (
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, left: 0, background: "#ffffff", border: "1px solid #d0d7de", borderRadius: 12, maxHeight: 240, overflowY: "auto", zIndex: 2000, color: "#111111", boxShadow: "0 8px 24px rgba(0,0,0,.08)" }}>
                    {filteredCustomersForUi.map((c) => (
                      <div key={c.id} onClick={() => { setCustomerId(String(c.id)); setCustomerQuery(c.name || ""); setDiscountPercent(Number(c.discount_percent || 0)); setShowCustomerList(false); }} style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #eee" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f8fa")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: 700 }}>{c.name}</div>
                          {Number(c.discount_percent || 0) > 0 && <div style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid #d0d7de", background: "#f6f8fa" }}>خصم {c.discount_percent}%</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </label>

            <label style={styles.label}>نوع الفاتورة
              <select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)} style={styles.input} disabled={editMode}>
                <option value="cards">كروت</option>
                {isGigaCustomer && <option value="giga">جيجا</option>}
              </select>
            </label>
          </div>

          {selectedCustomer && (
            <div style={styles.infoBar}>
              <span>العميل: <b>{selectedCustomer.name}</b></span>
              <span style={{ opacity: 0.75 }}>النوع: <b>{selectedCustomer.type}</b></span>
              <span>دين العميل: <b>{money(customerDebt)}</b></span>
              {isGigaCustomer && (
                <span style={{ opacity: 0.75 }}>سعر الجيجا: <b>{money(selectedCustomer.price_per_gb)}</b> | آخر قراءة: <b>{safeNum(selectedCustomer.last_reading_gb)}</b></span>
              )}
            </div>
          )}

          {invoiceType === "cards" ? (
            <>
              <div style={styles.subTitle}>بنود الكروت (من المخزون النهائي)</div>
              <div style={styles.grid4}>
                <label style={styles.label}>نوع الكرت *
                  <select value={selCardId} onChange={(e) => setSelCardId(e.target.value)} style={styles.input}>
                    <option value="">اختر كرت...</option>
                    {cardsForUi.map((c) => (
                      <option key={c.card_type_id} value={c.card_type_id}>{c.name} — السعر: {money(c.price)} — المتاح: {c.quantity}</option>
                    ))}
                  </select>
                </label>
                <label style={{ ...styles.label, width: "100%" }}>الكمية
                  <input type="number" value={selQty} onChange={(e) => setSelQty(e.target.value)} style={styles.input} min="1" />
                </label>
                <label style={{ ...styles.label, width: "100%" }}>السعر
                  <input type="number" value={selPrice} onChange={(e) => setSelPrice(e.target.value)} style={styles.input} min="0" />
                </label>
                <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
                  <button onClick={addLine} style={styles.btn}>+ إضافة بند</button>
                  <button onClick={() => setLines([])} style={styles.btnGhost}>تفريغ</button>
                </div>
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>العائد المالي</th><th>إجراء</th></tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: "center", opacity: 0.7 }}>لا توجد بنود مضافة</td></tr>
                    ) : (
                      lines.map((x, i) => (
                        <tr key={i}><td>{i + 1}</td><td>{x.name}</td><td>{x.qty}</td><td>{money(x.price)}</td><td>{money(x.line_total)}</td><td><button onClick={() => removeLine(i)} style={styles.btnDanger}>حذف</button></td></tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div style={styles.subTitle}>فاتورة جيجا (تظهر فقط لعملاء giga)</div>
              <div style={styles.grid4b}>
                <label style={styles.label}>القراءة السابقة<input type="number" value={prevReading} readOnly style={{ ...styles.input, opacity: 0.9 }} /></label>
                <label style={styles.label}>القراءة الحالية *<input type="number" value={currReading} onChange={(e) => setCurrReading(e.target.value)} style={styles.input} /></label>
                <label style={styles.label}>سعر الجيجا<input type="number" value={pricePerGb} readOnly style={{ ...styles.input, opacity: 0.9 }} /></label>
                <div style={styles.infoBox}>الاستهلاك المستقطع: <b>{Math.max(0, safeNum(currReading) - safeNum(prevReading))} GB</b></div>
              </div>
            </>
          )}

          <div style={styles.grid3}>
            <label style={styles.label}>خصم %<input type="number" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} style={styles.input} min="0" max="100" /></label>
            <label style={styles.label}>المدفوع الآن<input type="number" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} style={styles.input} min="0" readOnly={editMode} /></label>
            <label style={styles.label}>ملاحظات وبيان الفاتورة<input value={note} onChange={(e) => setNote(e.target.value)} style={styles.input} placeholder="اختياري..." /></label>
          </div>

          <div style={styles.summaryRow}>
            <div style={styles.sumChip}>قبل الخصم: <b>{money(subtotal)}</b></div>
            <div style={styles.sumChip}>قيمة الخصم المستقطع: <b>{money(discountValue)}</b></div>
            <div style={styles.sumChip}>الإجمالي الصافي: <b>{money(totalAfterDiscount)}</b></div>
            <div style={styles.sumChip}>المتبقي آجل: <b>{money(remaining)}</b></div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "end", marginTop: 12 }}>
            <button onClick={() => previewOrPrint("preview")} style={styles.btn}>معاينة الفاتورة</button>
            <button onClick={saveInvoice} style={styles.btnPrimary}>{editMode ? "حفظ التعديل الحسابي" : "حفظ واعتماد الفاتورة"}</button>
          </div>
        </div>
      )}

      {tab === "list" && (
        <div style={styles.card}>
          <div style={styles.subTitle}>سجل الفواتير العام</div>
          <div style={{ display: "flex", gap: "10px", marginBottom: "15px", flexWrap: "wrap", alignItems: "center" }}>
            {!isSeller && (
              <select
  value={invScope}
  onChange={(e) => setInvScope(e.target.value)}
  style={{
    ...styles.input,
    maxWidth: 180,
  }}
>
                <option value="all">📁 كل جهات الإصدار</option>
                <option value="seller">فواتير البائع</option>
                <option value="admin">فواتير الإدارة</option>
              </select>
            )}
            <select
value={paymentFilter}
onChange={(e)=>setPaymentFilter(e.target.value)}
style={{
  ...styles.input,
  maxWidth:180
}}
>
              <option value="all">🔍 كل حالات السداد</option>
              <option value="paid">مدفوعة بالكامل</option>
              <option value="partial">مدفوعة جزئياً</option>
              <option value="unpaid">غير مدفوعة (آجل قائم)</option>
              <option value="refund">مرتجعة ماليّاً</option>
            </select>
            <input
  value={invoiceSearch}
  onChange={(e) => setInvoiceSearch(e.target.value)}
  placeholder="بحث برقم الفاتورة، اسم العميل، البيان..."
  style={{
    ...styles.input,
    maxWidth: 280,
  }}
/>
            <button onClick={clearFilters} style={styles.btnGhost}>❌ تفريغ فلاتر البحث</button>
            <button onClick={printFilteredInvoices} style={styles.btnPrimary}>🖨️ طباعة السجل المفلتر</button>
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr><th>#</th><th>رقم الفاتورة</th><th>العميل</th><th>النوع</th><th>التاريخ</th><th>الإجمالي الصافي</th><th>المدفوع</th><th>المتبقي آجل</th><th>الحالة</th><th>إجراءات الإدارة والمطابقة</th></tr>
              </thead>
              <tbody>
                {filteredInvoices.length === 0 ? (
                  <tr><td colSpan={10} style={{ textAlign: "center", opacity: 0.7, padding: "15px" }}>لا توجد فواتير تطابق شروط التصفية والبحث حالياً</td></tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const st = statusUi(inv);
                    const isClosed = st.key === "void" || st.key === "refund";
                    return (
                      <tr key={inv.id}>
                        <td>{inv.id}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span>{inv.number || "-"}</span>
                            {inv?.seller_user_id ? <span style={styles.badgeSeller}>بائع</span> : <span style={styles.badgeAdmin}>إدارة</span>}
                          </div>
                        </td>
                        <td>{inv.customer_name || "-"}</td>
                        <td>{String(inv.invoice_type).toLowerCase() === "cards" ? "كروت" : "جيجا"}</td>
                        <td>{inv.invoice_date}</td>
                        <td>{money(inv.total_after_discount)}</td>
                        <td>{money(inv.paid_amount)}</td>
                        <td>{money(inv.remaining_amount)}</td>
                        <td>
                          <span style={st.key === "paid" ? styles.badgePaid : st.key === "partial" ? styles.badgePartial : st.key === "void" ? styles.badgeVoid : st.key === "refund" ? styles.badgeRefund : styles.badgeUnpaid}>
                            {st.ar}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => printSavedInvoice(inv)} style={styles.btn}>طباعة</button>
                            <button onClick={() => openPay(inv)} style={styles.btnPrimary} disabled={isClosed}>سداد</button>
                            {canEditInvoice && <button onClick={() => startEdit(inv)} style={styles.btn}>تعديل</button>}
                            {canRefundInvoice && canRefundThis(inv) && <button onClick={() => refundInvoice(inv)} style={styles.btnWarn}>مرتجع</button>}
                            {canDeleteInvoice && <button onClick={() => deleteInvoice(inv)} style={styles.btnDanger}>حذف</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "pay" && (
        <div style={styles.card}>
          <div style={styles.subTitle}>متابعة وسداد فواتير الآجل القائم</div>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead><tr><th>#</th><th>رقم الفاتورة</th><th>العميل</th><th>المتبقي للتحصيل</th><th>إجراء فوري</th></tr></thead>
              <tbody>
                {unpaidInvoices.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", opacity: 0.7, padding: "15px" }}>الحمد لله! لا توجد فواتير معلقة بانتظار السداد حالياً</td></tr>
                ) : (
                  unpaidInvoices.map((inv) => (
                    <tr key={inv.id}><td>{inv.id}</td><td>{inv.number || "-"}</td><td>{inv.customer_name}</td><td><b style={{ color: "red" }}>{money(inv.remaining_amount)}</b></td><td><button onClick={() => openPay(inv)} style={styles.btnPrimary}>تسجيل سند سداد</button></td></tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payModalOpen && (
        <div style={styles.modalBack}>
          <div style={styles.modal}>
            <h3>سداد فاتورة #{payInvoice?.number || payInvoice?.id}</h3>
            <div style={styles.payHint}>المتبقي القائم للفاتورة: <b>{money(payInvoice?.remaining_amount)} ريال</b></div>
            
            <div
style={{
  ...styles.grid2,
  marginTop:10
}}
>
              <label style={styles.label}>تاريخ ووقت السداد المستهدف
                <input type="datetime-local" value={payDate} onChange={(e) => setPayDate(e.target.value)} style={styles.input} />
              </label>
              
              <label style={styles.label}>مبلغ التحصيل المستلم<input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} style={styles.input} /></label>
            </div>

            <div
style={{
  ...styles.grid2,
  marginTop:10
}}
>
              <label style={styles.label}>طريقة التحصيل
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={styles.input}>
                  <option value="cash">نقدي (كاش الصندوق)</option>
                  <option value="transfer">تحويل بنكي الكتروني</option>
                  <option value="from_balance">خصم من رصيد العميل المسبق</option>
                  <option value="write_off">🎁 مسامحة العميل (إغلاق بدون سند)</option>
                </select>
              </label>
              <label style={styles.label}>مرجع / رقم العملية (اختياري)
                <input style={styles.input} value={payRef} onChange={(e)=>setPayRef(e.target.value)} placeholder="رقم العملية / إيصال" />
              </label>
            </div>

            <div
style={{
  ...styles.grid1,
  marginTop:10
}}
>
              <label style={styles.label}>ملاحظة السند
                <input value={payNote} onChange={(e) => setPayNote(e.target.value)} style={styles.input} placeholder="ملاحظات اختيارية..." />
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "end", marginTop: 15 }}>
              <button onClick={doPay} style={styles.btnPrimary}>تأكيد واعتماد السند المالي</button>
              <button onClick={() => setPayModalOpen(false)} style={styles.btnGhost}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Styles =====
const styles = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  tabs: { display: "flex", gap: 8, flexWrap: "wrap" },
  tab: { padding: "10px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer" },
  tabActive: { padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(54, 208, 170, 0.5)", background: "rgba(54, 208, 170, 0.18)", color: "var(--text)", cursor: "pointer" },
  card: { padding: 16, borderRadius: 18, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" },
  editBar: { marginBottom: 12, padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(255, 200, 70, 0.35)", background: "rgba(255, 200, 70, 0.10)", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" },
  payHint: { marginTop: 10, marginBottom: 10, padding: "10px 12px", border: "1px solid var(--border)", background: "var(--panel)", borderRadius: 12 },
  subTitle: { fontSize: 14, fontWeight: "bold", margin: "12px 0" },
  grid1: { display: "grid", gridTemplateColumns: "1fr", gap: 12 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
  grid4: { display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12 },
  grid4b: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12 },
  input: { padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "rgba(0,0,0,0.20)", color: "var(--text)", outline: "none", width: "100%" },
  btn: { padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer" },
  btnPrimary: { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(54, 208, 170, 0.5)", background: "rgba(54, 208, 170, 0.18)", color: "var(--text)", cursor: "pointer" },
  btnDanger: { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255, 90, 90, 0.5)", background: "rgba(255, 90, 90, 0.18)", color: "var(--text)", cursor: "pointer" },
  btnGhost: { padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer" },
  btnWarn: { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255, 200, 70, 0.5)", background: "rgba(255, 200, 70, 0.14)", color: "var(--text)", cursor: "pointer" },
  tableWrap: { marginTop: 12, overflowX: "auto", overflowY: "auto", maxHeight: 360, borderRadius: 14, border: "1px solid var(--border)" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 900 },
  infoBar: { marginTop: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--panel)", display: "flex", justifyContent: "space-between" },
  infoBox: { display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 12px", border: "1px solid var(--border)", background: "var(--panel)", borderRadius: 12, fontSize: 13 },
  summaryRow: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, justifyContent: "end" },
  sumChip: { padding: "10px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--panel)", fontSize: 13 },
  badgePaid: { display: "inline-block", padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(54, 208, 170, 0.55)", background: "rgba(54, 208, 170, 0.18)", color: "var(--text)", fontSize: 12 },
  badgePartial: { display: "inline-block", padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255, 200, 70, 0.55)", background: "rgba(255, 200, 70, 0.18)", color: "var(--text)", fontSize: 12 },
  badgeUnpaid: { display: "inline-block", padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255, 90, 90, 0.55)", background: "rgba(255, 90, 90, 0.18)", color: "var(--text)", fontSize: 12 },
  badgeVoid: { display: "inline-block", padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(200, 200, 200, 0.55)", background: "rgba(200, 200, 200, 0.18)", color: "var(--text)", fontSize: 12 },
  badgeSeller: { display: "inline-block", padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(30, 200, 120, 0.45)", background: "rgba(30, 200, 120, 0.16)", color: "var(--text)", fontSize: 12 },
  badgeAdmin: { display: "inline-block", padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(120, 120, 120, 0.35)", background: "rgba(120, 120, 120, 0.12)", color: "var(--text)", fontSize: 12 },
  modalBack: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 },
  modal: { width: "min(500px, 92vw)", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, padding: 16, color: "var(--text)" },
};
