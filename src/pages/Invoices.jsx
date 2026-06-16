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

  // خصم الدفعة العامة من الدين الافتتاحي أولاً
  const openingAfter = Math.max(0, opening - pay);
  pay = Math.max(0, pay - opening);

  // لو بقي من الدفعة شيء، يخصم من فواتير المتبقي
  const invoicesAfter = Math.max(0, invRem - pay);

  return openingAfter + invoicesAfter;
}


function asPaidStatus(remaining) {
  return safeNum(remaining) <= 0 ? "paid" : "unpaid"; // لا نضيف statuses جديدة حتى لا نصطدم بالـ CHECK
}

// حالة عربية + جزئية (للواجهة فقط)
function statusUi(inv) {
  const note = String(inv?.note || "");
  if (note.includes("[VOID]")) return { key: "void", ar: "ملغاة" };
  if (note.includes("[REFUND]")) return { key: "refund", ar: "مرتجع" };

  const paid = safeNum(inv.paid_amount);
  const rem = safeNum(inv.remaining_amount);
  if (rem <= 0) return { key: "paid", ar: "مدفوعة" };
  if (paid > 0 && rem > 0) return { key: "partial", ar: "جزئية" };
  return { key: "unpaid", ar: "غير مدفوعة" };
}

export default function Invoices() {
  // ===== Tabs =====
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
  const canRefundInvoice = isSuper || perms?.invoices_edit === true; // نفس صلاحية التعديل (أو سوبر)
  const canRefundThis = (inv) => {
    const note = String(inv?.note || "");
    if (note.includes("[VOID]") || note.includes("[REFUND]")) return false;
    if (inv?.is_refund) return false;
    return safeNum(inv?.paid_amount) > 0;
  };


  const [tab, setTab] = useState("create"); // create | list | pay
  const [loading, setLoading] = useState(false);

  // ===== Toast =====
  const [toast, setToast] = useState({ open: false, text: "", type: "ok" }); // ok | err | warn
  const toastTimer = useRef(null);
  const showToast = (text, type = "ok") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ open: true, text, type });
    toastTimer.current = setTimeout(() => setToast({ open: false, text: "", type: "ok" }), 2200);
  };

  // ===== Cashier summary (for seller) =====
  // الهدف: عرض إجمالي مبيعات البائع خلال فترة (من/إلى)
  // مع إجمالي التحصيل داخل نفس الفترة.
  const [cashierFrom, setCashierFrom] = useState(todayISO());
  const [cashierTo, setCashierTo] = useState(todayISO());
  const [cashierLoading, setCashierLoading] = useState(false);
  const [cashierSummary, setCashierSummary] = useState({
    invoicesCount: 0,
    salesTotal: 0, // إجمالي الفواتير
    invoicesCollectedTotal: 0, // مجموع المدفوع داخل الفواتير
    invoicesRemainingTotal: 0, // مجموع المتبقي داخل الفواتير

    paymentsInTotal: 0, // سندات قبض
    paymentsOutTotal: 0, // سندات صرف

    // “المبلغ المفروض يكون معه” = (المدفوع داخل الفواتير) + (قبض السندات) - (صرف السندات)
    collectedTotal: 0,

    // إجمالي المتبقي (ديون العملاء) من الفواتير داخل الفترة
    remainingTotal: 0,
  });

  // ===== Master data =====
  const [customers, setCustomers] = useState([]);
  const [unlinkedPaymentsByCustomer, setUnlinkedPaymentsByCustomer] = useState({});
  const [cards, setCards] = useState([]); // from v_card_balances

  // ===== مصدر الكروت للواجهة =====
  // الإدارة: cards (v_card_balances)
  // البائع + وضع الكاشير (posMode): vendorStock (عهدة البائع) لكن السعر نأخذه من cards
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
          quantity: safeNum(v.qty ?? 0), // ✅ المتاح من العهدة
        };
      })
      .filter((x) => x.card_type_id != null);
  }, [isSeller, posMode, vendorStock, cards]);
  const [invoices, setInvoices] = useState([]);

  // ===== منع التكرار + وضع تعديل =====
  const [saving, setSaving] = useState(false);
  const [clientUid, setClientUid] = useState(null);

  const [editMode, setEditMode] = useState(false);
  // بعض أجزاء الكود كانت تعتمد على متغير باسم isEditMode
  // حفاظاً على التوافق نعرّفه بناءً على editMode
  const isEditMode = !!editMode;
  const [editInvoiceId, setEditInvoiceId] = useState(null);
  const [editOldLines, setEditOldLines] = useState([]);

  // ===== Create invoice =====
  const [invoiceType, setInvoiceType] = useState("cards"); // cards | giga
  const [invoiceDate, setInvoiceDate] = useState(
  new Date().toISOString().slice(0,16)
);
  const [customerId, setCustomerId] = useState("");
  const [note, setNote] = useState("");

  // Customer Autocomplete
  const [customerQuery, setCustomerQuery] = useState("");
  const [showCustomerList, setShowCustomerList] = useState(false);
  const customerBoxRef = useRef(null);

  // Discount + payment now
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  // POS/Cashier helper (useful for sellers)
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
  const [invScope, setInvScope] = useState(() => (isSeller ? "seller" : "all"));

  useEffect(() => {
    if (isSeller) setInvScope("seller");
  }, [isSeller]);

  // Pay modal
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState("cash");
  const [payRef, setPayRef] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));

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

  // ===== POS/Cashier =====
  const cashReceivedNum = useMemo(() => safeNum(cashReceived), [cashReceived]);
  const cashierPaid = useMemo(() => Math.min(totalAfterDiscount, cashReceivedNum), [totalAfterDiscount, cashReceivedNum]);
  const cashierChange = useMemo(() => Math.max(0, cashReceivedNum - totalAfterDiscount), [cashReceivedNum, totalAfterDiscount]);
  const cashierRemaining = useMemo(() => Math.max(0, totalAfterDiscount - cashReceivedNum), [totalAfterDiscount, cashReceivedNum]);

  // If POS mode is enabled, keep "paidAmount" aligned with what cashier received (so the invoice saves correctly)
  useEffect(() => {
    if (!posMode) return;
    if (isEditMode) return;
    if (cashReceived === "" || cashReceived == null) return;
    const nextPaid = cashierPaid;
    if (Math.abs(safeNum(paidAmount) - safeNum(nextPaid)) > 0.00001) {
      setPaidAmount(nextPaid);
    }
  }, [posMode, isEditMode, cashReceived, cashierPaid, paidAmount]);

  // ===== دين العميل =====
  const customerDebt = useMemo(() => {
    if (!selectedCustomer) return 0;
    const cid = Number(selectedCustomer.id);
    const opening = safeNum(selectedCustomer.opening_balance);

    // مجموع المتبقي من الفواتير فقط
    const invoicesRemaining = (invoices || [])
      .filter((i) => Number(i.customer_id) === cid)
      .reduce((s, i) => s + safeNum(i.remaining_amount), 0);

    // ✅ سندات غير مرتبطة بفاتورة (invoice_id = null) تُخصم أولاً من الدين الافتتاحي
    const unlinked = safeNum(unlinkedPaymentsByCustomer?.[String(cid)] || 0);

    return calcCustomerDebt(opening, invoicesRemaining, unlinked);
  }, [selectedCustomer, invoices, unlinkedPaymentsByCustomer]);

  // ===== Loaders =====
  async function loadCustomers() {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,type,phone,address,notes,opening_balance,price_per_gb,last_reading_gb,discount_percent,created_at")
      .order("id", { ascending: true });
    if (error) throw error;
    setCustomers(data || []);
    return data || [];
  }


  async function loadUnlinkedPayments() {
    // ✅ سندات/دفعات غير مرتبطة بفاتورة (invoice_id = null) تُخصم من الدين الافتتاحي
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
      // نخصم فقط الدفعات الموجبة من الدين (السالب عادةً صرف/مرتجع)
      map[cid] = safeNum(map[cid] || 0) + Math.max(0, amt);
    });
    setUnlinkedPaymentsByCustomer(map);
    return map;
  }

  
  async function loadCardBalances() {
    // مصدر الرصيد حسب نوع المستخدم:
    // - Admin/Manager: من المخزون العام (card_balances)
    // - Seller: من عهدة البائع (v_vendor_stock_balances)

    if (isSeller) {
      const q = supabase
        .from("v_vendor_stock_balances")
        .select("card_type_id, card_name, price, balance")
        .eq("seller_user_id", user?.id)
        .order("price", { ascending: true });

      const { data, error } = await q;
      if (error) {
        console.error("loadCardBalances(seller)", error);
        setCards([]);
        return;
      }

      const mapped = (data || []).map((r) => ({
        card_type_id: r.card_type_id,
        name: r.card_name,
        price: Number(r.price || 0),
        // quantity المتاح للبائع
        quantity: Number(r.balance || 0),
      }));

      setCards(mapped);
      return;
    }

    // Admin / non-seller
    const { data: balances, error } = await supabase
      .from("v_card_balances")
      .select("card_type_id, balance");

    if (error) {
      console.error("loadCardBalances(admin)", error);
      return;
    }

    const balMap = new Map(
      (balances || []).map((r) => [r.card_type_id, Number(r.balance || 0)])
    );

    // عندنا card types + price من card_types
    const { data: types, error: typeErr } = await supabase
      .from("card_types")
      .select("id,name,price")
      .order("price", { ascending: true });

    if (typeErr) {
      console.error("loadCardTypes", typeErr);
      return;
    }

    const merged = (types || []).map((t) => ({
      card_type_id: t.id,
      name: t.name,
      price: Number(t.price || 0),
      quantity: Number(balMap.get(t.id) || 0),
    }));

    setCards(merged);
  }

  async function loadVendorStock() {
    try {
      if (!isSeller) { setVendorStock([]); return; }
      // vendor_stock: seller_user_id (uuid) + card_type_id + qty
      const { data, error } = await supabase
        .from("v_vendor_stock_balances")
        .select("card_type_id, card_name, price, balance")
        .eq("seller_user_id", user?.id)
        .order("price", { ascending: true });

      if (error) throw error;
      setVendorStock(Array.isArray(data) ? data.map((r) => ({ card_type_id: r.card_type_id, qty: Number(r.balance || 0), card_name: r.card_name })) : []);
    } catch (e) {
      console.error(e);
      // لا نوقف الصفحة لو جدول العهدة غير موجود بعد
      setVendorStock([]);
    }
  }

  async function rpcVendorMove({ card_type_id, qty, noteText, movement_type, ref_id, invoice_id, movement_date }) {
    // RPC: vendor_stock_move_v2
    // ملاحظة: بعض البيئات قد لا يكون فيها EXECUTE مفعل على الدالة عبر REST،
    // لذلك لا نخلي العملية توقف تعديل الفاتورة لو الـ RPC غير متاح.

    // لازم يكون ref_id رقم صحيح (invoice.id). لو صار undefined/NaN
    // كان يسبب: ref_id=eq.NaN في REST ويكسر الحفظ.
    const refIdNumRaw = Number(ref_id);
    const refIdNumFromText = Number(String(ref_id || '').match(/(\d+)/)?.[1]);
    const refIdNum = Number.isFinite(refIdNumRaw) ? refIdNumRaw : refIdNumFromText;

    const invIdNumRaw = Number(invoice_id);
    const invIdNumFromText = Number(String(invoice_id || '').match(/(\d+)/)?.[1]);
    const invIdNum = Number.isFinite(invIdNumRaw)
      ? invIdNumRaw
      : (Number.isFinite(invIdNumFromText) ? invIdNumFromText : refIdNum);

    if (!Number.isFinite(refIdNum)) {
      // ما ننفذ أي استعلامات على card_movements بدون ref_id صحيح.
      return { ok: false, skipped: true, reason: 'missing_ref_id' };
    }

    const cardTypeNum = Number(card_type_id);
    const qtyNum = Number(qty || 0);
    if (!Number.isFinite(cardTypeNum) || cardTypeNum <= 0) {
      return { ok: false, skipped: true, reason: 'missing_card_type' };
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      return { ok: false, skipped: true, reason: 'zero_qty' };
    }

    const payload = {
      p_card_type_id: cardTypeNum,
      p_movement_type: String(movement_type || 'OUT').toUpperCase(),
      p_qty: qtyNum,
      p_note: noteText || null,
      p_ref_type: 'invoice',
      p_ref_id: refIdNum,
      p_invoice_id: invIdNum,
      p_movement_date: (movement_date ? String(movement_date) : '').slice(0, 10) || null,
    };

    try {
      // حاول تحديث سجل موجود لتجنب uq_card_movements_ref_unique
      const { data: existing, error: exErr } = await supabase
        .from('card_movements')
        .select('id')
        .eq('ref_type', 'invoice')
        .eq('ref_id', payload.p_ref_id)
        .eq('movement_type', payload.p_movement_type)
        .maybeSingle();

      if (!exErr && existing?.id) {
        const { error: upErr } = await supabase
          .from('card_movements')
          .update({
            card_type_id: payload.p_card_type_id,
            qty: payload.p_qty,
            note: payload.p_note,
            invoice_id: payload.p_invoice_id,
            movement_date: payload.p_movement_date,
          })
          .eq('id', existing.id);

        if (!upErr) return { ok: true, updated: true, id: existing.id };
      }

      const res = await supabase.rpc('vendor_stock_move_v2', payload);

      if (res?.error) {
        // لو PostgREST ما لقى الدالة (schema cache/permissions) لا نوقف حفظ الفاتورة
        if (res.error.code === 'PGRST202' || res.error.code === 'PGRST203') {
          console.warn('vendor_stock_move_v2 not available via REST:', res.error);
          return { ok: false, skipped: true, reason: res.error.code };
        }
        throw res.error;
      }

      return { ok: true, data: res.data };
    } catch (e) {
      // 404 / schema-cache: لا نخليها توقف حفظ الفاتورة
      const msg = String(e?.message || e || '');
      if (msg.includes('404') || msg.includes('schema cache') || msg.includes('Could not find the function')) {
        console.warn('vendor_stock_move_v2 call skipped:', e);
        return { ok: false, skipped: true, reason: 'not_available' };
      }
      throw e;
    }
  }

  function sumQtyByCardType(invLines) {
    const totals = new Map();
    (invLines || []).forEach((l) => {
      const ct = Number(l?.card_type_id ?? l?.cardTypeId);
      const q = Number(l?.qty ?? l?.quantity ?? 0);
      if (!ct || !q) return;
      totals.set(ct, (totals.get(ct) || 0) + q);
    });
    return totals;
  }

  async function applyVendorOutByLines(invNumberOrId, invDateStr, invLines, sellerId) {
    if (!sellerId) return;

    const totals = sumQtyByCardType(invLines);

    // مهم: بسبب uq_card_movements_ref_unique، نتوقع عادةً كرت واحد لكل فاتورة.
    // لو فيه أكثر من كرت، راح يتم تحديث نفس الحركة بدل الإدخال المتكرر.
    for (const [cardTypeId, totalQty] of totals.entries()) {
      await rpcVendorMove({
        card_type_id: cardTypeId,
        qty: totalQty,
        noteText: 'invoice movement',
        movement_type: 'OUT',
        ref_id: invNumberOrId,
        invoice_id: invNumberOrId,
        movement_date: invDateStr,
      });
    }
  }

  async function applyVendorInByLines(invNumberOrId, invDateStr, invLines, sellerId, reasonTag) {
    if (!sellerId) return;

    const totals = sumQtyByCardType(invLines);

    for (const [cardTypeId, totalQty] of totals.entries()) {
      await rpcVendorMove({
        card_type_id: cardTypeId,
        qty: totalQty,
        noteText: reasonTag || 'رجوع',
        movement_type: 'IN',
        ref_id: invNumberOrId,
        invoice_id: invNumberOrId,
        movement_date: invDateStr,
      });
    }
  }
  async function applyVendorOutByLines(invNumberOrId, invDateStr, invLines, sellerId) {
    for (const l of invLines) {
      const ctId = l.card_type_id;
      const qty = safeNum(l.qty);
      if (!ctId || qty <= 0) continue;
      await rpcVendorMove({
        seller_user_id: sellerId,
        card_type_id: ctId,
        movement_type: "OUT",
        qty,
        noteText: `خصم عهدة (بيع) فاتورة رقم ${invNumberOrId}`,
        created_at_iso: invDateStr ? `${invDateStr}T12:00:00.000Z` : null,
      });
    }
  }

  async function applyVendorInByLines(invNumberOrId, invDateStr, invLines, sellerId, reasonTag) {
    for (const l of invLines) {
      const ctId = l.card_type_id;
      const qty = safeNum(l.qty);
      if (!ctId || qty <= 0) continue;
      await rpcVendorMove({
        seller_user_id: sellerId,
        card_type_id: ctId,
        movement_type: "IN",
        qty,
        noteText: `${reasonTag || "رجوع"} عهدة فاتورة ${invNumberOrId}`,
        created_at_iso: invDateStr ? `${invDateStr}T12:00:00.000Z` : null,
      });
    }
  }

async function loadInvoices(customersList = customers) {
  // view أولاً
  let q = supabase
    .from("v_invoices")
    .select("*")
    .order("id", { ascending: false });

  // ✅ البائع يشوف فواتيره فقط
  if (isSeller && user?.id) {
    q = q.eq("seller_user_id", user.id);
  }

  const { data: vData, error: vErr } = await q;

  if (!vErr && vData) {
    const norm = (vData || []).map((r) => ({
      ...r,
      total_before_discount: r.total_before_discount ?? 0,
      discount_percent: r.discount_percent ?? 0,
      discount_value: r.discount_value ?? 0,
      total_after_discount: r.total_after_discount ?? 0,
      paid_amount: r.paid_amount ?? 0,
      remaining_amount: r.remaining_amount ?? 0,
    }));
    setInvoices(norm);
    return;
  }

  // fallback table
  let q2 = supabase
    .from("invoices")
    .select("id,number,customer_id,invoice_type,invoice_date,total_before_discount,discount_percent,discount_value,total_after_discount,paid_amount,remaining_amount,status,note,created_at,seller_user_id")
    .order("id", { ascending: false });

  // ✅ إجبارية للبائع حتى لو فشل الـ view
  if (isSeller && user?.id) {
    q2 = q2.eq("seller_user_id", user.id);
  }

  const { data, error } = await q2;
  if (error) throw error;

  const cm = new Map((customersList || []).map((c) => [c.id, c.name]));
  setInvoices((data || []).map((x) => ({ ...x, customer_name: cm.get(x.customer_id) || "" })));
}

  // ملخص "الكاشير" للبائع: إجمالي المبيعات والمقبوضات خلال فترة
  const loadCashierSummary = async () => {
    // الهدف: يطلع للبائع "كم المفروض معاه" خلال فترة (مبيعات + قبض/صرف)
    // - المبيعات: مجموع إجمالي الفواتير (invoice_date ضمن الفترة) للبائع
    // - القبض/الصرف: من جدول payments حسب pay_date ضمن الفترة للبائع
    if (!isSeller || !user?.id) return;

    setCashierLoading(true);
    try {
      const fromDate = cashierFrom || todayISO();
      const toDate = cashierTo || fromDate;

      // 1) فواتير الفترة (حسب invoice_date)
      const { data: invRows, error: invErr } = await supabase
        .from("invoices")
        .select("id,total_after_discount,paid_amount,remaining_amount,invoice_date")
        .eq("seller_user_id", user.id)
        .gte("invoice_date", fromDate)
        .lte("invoice_date", toDate);
      if (invErr) throw invErr;

      const invs = invRows || [];
      // Avoid undefined variable errors when rendering the cashier card.
      const invoicesCount = invs.length;
      const salesTotal = invs.reduce((s, x) => s + safeNum(x.total_after_discount), 0);
      const invoicesRemainingTotal = invs.reduce(
        (s, x) => s + safeNum(x.remaining_amount),
        0
      );
      // بعض الفواتير قد لا تملأ paid_amount (حسب منطق الحفظ)، لذا نحسبه بشكل آمن:
      const invoicesCollectedTotal = invs.reduce((s, x) => {
        const paid = safeNum(x.paid_amount);
        if (paid > 0) return s + paid;
        // fallback: (الإجمالي - المتبقي)
        const fallback = Math.max(0, safeNum(x.total_after_discount) - safeNum(x.remaining_amount));
        return s + fallback;
      }, 0);

      // 2) قبض/صرف الفترة (مهم: قد يكون القبض على فواتير قديمة، لذلك نعتمد payments داخل الفترة)
      //    لازم يكون payment.seller_user_id متعبّي عشان ينحسب ضمن تسوية البائع.
      let paymentsInTotal = 0;
      let paymentsOutTotal = 0;

      // pay_date غالباً timestamp، لذلك نستخدم حدود اليوم كاملة حتى لا يختفي قبض آخر اليوم
      const payFromTs = `${fromDate}T00:00:00.000Z`;
      const payToTs = `${toDate}T23:59:59.999Z`;

      const { data: payRows, error: payErr } = await supabase
        .from("payments")
        .select("amount,pay_date,seller_user_id")
        .eq("seller_user_id", user.id)
        .gte("pay_date", payFromTs)
        .lte("pay_date", payToTs);

      if (payErr) {
        console.warn("payments query failed", payErr);
      } else {
        for (const p of payRows || []) {
          const a = safeNum(p.amount);
          if (a >= 0) paymentsInTotal += a;
          else paymentsOutTotal += Math.abs(a);
        }
      }

      // 3) الصافي الذي يفترض يكون مع البائع خلال الفترة
      // المبلغ اللي "المفروض معه":
      // - (مدفوعات الفواتير داخل الفترة) + (سندات القبض داخل الفترة) - (سندات الصرف داخل الفترة)
      // ملاحظة: إذا كنت لا تسجل سند عند حفظ الفاتورة، فسيكون أغلب التحصيل من invoicesCollectedTotal.
      const collectedTotal = invoicesCollectedTotal + paymentsInTotal - paymentsOutTotal;

      setCashierSummary({
        invoicesCount,
        salesTotal,
        invoicesCollectedTotal,
        invoicesRemainingTotal,
        paymentsInTotal,
        paymentsOutTotal,
        collectedTotal,
        remainingTotal: invoicesRemainingTotal,
      });
    } catch (e) {
      console.error(e);
      showToast("تعذر حساب ملخص الكاشير (تأكد من جدول invoices/payments)", "err");
      setCashierSummary({
        invoicesCount: 0,
        salesTotal: 0,
        invoicesCollectedTotal: 0,
        invoicesRemainingTotal: 0,
        paymentsInTotal: 0,
        paymentsOutTotal: 0,
        collectedTotal: 0,
        remainingTotal: 0,
      });
    } finally {
      setCashierLoading(false);
    }
  };

  // تحديث ملخص الكاشير عند تغيير الفترة أو بعد تحديث قائمة الفواتير
  useEffect(() => {
    if (!canUseCashier || !posMode) return;
    loadCashierSummary();
    // eslint-disable-next-line
  }, [canUseCashier, posMode, user?.id, cashierFrom, cashierTo]);


  // ===== Init =====
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      try {
        setLoading(true);
        const cs = await loadCustomers();
        await loadUnlinkedPayments();
        await loadCardBalances();
        await loadVendorStock();
        await loadInvoices(cs);
      } catch (e) {
        console.error(e);
        showToast("خطأ في تحميل البيانات (تأكد من الجداول/Views و RLS)", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ===== عند اختيار العميل =====
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

  // مزامنة اسم العميل داخل مربع البحث
  useEffect(() => {
    if (selectedCustomer) setCustomerQuery(selectedCustomer.name || "");
  }, [selectedCustomer]);

  // إذا مسحت الاسم يدويًا => صفّر customerId (فقط خارج وضع التعديل)
  useEffect(() => {
    if (!customerQuery && !editMode) setCustomerId("");
    // eslint-disable-next-line
  }, [customerQuery]);

  // إغلاق قائمة العملاء عند الضغط خارجها
  useEffect(() => {
    function onDocClick(e) {
      if (!customerBoxRef.current) return;
      if (!customerBoxRef.current.contains(e.target)) setShowCustomerList(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // When selecting card: default price
  useEffect(() => {
    if (invoiceType !== "cards") return;
    const c = cardsForUi.find((x) => String(x.card_type_id) === String(selCardId));
    if (c) setSelPrice(safeNum(c.price));
  }, [selCardId, invoiceType, cardsForUi]);

  // ===== Lines =====
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
    setInvoiceDate(todayISO());
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
  }

  // ====== RPC (حركة مخزون) ======
  // هذا يضمن: حركة + تحديث card_stock + قبل/بعد داخل card_movements (لو دالتك تسويها)
  async function rpcCardMove({ card_type_id, movement_type, qty, noteText, movement_date }) {
    const { data, error } = await supabase.rpc("apply_card_movement", {
      p_card_type_id: Number(card_type_id),
      p_movement_type: String(movement_type).toUpperCase(),
      p_qty: Number(qty),
      p_note: noteText || null,
      ...(movement_date ? { p_movement_date: String(movement_date) } : {}),
    });

    if (error) {
      const status = error?.status || error?.statusCode;
      // 409 = conflict (duplicate/constraint). Sometimes the first call actually succeeded and the UI only saw the conflict.
      if (status === 409) {
        console.warn("apply_card_movement conflict (ignored):", error);
        return data;
      }
      throw error;
    }

    return data;
  }

  async function applyCardOutByLines(invNumberOrId, invDateStr, invLines) {
    for (const l of invLines) {
      const ctId = l.card_type_id;
      const qty = safeNum(l.qty);
      if (!ctId || qty <= 0) continue;
      await rpcCardMove({
        card_type_id: ctId,
        movement_type: "OUT",
        qty,
        noteText: `خصم فاتورة رقم ${invNumberOrId}`,
        movement_date: invDateStr || null,
      });
    }
  }

  async function revertCardInByLines(invNumberOrId, invDateStr, invLines, reasonTag = "رجوع") {
    for (const l of invLines) {
      const ctId = l.card_type_id;
      const qty = safeNum(l.qty);
      if (!ctId || qty <= 0) continue;
      await rpcCardMove({
        card_type_id: ctId,
        movement_type: "IN",
        qty,
        noteText: `${reasonTag} فاتورة ${invNumberOrId}`,
        movement_date: invDateStr || null,
      });
    }
  }

  // ===== Print (preview + print) =====
  function buildPrintHtml(inv, invLines, customerName, customerDebtValue = 0) {
    const invType = String(inv.invoice_type || inv.invoiceType || "").toLowerCase();
    const isCards = invType === "cards";
    const dateStr = inv.invoice_date || (inv.created_at ? String(inv.created_at).slice(0, 10) : "");
    const noteStr = String(inv.note || "");

    const headCols = isCards
      ? `<tr><th>#</th><th>البند</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>`
      : `<tr><th>#</th><th>قراءة سابقة</th><th>قراءة حالية</th><th>استهلاك</th><th>سعر الجيجا</th><th>الإجمالي</th></tr>`;

    const rows = isCards
      ? (invLines || [])
          .map((x, i) => {
            const name = x.card_name ?? x.name ?? x.card_type_name ?? x.item_name ?? "";
            const qty = safeNum(x.qty);
            const price = safeNum(x.price);
            const total = safeNum(x.line_total ?? qty * price);
            return `<tr><td>${i + 1}</td><td>${name}</td><td>${qty}</td><td>${money(price)}</td><td>${money(total)}</td></tr>`;
          })
          .join("")
      : (invLines || [])
          .map((x, i) => {
            const prev = safeNum(x.prev_reading_gb ?? x.prev_reading ?? 0);
            const curr = safeNum(x.curr_reading_gb ?? x.curr_reading ?? 0);
            const usage = safeNum(x.usage_gb ?? Math.max(0, curr - prev));
            const ppg = safeNum(x.price_per_gb ?? 0);
            const total = safeNum(x.line_total ?? usage * ppg);
            return `<tr><td>${i + 1}</td><td>${prev}</td><td>${curr}</td><td>${usage}</td><td>${money(ppg)}</td><td>${money(total)}</td></tr>`;
          })
          .join("");

    const totalBefore = safeNum(inv.total_before_discount ?? 0);
    const discP = safeNum(inv.discount_percent ?? 0);
    const discV = safeNum(inv.discount_value ?? 0);
    const totalAfter = safeNum(inv.total_after_discount ?? 0);
    const paid = safeNum(inv.paid_amount ?? 0);
    const rem = safeNum(inv.remaining_amount ?? 0);

    const badgeText = noteStr.includes("[VOID]") ? "ملغاة" : noteStr.includes("[REFUND]") ? "مرتجع" : isCards ? "كروت" : "جيجا";

    return `
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>فاتورة</title>
        <style>
          body{font-family:Arial, sans-serif; margin:24px; color:#111;}
          .top{display:flex; gap:14px; align-items:stretch;}
          .box{flex:1; border:1px solid #ddd; border-radius:12px; padding:14px;}
          h1{margin:0 0 10px 0; font-size:18px;}
          .muted{color:#555; font-size:12px;}
          table{width:100%; border-collapse:collapse; margin-top:16px;}
          th,td{border:1px solid #ddd; padding:10px; font-size:13px; text-align:right;}
          th{background:#f5f5f5;}
          .sum{margin-top:16px; display:grid; grid-template-columns:1fr 1fr; gap:10px;}
          .row{display:flex; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid #eee; border-radius:10px;}
          .footer{margin-top:18px; font-size:12px; color:#666; display:flex; justify-content:space-between;}
          .badge{display:inline-block; padding:4px 10px; border-radius:999px; background:#eef6ff; border:1px solid #cfe3ff; font-size:12px;}
        </style>
      </head>
      <body>
        <div class="top">
          <div class="box">
            <h1>فاتورة</h1>
            <div class="muted">رقم الفاتورة: <b>${inv.number || inv.id}</b></div>
            <div class="muted">النوع: <span class="badge">${badgeText}</span></div>
            <div class="muted">التاريخ: <b>${dateStr}</b></div>
          </div>
          <div class="box">
            <h1>العميل</h1>
            <div>الاسم: <b>${customerName || "-"}</b></div>
            <div class="muted">دين العميل: <b>${money(customerDebtValue)}</b></div>
            <div class="muted">ملاحظة: ${inv.note || "-"}</div>
          </div>
        </div>

        <table>
          <thead>${headCols}</thead>
          <tbody>${rows || `<tr><td colspan="7" style="text-align:center;color:#777">لا توجد بنود</td></tr>`}</tbody>
        </table>

        <div class="sum">
          <div class="row"><span>الإجمالي قبل الخصم</span><b>${money(totalBefore)}</b></div>
          <div class="row"><span>خصم (%)</span><b>${money(discP)}</b></div>
          <div class="row"><span>قيمة الخصم</span><b>${money(discV)}</b></div>
          <div class="row"><span>الإجمالي بعد الخصم</span><b>${money(totalAfter)}</b></div>
          <div class="row"><span>المدفوع</span><b>${money(paid)}</b></div>
          <div class="row"><span>المتبقي</span><b>${money(rem)}</b></div>
        </div>

        <div class="footer">
          <div>ONE NET ERP</div>
          <div>${new Date().toLocaleString("ar-SA")}</div>
        </div>
      </body>
    </html>`;
  }

  async function previewOrPrint(mode = "print") {
    try {
      if (!customerId) return showToast("اختر العميل أولاً", "warn");

      if (invoiceType === "cards") {
        if (lines.length === 0) return showToast("أضف بند واحد على الأقل", "warn");
      } else {
        if (!isGigaCustomer) return showToast("فاتورة الجيجا فقط لعملاء giga", "warn");
        const usage = safeNum(currReading) - safeNum(prevReading);
        if (usage <= 0) return showToast("القراءة الحالية يجب أن تكون أكبر من السابقة", "warn");
      }

      const invFake = {
        id: "—",
        number: "PREVIEW",
        customer_id: Number(customerId),
        invoice_type: invoiceType,
        invoice_datetime: invoiceDate,
invoice_date: invoiceDate.slice(0,10),
        seller_user_id: posMode ? (user?.id || null) : null,
        total_before_discount: subtotal,
        discount_percent: Math.max(0, Math.min(100, safeNum(discountPercent))),
        discount_value: discountValue,
        total_after_discount: totalAfterDiscount,
        paid_amount: safeNum(paidAmount),
        remaining_amount: remaining,
        status: asPaidStatus(remaining),
        note: note || null,
        created_at: nowISO(),
      };

      const customerName = selectedCustomer?.name || "";
      const invLines =
        invoiceType === "cards"
          ? lines.map((l) => ({
              card_type_id: l.card_type_id,
              name: l.name,
              qty: l.qty,
              price: l.price,
              line_total: l.line_total,
            }))
          : [
              {
                prev_reading_gb: safeNum(prevReading),
                curr_reading_gb: safeNum(currReading),
                usage_gb: Math.max(0, safeNum(currReading) - safeNum(prevReading)),
                price_per_gb: safeNum(pricePerGb),
                line_total: Math.max(0, safeNum(currReading) - safeNum(prevReading)) * safeNum(pricePerGb),
              },
            ];

      const w = window.open("", "_blank", "width=900,height=900");
      if (!w) return showToast("فعّل النوافذ المنبثقة (Popups)", "warn");

      w.document.open();
      w.document.write(buildPrintHtml(invFake, invLines, customerName, customerDebt));
      w.document.close();
      w.focus();

      if (mode === "print") setTimeout(() => w.print(), 250);
    } catch (e) {
      console.error(e);
      showToast("فشل المعاينة/الطباعة", "err");
    }
  }

  // ===== أدوات تعديل/حذف/إلغاء/مرتجع =====
  async function fetchInvoiceLines(invoiceId) {
    const { data: vLines, error: vErr } = await supabase.from("v_invoice_lines").select("*").eq("invoice_id", invoiceId);
    if (!vErr && vLines) return vLines;

    const { data, error } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", invoiceId);
    if (error) throw error;
    return data || [];
  }

  async function getInvoiceRow(invoiceId) {
    const { data, error } = await supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function zeroInvoice(invoiceId, mark) {
    const tag = mark === "VOID" ? "[VOID]" : "[REFUND]";
    const { error } = await supabase
      .from("invoices")
      .update({
        total_before_discount: 0,
        discount_percent: 0,
        discount_value: 0,
        total_after_discount: 0,
        paid_amount: 0,
        remaining_amount: 0,
        status: "paid",
        note: `${tag} ${mark === "VOID" ? "ملغاة" : "مرتجع"} - ${nowISO()}`,
      })
      .eq("id", invoiceId);

    if (error) throw error;
  }

  async function voidInvoice(inv) {
    if (!inv?.id) return;
    const st = statusUi(inv);
    if (st.key === "void" || st.key === "refund") return showToast("هذه الفاتورة تم إغلاقها مسبقاً", "warn");

    const paid = safeNum(inv.paid_amount);
    if (paid > 0) return showToast("لا يمكن إلغاء فاتورة عليها سداد. استخدم (مرتجع).", "warn");

    const ok = confirm(`إلغاء الفاتورة ${inv.number || inv.id} ؟\nسيتم إرجاع المخزون وتصفير الفاتورة.`);
    if (!ok) return;

    try {
      setLoading(true);

      const invRow = await getInvoiceRow(inv.id);
      if (!invRow) return showToast("الفاتورة غير موجودة", "err");

      const invLines = await fetchInvoiceLines(inv.id);

      if (String(invRow.invoice_type || "").toLowerCase() === "cards") {
        // رجوع IN عبر RPC
        if (invRow?.seller_user_id) {
          await applyVendorInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, invRow.seller_user_id, "رجوع (إلغاء)");
          await loadVendorStock();
        } else {
          await revertCardInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, "رجوع (إلغاء)");
          await loadCardBalances();
        }
      }

      await zeroInvoice(inv.id, "VOID");

      await loadCardBalances();
      await loadInvoices();
      showToast("تم إلغاء الفاتورة", "ok");
    } catch (e) {
      console.error(e);
      showToast(e?.message || "فشل إلغاء الفاتورة", "err");
    } finally {
      setLoading(false);
    }
  }

  async function refundInvoice(invRow) {
  if (!invRow?.id) return;
  const ok = window.confirm(
    `عمل مرتجع لهذه الفاتورة؟\nسيتم إنشاء فاتورة مرتجع (سالب) مرتبطة بالفاتورة الأصلية.\nلن يتم حذف الفاتورة الأصلية.`
  );
  if (!ok) return;

  setLoading(true);
  try {
    // 0) Prevent double refund
    const { data: existingRefund, error: exErr } = await supabase
      .from("invoices")
      .select("id, number")
      .eq("refund_of_invoice_id", invRow.id)
      .limit(1);

    if (exErr) throw exErr;
    if (existingRefund && existingRefund.length) {
      showToast(`تم إنشاء مرتجع مسبقاً: ${existingRefund[0].number || existingRefund[0].id}`, "warn");
      return;
    }

    // 1) Load original line items
    const { data: lines, error: linesErr } = await supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invRow.id);

    if (linesErr) throw linesErr;

    // 2) Create refund invoice (negative totals)
    const totalBefore = -safeNum(invRow.total_before_discount);
    const discPct = safeNum(invRow.discount_percent);
    const discVal = -safeNum(invRow.discount_value);
    const totalAfter = -safeNum(invRow.total_after_discount);

    const { data: refundInv, error: refundErr } = await supabase
      .from("invoices")
      .insert([
        {
          customer_id: invRow.customer_id,
          invoice_type: invRow.invoice_type,
          invoice_date: todayISO(),
          total_before_discount: totalBefore,
          discount_percent: discPct,
          discount_value: discVal,
          total_after_discount: totalAfter,
          paid_amount: 0,
          remaining_amount: 0,
          status: "paid",
          note: `[REFUND] مرتجع للفاتورة ${invRow.number || invRow.id} - ${nowISO()}`,
          is_refund: true,
          refund_of_invoice_id: invRow.id,
        },
      ])
      .select("id")
      .single();

    if (refundErr) throw refundErr;

    const refundId = refundInv?.id;

    // Give refund invoice a readable number (unique)
    const refundNo = `REF-${String(refundId).padStart(6, "0")}`;
    await supabase.from("invoices").update({ number: refundNo }).eq("id", refundId);

    // 3) Insert negative line items to reverse effects (stock/giga triggers)
    if (lines && lines.length) {
      const refundLines = lines.map((li) => ({
        invoice_id: refundId,
        card_type_id: li.card_type_id ?? null,
        qty: li.qty == null ? null : Math.abs(Math.trunc(safeNum(li.qty))), // qty always + ; direction handled in trigger
        price: li.price ?? null,
        prev_reading_gb: li.prev_reading_gb ?? null,
        curr_reading_gb: li.curr_reading_gb ?? null,
        usage_gb: li.usage_gb == null ? null : -safeNum(li.usage_gb), // keep negative for giga reversal
        price_per_gb: li.price_per_gb ?? null,
        line_total: li.line_total == null ? 0 : -safeNum(li.line_total),
        line_kind: li.line_kind ?? "card",
        current_reading_gb: li.current_reading_gb ?? null,
        consumed_gb: li.consumed_gb == null ? null : -safeNum(li.consumed_gb),
        unit_price: li.unit_price ?? null,
      }));

      const { error: insLinesErr } = await supabase.from("invoice_line_items").insert(refundLines);
      if (insLinesErr) throw insLinesErr;
    }

    // 4) Mark original invoice note (keep numbers & history intact)
    const oldNote = String(invRow.note || "");
    const stamp = `[REFUNDED->${refundNo}] ${nowISO()}`;
    const newNote = oldNote ? `${oldNote}\n${stamp}` : stamp;
    await supabase.from("invoices").update({ note: newNote }).eq("id", invRow.id);
    // 5) سجل صرف نقدي للمرتجع (حتى ين// تسجيل صرف نقدي للمرتجع داخل جدول payments (كمبلغ موجب مع وسم في note)
// عشان: (1) ما نخالف CHECK (amount > 0) (2) Dashboard يخصمه من النقد عبر [REFUND_CASH_OUT]
try {
  const refundCash = safeNum(invRow?.paid_amount);
  if (refundCash > 0) {
    await supabase.from("payments").insert([
      {
        customer_id: invRow.customer_id,
        invoice_id: null, // صرف نقدي عام للمرتجع (لا نربطه بفاتورة حتى لا يغيّر حالة فواتير أخرى)
        pay_date: todayISO(),
        amount: refundCash,
        payment_type: "other",
        method: "cash",
        reference: `REFUND-${refundNo}`,
        note: `[REFUND_CASH_OUT] Refund ${refundNo} for ${invRow.number || `INV-${invRow.id}`}`,
      },
    ]);
  }
} catch (e2) {
  console.warn("refund cash-out payment insert failed", e2);
}



    await loadCardBalances();
    await loadInvoices();
    showToast(`تم إنشاء المرتجع: ${refundNo}`, "ok");
  } catch (e) {
    console.error(e);
    showToast(e?.message || "فشل إنشاء المرتجع", "err");
  } finally {
    setLoading(false);
  }
}

  async function startEdit(inv) {
    try {
      setLoading(true);

      const { data: invRow, error } = await supabase.from("invoices").select("*").eq("id", inv.id).maybeSingle();
      if (error) throw error;
      if (!invRow) return showToast("لا يمكن فتح الفاتورة (غير موجودة)", "err");

      const st = statusUi(invRow);
      if (st.key === "void" || st.key === "refund") return showToast("لا يمكن تعديل فاتورة ملغاة/مرتجعة", "warn");

      const invLines = await fetchInvoiceLines(inv.id);

      setEditMode(true);
      setEditInvoiceId(inv.id);
      setEditOldLines(invLines);

      setClientUid(invRow.client_uid || null);
      setInvoiceDate(invRow.invoice_date || todayISO());
      setCustomerId(String(invRow.customer_id || ""));
      setInvoiceType(String(invRow.invoice_type || "cards").toLowerCase());
      setNote(invRow.note || "");
      setDiscountPercent(safeNum(invRow.discount_percent));
      setPaidAmount(safeNum(invRow.paid_amount));

      if (String(invRow.invoice_type || "").toLowerCase() === "cards") {
        const uiLines = (invLines || []).map((l) => ({
          card_type_id: l.card_type_id,
          name:
            l.card_name ??
            cards.find((c) => String(c.card_type_id) === String(l.card_type_id))?.name ??
            `كرت ${l.card_type_id}`,
          qty: safeNum(l.qty),
          price: safeNum(l.price),
          line_total: safeNum(l.line_total ?? safeNum(l.qty) * safeNum(l.price)),
        }));
        setLines(uiLines);
      } else {
        const one = invLines?.[0] || {};
        setPrevReading(safeNum(one.prev_reading_gb));
        setCurrReading(String(safeNum(one.curr_reading_gb || 0)));
        setPricePerGb(safeNum(one.price_per_gb));
        setLines([]);
      }

      setShowCustomerList(false);
      setTab("create");
      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("تم فتح وضع التعديل", "ok");
    } catch (e) {
      console.error(e);
      showToast("فشل فتح التعديل", "err");
    } finally {
      setLoading(false);
    }
  }

  async function deleteInvoice(inv) {
    if (!inv?.id) return;
    const st = statusUi(inv);
    if (st.key === "void" || st.key === "refund") return showToast("هذه الفاتورة ملغاة/مرتجعة (استخدم فقط طباعة)", "warn");

    const paid = safeNum(inv.paid_amount);
    if (paid > 0) return showToast("لا يمكن حذف فاتورة عليها سداد. استخدم (مرتجع).", "warn");

    const ok = confirm(`هل تريد حذف الفاتورة ${inv.number || inv.id} ؟`);
    if (!ok) return;

    try {
      setLoading(true);

      const { data: invRow, error: e1 } = await supabase.from("invoices").select("*").eq("id", inv.id).single();
      if (e1) throw e1;

      const invLines = await fetchInvoiceLines(inv.id);

      if (String(invRow.invoice_type || "").toLowerCase() === "cards") {
        // رجوع IN عبر RPC (حذف)
        if (invRow?.seller_user_id) {
          await applyVendorInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, invRow.seller_user_id, "رجوع (حذف)");
          await loadVendorStock();
        } else {
          await revertCardInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, "رجوع (حذف)");
          await loadCardBalances();
        }
      }

      const { error: eDelLines } = await supabase.from("invoice_line_items").delete().eq("invoice_id", inv.id);
      if (eDelLines) throw eDelLines;

      const { error: eDelInv } = await supabase.from("invoices").delete().eq("id", inv.id);
      if (eDelInv) throw eDelInv;

      await loadCardBalances();
      await loadInvoices();
      showToast("تم حذف الفاتورة", "ok");
    } catch (e) {
  console.error("deleteInvoice failed:", e);

  // يطلع لك السبب واضح بدل "فشل حذف الفاتورة" فقط
  const msg =
    e?.message ||
    e?.error_description ||
    (typeof e === "string" ? e : JSON.stringify(e));

  showToast(`فشل حذف الفاتورة: ${msg}`, "err");
}

  }

  // ===== Save invoice (إنشاء أو تعديل) =====
  async function saveInvoice() {
    try {
      if (saving) return;
      setSaving(true);

      if (!customerId) return showToast("اختر العميل أولاً", "warn");

      if (invoiceType === "cards") {
        if (lines.length === 0) return showToast("أضف بند واحد على الأقل", "warn");
        for (const l of lines) {
          const ctId = String(l.card_type_id || "");
          const want = safeNum(l.qty);

          if (!ctId || want <= 0) return showToast("كمية غير صحيحة", "warn");

          if (posMode) {
            const vs = (vendorStock || []).find((x) => String(x.card_type_id) === ctId);
            const av = safeNum(vs?.qty);
            if (!vs) return showToast("هذا الصنف غير موجود في عهدتك", "warn");
            if (!editMode && want > av) return showToast(`رصيد العهدة غير كافي للصنف`, "warn");
          } else {
            const c = cards.find((x) => String(x.card_type_id) === ctId);
            if (!c) return showToast("خطأ: بند غير موجود في المخزون", "err");
            if (!editMode && want > safeNum(c.quantity)) return showToast(`الرصيد غير كافي للصنف: ${c.name}`, "warn");
          }
        }
      } else {
        if (!isGigaCustomer) return showToast("فاتورة الجيجا فقط لعملاء giga", "warn");
        const usage = safeNum(currReading) - safeNum(prevReading);
        if (usage <= 0) return showToast("القراءة الحالية يجب أن تكون أكبر من السابقة", "warn");
        if (safeNum(pricePerGb) <= 0) return showToast("سعر الجيجا عند العميل = 0", "warn");
      }

      setLoading(true);

      const uid = clientUid || crypto.randomUUID();
      setClientUid(uid);

      const invRow = {
        client_uid: uid,
        customer_id: Number(customerId),
        invoice_type: invoiceType,
        invoice_datetime: invoiceDate,
invoice_date: invoiceDate.slice(0,10),
        seller_user_id: posMode ? (user?.id || null) : null,
        total_before_discount: subtotal,
        discount_percent: Math.max(0, Math.min(100, safeNum(discountPercent))),
        discount_value: discountValue,
        total_after_discount: totalAfterDiscount,
        paid_amount: safeNum(paidAmount),
        remaining_amount: Math.max(0, totalAfterDiscount - safeNum(paidAmount)),
        status: asPaidStatus(Math.max(0, totalAfterDiscount - safeNum(paidAmount))),
        note: note || null,
      };

      let invoiceId = null;
      let invNumber = null;

      // ===== تعديل =====
      if (editMode && editInvoiceId) {
        invoiceId = editInvoiceId;

        const { data: dbInv, error: eGet } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
        if (eGet) throw eGet;

        // رجّع المخزون القديم إذا كانت كروت
        if (String(dbInv.invoice_type || "").toLowerCase() === "cards") {
          if (dbInv?.seller_user_id) {
            await applyVendorInByLines(dbInv.number || dbInv.id, dbInv.invoice_date, editOldLines, dbInv.seller_user_id, "تصحيح (رجوع قديم)");
            await loadVendorStock();
          } else {
            await revertCardInByLines(dbInv.number || dbInv.id, dbInv.invoice_date, editOldLines, "تصحيح (رجوع قديم)");
            await loadCardBalances();
          }
        }

        // امسح البنود القديمة
        const { error: eDel } = await supabase.from("invoice_line_items").delete().eq("invoice_id", invoiceId);
        if (eDel) throw eDel;

        // حدّث رأس الفاتورة
        const { data: upInv, error: eUp } = await supabase.from("invoices").update(invRow).eq("id", invoiceId).select("*").single();
        if (eUp) throw eUp;

        invNumber = upInv.number || upInv.id;

        // أدخل البنود الجديدة
        if (invoiceType === "cards") {
          const lineRows = lines.map((l) => ({
            invoice_id: invoiceId,
            card_type_id: l.card_type_id,
            qty: safeNum(l.qty),
            price: safeNum(l.price),
            line_total: safeNum(l.line_total),
          }));

          const { error: liErr } = await supabase.from("invoice_line_items").insert(lineRows);
          if (liErr) throw liErr;

          // IMPORTANT: حركة المخزون تُدار من قاعدة البيانات (Trigger/RPC)
          // - لو الفاتورة تخص بائع: تخصم من vendor_stock_movements
          // - لو الفاتورة من المستودع: تخصم من card_movements/card_stock
        } else {
          const usage = Math.max(0, safeNum(currReading) - safeNum(prevReading));
          const lineTotal = usage * safeNum(pricePerGb);

          const { error: liErr } = await supabase.from("invoice_line_items").insert({
            invoice_id: invoiceId,
            prev_reading_gb: safeNum(prevReading),
            curr_reading_gb: safeNum(currReading),
            usage_gb: usage,
            price_per_gb: safeNum(pricePerGb),
            line_total: lineTotal,
          });
          if (liErr) throw liErr;

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

      // ===== إنشاء (منع التكرار) =====
      const { data: existing, error: exErr } = await supabase.from("invoices").select("id,number").eq("client_uid", uid).maybeSingle();
      if (exErr) throw exErr;

      if (existing?.id) {
        showToast(`هذه الفاتورة محفوظة مسبقاً: ${existing.number || existing.id}`, "warn");
        setTab("list");
        await loadInvoices();
        return;
      }

      const { data: inserted, error: invErr } = await supabase.from("invoices").insert(invRow).select("*").single();
      if (invErr) throw invErr;

      invoiceId = inserted.id;

      if (!inserted.number) {
        const number = `INV-${String(invoiceId).padStart(6, "0")}`;
        await supabase.from("invoices").update({ number }).eq("id", invoiceId);
        inserted.number = number;
      }
      invNumber = inserted.number || inserted.id;

      // Insert line items
      if (invoiceType === "cards") {
        const lineRows = lines.map((l) => ({
          invoice_id: invoiceId,
          card_type_id: l.card_type_id,
          qty: safeNum(l.qty),
          price: safeNum(l.price),
          line_total: safeNum(l.line_total),
        }));

        const { error: liErr } = await supabase.from("invoice_line_items").insert(lineRows);
        if (liErr) throw liErr;

        // IMPORTANT: حركة المخزون تُدار من قاعدة البيانات (Trigger/RPC)
      } else {
        const usage = Math.max(0, safeNum(currReading) - safeNum(prevReading));
        const lineTotal = usage * safeNum(pricePerGb);

        const { error: liErr } = await supabase.from("invoice_line_items").insert({
          invoice_id: invoiceId,
          prev_reading_gb: safeNum(prevReading),
          curr_reading_gb: safeNum(currReading),
          usage_gb: usage,
          price_per_gb: safeNum(pricePerGb),
          line_total: lineTotal,
        });
        if (liErr) throw liErr;

        await supabase.from("customers").update({ last_reading_gb: safeNum(currReading) }).eq("id", Number(customerId));
      }

      // سند تلقائي إذا مدفوع > 0
      if (safeNum(paidAmount) > 0) {
        await supabase.from("payments").insert({
  customer_id: Number(customerId),
  invoice_id: invoiceId,
  pay_date: invoiceDate.slice(0,10),
  amount: safeNum(paidAmount),
  payment_type: "invoice",
  method: "cash",
  reference: null,
  note: `سند تلقائي من الفاتورة ${invNumber}`,
  created_at: `${invoiceDate.slice(0,10)}T12:00:00`,
  seller_user_id: user?.id || null
});

} // <-- أضف هذا السطر

await loadCardBalances();
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

  // ===== Print saved invoice =====
  async function printSavedInvoice(inv) {
    try {
      setLoading(true);
      const invId = inv.id;

      let linesData = [];
      const { data: vLines, error: vErr } = await supabase.from("v_invoice_lines").select("*").eq("invoice_id", invId);
      if (!vErr && vLines) {
        linesData = vLines;
      } else {
        const { data, error } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", invId);
        if (error) throw error;
        linesData = data || [];
      }

      const custName = inv.customer_name || customers.find((c) => c.id === inv.customer_id)?.name || "";

      const w = window.open("", "_blank", "width=900,height=900");
      if (!w) return showToast("فعّل النوافذ المنبثقة (Popups)", "warn");

      const opening = safeNum(customers.find((c) => c.id === inv.customer_id)?.opening_balance ?? 0);
      const invoicesRemaining = (invoices || [])
        .filter((i) => Number(i.customer_id) === Number(inv.customer_id))
        .reduce((s, i) => s + safeNum(i.remaining_amount), 0);
      const unlinked = safeNum(unlinkedPaymentsByCustomer?.[String(inv.customer_id)] || 0);
      const debtVal = calcCustomerDebt(opening, invoicesRemaining, unlinked);

      w.document.open();
      w.document.write(buildPrintHtml(inv, linesData, custName, debtVal));
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 250);
    } catch (e) {
      console.error(e);
      showToast("فشل الطباعة", "err");
    } finally {
      setLoading(false);
    }
  }

  // ===== Payments =====
  function openPay(inv) {
    const st = statusUi(inv);
    if (st.key === "void" || st.key === "refund") return showToast("لا يمكن السداد لفاتورة ملغاة/مرتجعة", "warn");

    setPayInvoice(inv);
    setPayAmount(safeNum(inv?.remaining_amount));
    setPayMethod("cash");
    setPayRef("");
    setPayNote("");
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayModalOpen(true);
  }

  async function doPay() {
    if (!payInvoice?.id) return;
    let amt = Math.max(0, safeNum(payAmount));
    if (amt <= 0) return showToast("أدخل مبلغ سداد صحيح", "warn");

    try {
      setLoading(true);

      const invId = payInvoice.id;

      const { data: invRow, error: e1 } = await supabase.from("invoices").select("*").eq("id", invId).maybeSingle();
      if (e1) throw e1;
      if (!invRow) return showToast("الفاتورة غير موجودة أو تم حذفها سابقاً", "warn");

      // لا نسمح بسداد أكبر من المتبقي (حتى لا يطلع 400 من Supabase أو يصير سداد زائد)
      const remainingNow = Math.max(0, safeNum(invRow.total_after_discount) - safeNum(invRow.paid_amount));
      if (remainingNow <= 0) return showToast("الفاتورة مسددة بالكامل", "info");
      if (amt > remainingNow + 1e-9) {
        showToast(`تم تعديل مبلغ السداد إلى المتبقي فقط: ${money(remainingNow)}`, "warn");
        amt = remainingNow;
      }


      const st = statusUi(invRow);
      if (st.key === "void" || st.key === "refund") return showToast("لا يمكن السداد لفاتورة ملغاة/مرتجعة", "warn");

      const paidNew = safeNum(invRow.paid_amount) + amt;
      const totalAfter = safeNum(invRow.total_after_discount);
      const remainingNew = Math.max(0, totalAfter - paidNew);

      const { error: pErr } = await supabase
  .from("payments")
  .insert({
    customer_id: invRow.customer_id,
    invoice_id: invId,
    pay_date: payDate,
    amount: amt,
    payment_type: "invoice",
    method: payMethod,
    reference: payRef || null,
    note: payNote || null,
    created_at: `${payDate}T12:00:00`,
    seller_user_id: user?.id || null
  });

if (pErr) throw pErr;

      const { error: uErr } = await supabase
        .from("invoices")
        .update({
          paid_amount: paidNew,
          remaining_amount: remainingNew,
          status: asPaidStatus(remainingNew),
        })
        .eq("id", invId);
      if (uErr) throw uErr;

      await loadInvoices();
      setPayModalOpen(false);
      showToast("تم السداد", "ok");
    } catch (e) {
      console.error(e);
      showToast(e?.message || "فشل السداد", "err");
    } finally {
      setLoading(false);
    }
  }

  // ===== Filter list =====
  const filteredInvoices = useMemo(() => {
    let arr = invoices;

    // فلتر المصدر (للإدارة فقط)
    if (!isSeller) {
      if (invScope === "seller") arr = arr.filter((x) => !!x.seller_user_id);
      if (invScope === "admin") arr = arr.filter((x) => !x.seller_user_id);
    }

    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return arr;

    return arr.filter((inv) => {
      const id = String(inv?.number || inv?.invoice_no || inv?.id || "").toLowerCase();
      const customer = String(inv?.customer_name || inv?.customer || "").toLowerCase();
      const type = String(inv?.invoice_type || inv?.type || "").toLowerCase();
      const note = String(inv?.note || "").toLowerCase();
      return id.includes(q) || customer.includes(q) || type.includes(q) || note.includes(q);
    });
  }, [invoices, invoiceSearch, invScope, isSeller]);

  const unpaidInvoices = useMemo(() => (filteredInvoices || []).filter((x) => safeNum(x.remaining_amount) > 0), [filteredInvoices]);

  // ===== Customers for autocomplete list =====
  const filteredCustomersForUi = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 20);
    return customers.filter((c) => String(c.name || "").toLowerCase().includes(q)).slice(0, 20);
  }, [customers, customerQuery]);

  // ===== UI =====
  return (
    <div style={{ padding: 18, direction: "rtl" }}>
      {/* TOAST */}
      {toast.open && (
        <div
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 99999,
            padding: "12px 14px",
            borderRadius: 14,
            border:
              toast.type === "ok"
                ? "1px solid rgba(54, 208, 170, 0.55)"
                : toast.type === "warn"
                ? "1px solid rgba(255, 200, 70, 0.55)"
                : "1px solid rgba(255, 90, 90, 0.55)",
            background:
              toast.type === "ok"
                ? "rgba(54, 208, 170, 0.18)"
                : toast.type === "warn"
                ? "rgba(255, 200, 70, 0.18)"
                : "rgba(255, 90, 90, 0.18)",
            color: "#fff",
            minWidth: 260,
            maxWidth: 520,
            backdropFilter: "blur(10px)",
          }}
        >
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
            <button
              className="btn btn-outline no-print"
              onClick={() => setPosMode((v) => !v)}
              title="وضع الكاشير: يخصم من عهدتك بدل المخزون العام"
            >
              🧾 وضع الكاشير: {posMode ? "مفعل" : "متوقف"}
            </button>
          )}

          <button onClick={() => setTab("create")} style={tab === "create" ? styles.tabActive : styles.tab}>
            إنشاء
          </button>
          <button
            onClick={async () => {
              setTab("list");
              setLoading(true);
              try {
                await loadInvoices();
              } finally {
                setLoading(false);
              }
            }}
            style={tab === "list" ? styles.tabActive : styles.tab}
          >
            سجل
          </button>
          <button
            onClick={async () => {
              setTab("pay");
              setLoading(true);
              try {
                await loadInvoices();
              } finally {
                setLoading(false);
              }
            }}
            style={tab === "pay" ? styles.tabActive : styles.tab}
          >
            سداد
          </button>
          <button
            onClick={async () => {
              setLoading(true);
              try {
                const cs = await loadCustomers();
                await loadUnlinkedPayments();
                await loadCardBalances();
        await loadVendorStock();
                await loadInvoices(cs);
                showToast("تم التحديث", "ok");
              } finally {
                setLoading(false);
              }
            }}
            style={styles.tab}
          >
            تحديث
          </button>
        </div>
      </div>

      {/* ===== Seller Cashier Box ===== */}
      {canUseCashier && posMode && (
        <div style={{ ...styles.card, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>🧾 كاشير البائع (ملخص الفترة)</div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>يعرض إجمالي الفواتير والمقبوض والمتبقي خلال الفترة المحددة لمراجعة الحسابات قبل تسليم العهدة.</div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ ...styles.label, margin: 0 }}>
                من
                <input
  type="datetime-local"
  value={invoiceDate}
  onChange={(e) => setInvoiceDate(e.target.value)}
  style={styles.input}
/>
              </label>
              <label style={{ ...styles.label, margin: 0 }}>
                إلى
                <input
  type="datetime-local"
  value={invoiceDate}
  onChange={(e) => setInvoiceDate(e.target.value)}
  style={styles.input}
/>
              </label>
              <button
                className="btn btn-outline"
                onClick={async () => {
                  setCashierLoading(true);
                  try {
                    await loadCashierSummary();
                  } finally {
                    setCashierLoading(false);
                  }
                }}
              >
                {cashierLoading ? "..." : "تحديث الكاشير"}
              </button>
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
              <div style={styles.kpiSub}>حسب paid_amount / (الإجمالي - المتبقي)</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiTitle}>المتبقي (آجل)</div>
              <div style={styles.kpiValue}>{money(cashierSummary.invoicesRemainingTotal)}</div>
              <div style={styles.kpiSub}>مجموع remaining_amount</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiTitle}>صافي المقبوض (فواتير + سندات)</div>
              <div style={styles.kpiValue}>{money(cashierSummary.collectedTotal)}</div>
              <div style={styles.kpiSub}>
                سندات: +{money(cashierSummary.paymentsInTotal)} / -{money(cashierSummary.paymentsOutTotal)}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && <div style={styles.loading}>... جاري التحميل</div>}

      {/* ===== CREATE ===== */}
      {tab === "create" && (
        <div style={styles.card}>
          {editMode && (
            <div style={styles.editBar}>
              <div>
                أنت الآن تعدّل فاتورة: <b>{editInvoiceId}</b>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={resetForm} style={styles.btnDanger}>
                  إلغاء التعديل
                </button>
              </div>
            </div>
          )}

          <div style={styles.grid3}>
            <label style={styles.label}>
              تاريخ الفاتورة
              <input
  type="datetime-local"
  value={invoiceDate}
  onChange={(e) => setInvoiceDate(e.target.value)}
  style={styles.input}
/>
            </label>

            <label style={styles.label}>
              العميل *
              <div ref={customerBoxRef} style={{ position: "relative" }}>
                <input
                  value={customerQuery}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    setShowCustomerList(true);
                  }}
                  onFocus={() => setShowCustomerList(true)}
                  placeholder="اكتب اسم العميل..."
                  style={styles.input}
                  disabled={editMode}
                />

                {showCustomerList && !editMode && (
  <div
    style={{
      position: "absolute",
      top: "calc(100% + 6px)",
      right: 0,
      left: 0,
      background: "#ffffff",          // ✅ أفتح
      border: "1px solid #d0d7de",     // ✅ حد واضح
      borderRadius: 12,
      maxHeight: 240,
      overflowY: "auto",
      zIndex: 2000,
      color: "#111111",                // ✅ نص داكن
      boxShadow: "0 8px 24px rgba(0,0,0,.08)", // ✅ وضوح
    }}
  >

                    {filteredCustomersForUi.map((c) => (
                      <div
  key={c.id}
  onClick={() => {
    setCustomerId(String(c.id));
    setCustomerQuery(c.name || "");
    // ✅ طبق خصم العميل الافتراضي (يمكن تعديله في الفاتورة)
    setDiscountPercent(Number(c.discount_percent || 0));
    setShowCustomerList(false);
  }}
  style={{
    padding: "10px 12px",
    cursor: "pointer",
    borderBottom: "1px solid #eee",
  }}
  onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f8fa")}
  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
>

                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
  <div style={{ fontWeight: 700 }}>{c.name}</div>
  {Number(c.discount_percent || 0) > 0 && (
    <div style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid #d0d7de", background: "#f6f8fa" }}>
      خصم افتراضي: {Number(c.discount_percent || 0).toFixed(2)}%
    </div>
  )}
</div>
<div style={{ fontSize: 11, opacity: 0.72, marginTop: 2 }}>
  النوع: {c.type} {c.phone ? `— ${c.phone}` : ""}
</div>
                      </div>
                    ))}

                    {filteredCustomersForUi.length === 0 && <div style={{ padding: 12, fontSize: 12, opacity: 0.7 }}>لا يوجد عميل مطابق</div>}
                  </div>
                )}
              </div>
            </label>

            <label style={styles.label}>
              نوع الفاتورة
              <select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)} style={styles.input} disabled={editMode}>
                <option value="cards">كروت</option>
                {isGigaCustomer && <option value="giga">جيجا</option>}
              </select>
            </label>
          </div>

          {selectedCustomer && (
            <div style={styles.infoBar}>
              <span>
                العميل: <b>{selectedCustomer.name}</b>
              </span>
              <span style={{ opacity: 0.75 }}>
                النوع: <b>{selectedCustomer.type}</b>
              </span>
              <span>
                دين العميل: <b>{money(customerDebt)}</b>
              </span>
              {isGigaCustomer && (
                <span style={{ opacity: 0.75 }}>
                  سعر الجيجا: <b>{money(selectedCustomer.price_per_gb)}</b> | آخر قراءة: <b>{safeNum(selectedCustomer.last_reading_gb)}</b>
                </span>
              )}
            </div>
          )}

          {/* CARDS */}
          {invoiceType === "cards" ? (
            <>
              <div style={styles.subTitle}>بنود الكروت (من المخزون النهائي)</div>

              <div style={styles.grid4}>
                <label style={styles.label}>
                  نوع الكرت *
                  <select value={selCardId} onChange={(e) => setSelCardId(e.target.value)} style={styles.input}>
                    <option value="">اختر كرت...</option>
                    {cardsForUi.map((c) => (
                      <option key={c.card_type_id} value={c.card_type_id}>
                        {c.name} — السعر: {money(c.price)} — المتاح: {c.quantity}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={styles.label}>
                  الكمية
                  <input type="number" value={selQty} onChange={(e) => setSelQty(e.target.value)} style={styles.input} min="1" />
                </label>

                <label style={styles.label}>
                  السعر
                  <input type="number" value={selPrice} onChange={(e) => setSelPrice(e.target.value)} style={styles.input} min="0" />
                </label>

                <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
                  <button onClick={addLine} style={styles.btn}>
                    + إضافة بند
                  </button>
                  <button onClick={() => setLines([])} style={styles.btnGhost}>
                    تفريغ البنود
                  </button>
                </div>
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th>إجراء</th></tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: "center", opacity: 0.7 }}>
                          لا توجد بنود
                        </td></tr>
                    ) : (
                      lines.map((x, i) => (
                        <tr key={i}><td>{i + 1}</td><td>{x.name}</td><td>{x.qty}</td><td>{money(x.price)}</td><td>{money(x.line_total)}</td><td>
                            <button onClick={() => removeLine(i)} style={styles.btnDanger}>
                              حذف
                            </button>
                          </td></tr>
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
                <label style={styles.label}>
                  القراءة السابقة
                  <input type="number" value={prevReading} readOnly style={{ ...styles.input, opacity: 0.9 }} />
                </label>

                <label style={styles.label}>
                  القراءة الحالية *
                  <input type="number" value={currReading} onChange={(e) => setCurrReading(e.target.value)} style={styles.input} />
                </label>

                <label style={styles.label}>
                  سعر الجيجا
                  <input type="number" value={pricePerGb} readOnly style={{ ...styles.input, opacity: 0.9 }} />
                </label>

                <div style={styles.infoBox}>
                  الاستهلاك: <b>{Math.max(0, safeNum(currReading) - safeNum(prevReading))}</b>
                </div>
              </div>
            </>
          )}

          <div style={styles.grid3}>
            <label style={styles.label}>
              خصم %
              <input type="number" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} style={styles.input} min="0" max="100" />
            </label>
            <label style={styles.label}>
              المدفوع الآن
              <input type="number" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} style={styles.input} min="0" readOnly={editMode} />
              {editMode && <span style={{ fontSize: 11, opacity: 0.7 }}>في التعديل: السداد يكون من نافذة السداد</span>}
            </label>
            <label style={styles.label}>
              ملاحظات
              <input value={note} onChange={(e) => setNote(e.target.value)} style={styles.input} placeholder="اختياري..." />
            </label>
          </div>

          {/* POS/Cashier box (mainly for sellers) */}
          {canUseCashier && posMode && !editMode && (
            <div style={styles.cashierBox}>
              <div style={styles.cashierTitle}>كاشير</div>
              <div style={styles.cashierGrid}>
                <label style={styles.label}>
                  المبلغ المستلم من العميل
                  <input
                    type="number"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    style={styles.input}
                    min="0"
                    placeholder="مثال: 50"
                  />
                </label>

                <div style={styles.cashierInfo}>
                  المدفوع (يسجل تلقائياً): <b>{money(cashierPaid)}</b>
                </div>
                <div style={styles.cashierInfo}>
                  المتبقي على العميل: <b>{money(cashierRemaining)}</b>
                </div>
                <div style={styles.cashierInfo}>
                  الباقي للعميل: <b>{money(cashierChange)}</b>
                </div>
              </div>
              <div style={styles.cashierHint}>إذا كتبت مبلغ المستلم، سيتم تحديث "المدفوع" تلقائياً (حتى قيمة الإجمالي بعد الخصم).</div>
            </div>
          )}

          <div style={styles.summaryRow}>
            <div style={styles.sumChip}>
              قبل الخصم: <b>{money(subtotal)}</b>
            </div>
            <div style={styles.sumChip}>
              الخصم: <b>{money(discountValue)}</b>
            </div>
            <div style={styles.sumChip}>
              بعد الخصم: <b>{money(totalAfterDiscount)}</b>
            </div>
            <div style={styles.sumChip}>
              المتبقي: <b>{money(Math.max(0, totalAfterDiscount - safeNum(paidAmount)))}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "end", flexWrap: "wrap" }}>
            <button onClick={() => previewOrPrint("preview")} style={styles.btn}>
              معاينة
            </button>
            <button onClick={() => previewOrPrint("print")} style={styles.btn}>
              طباعة
            </button>
            <button onClick={saveInvoice} style={styles.btnPrimary}>
              {editMode ? "حفظ التعديل" : "حفظ الفاتورة"}
            </button>
            <button onClick={resetForm} style={styles.btnGhost}>
              تفريغ
            </button>
          </div>
        </div>
      )}

      {/* ===== LIST ===== */}
      {tab === "list" && (
        <div style={styles.card}>
          <div style={styles.subTitle}>سجل الفواتير</div>

          <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            {!isSeller && (
              <select
                value={invScope}
                onChange={(e) => setInvScope(e.target.value)}
                style={{ ...styles.input, width: 220, cursor: "pointer" }}
              >
                <option value="all">الكل</option>
                <option value="seller">فواتير البائع</option>
                <option value="admin">فواتير الإدارة</option>
              </select>
            )}

            <input
              value={invoiceSearch}
              onChange={(e) => setInvoiceSearch(e.target.value)}
              placeholder="بحث: رقم/اسم/نوع/حالة/تاريخ/ملاحظة..."
              style={{ ...styles.input, width: "min(520px, 100%)" }}
            />
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr><th>#</th><th>رقم</th><th>العميل</th><th>النوع</th><th>التاريخ</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                {filteredInvoices.length === 0 ? (
                  <tr><td colSpan={10} style={{ textAlign: "center", opacity: 0.7 }}>
                      لا توجد بيانات
                    </td></tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const st = statusUi(inv);
                    const isClosed = st.key === "void" || st.key === "refund";
                    return (
                      <tr key={inv.id}><td>{inv.id}</td><td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <span>{inv.number || "-"}</span>
                        {inv?.seller_user_id ? (
                          <span style={styles.badgeSeller}>بائع</span>
                        ) : (
                          <span style={styles.badgeAdmin}>إدارة</span>
                        )}
                      </div>
                    </td><td>{inv.customer_name || "-"}</td><td>{String(inv.invoice_type).toLowerCase() === "cards" ? "كروت" : "جيجا"}</td><td>{inv.invoice_date || (inv.created_at ? String(inv.created_at).slice(0, 10) : "")}</td><td>{money(inv.total_after_discount)}</td><td>{money(inv.paid_amount)}</td><td>{money(inv.remaining_amount)}</td><td>
                          <span
                            style={
                              st.key === "paid"
                                ? styles.badgePaid
                                : st.key === "partial"
                                ? styles.badgePartial
                                : st.key === "void"
                                ? styles.badgeVoid
                                : st.key === "refund"
                                ? styles.badgeRefund
                                : styles.badgeUnpaid
                            }
                          >
                            {st.ar}
                          </span>
                        </td><td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button onClick={() => printSavedInvoice(inv)} style={styles.btn}>
                            طباعة
                          </button>

                          <button onClick={() => openPay(inv)} style={styles.btnPrimary} disabled={isClosed}>
                            سداد
                          </button>

                          {canEditInvoice && (
                  <button
                    onClick={() => startEdit(inv)}
                    className="btn"
                    style={{
                      padding: "6px 10px",
                      borderRadius: 10,
                      background: "#e7f0ff",
                      border: "1px solid #cfe2ff",
                      cursor: "pointer",
                    }}
                    title="تعديل"
                  >
                    تعديل
                  </button>
                )}
                                {canRefundInvoice && canRefundThis(inv) && (
                  <button className="btn btn-outline" onClick={() => refundInvoice(inv)} title="مرتجع">
                    مرتجع
                  </button>
                )}
{canDeleteInvoice && (
                  <button
                    onClick={() => deleteInvoice(inv)}
                    className="btn"
                    style={{
                      padding: "6px 10px",
                      borderRadius: 10,
                      background: "#ffecec",
                      border: "1px solid #ffc9c9",
                      cursor: "pointer",
                    }}
                    title="حذف"
                  >
                    حذف
                  </button>
                )}
                        </td></tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>
            ملاحظة: (إلغاء) مسموح فقط إذا المدفوع = 0 — (مرتجع) يعمل حتى لو الفاتورة عليها سداد.
          </div>
        </div>
      )}

      {/* ===== PAY TAB ===== */}
      {tab === "pay" && (
        <div style={styles.card}>
          <div style={styles.subTitle}>سداد فواتير (غير مدفوعة)</div>

          <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <input value={invoiceSearch} onChange={(e) => setInvoiceSearch(e.target.value)} placeholder="بحث داخل الفواتير..." style={{ ...styles.input, width: "min(420px, 100%)" }} />
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr><th>#</th><th>رقم</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>إجراء</th></tr>
              </thead>
              <tbody>
                {unpaidInvoices.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: "center", opacity: 0.7 }}>
                      لا توجد فواتير متبقية
                    </td></tr>
                ) : (
                  unpaidInvoices.map((inv) => (
                    <tr key={inv.id}><td>{inv.id}</td><td>{inv.number || "-"}</td><td>{inv.customer_name || "-"}</td><td>{inv.invoice_date || ""}</td><td>{money(inv.total_after_discount)}</td><td>{money(inv.paid_amount)}</td><td>{money(inv.remaining_amount)}</td><td>
                        <button onClick={() => openPay(inv)} style={styles.btnPrimary}>
                          سداد
                        </button>
                      </td></tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== Pay Modal ===== */}
      {payModalOpen && (
        <div style={styles.modalBack}>
          <div style={styles.modal}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>سداد فاتورة #{payInvoice?.number || payInvoice?.id}</h3>
              <button onClick={() => setPayModalOpen(false)} style={styles.btnGhost}>
                إغلاق
              </button>
            </div>

            <div style={styles.payHint}>
              المتبقي على الفاتورة: <b>{money(payInvoice?.remaining_amount)}</b> — يمكنك تعديل مبلغ السداد
            </div>

            <div style={styles.grid2}>
              <label style={styles.label}>
                تاريخ السداد
                <input
  type="datetime-local"
  value={invoiceDate}
  onChange={(e) => setInvoiceDate(e.target.value)}
  style={styles.input}
/>
              </label>
              <label style={styles.label}>
                مبلغ السداد
                <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} style={styles.input} />
              </label>

              <label style={styles.label}>
                الطريقة
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={styles.input}>
  <option value="cash">نقدي</option>
  <option value="transfer">تحويل</option>
  <option value="from_balance">خصم من رصيد العميل</option>
  <option value="other">أخرى</option>
</select>

                  <div style={{fontSize: 12, opacity: 0.75, marginTop: 6}}>
                    إذا اخترت "خصم من رصيد العميل" فلن يُحسب ضمن النقد (الكاش)، لكنه يُسدد الفاتورة ويُنقص المتبقي.
                  </div>
              </label>
            </div>

            <div style={styles.grid2}>
              {payMethod !== "balance" && (
                  <label style={styles.label}>
                    مرجع (اختياري)
                    <input style={styles.input} value={payRef} onChange={(e)=>setPayRef(e.target.value)} placeholder="رقم العملية / إيصال" />
                  </label>
                )}
              <label style={styles.label}>
                ملاحظة (اختياري)
                <input value={payNote} onChange={(e) => setPayNote(e.target.value)} style={styles.input} />
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "end", gap: 10 }}>
              <button onClick={doPay} style={styles.btnPrimary}>
                تأكيد السداد
              </button>
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
  tab: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--text)",
    cursor: "pointer",
  },
  tabActive: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(54, 208, 170, 0.5)",
    background: "rgba(54, 208, 170, 0.18)",
    color: "var(--text)",
    cursor: "pointer",
  },
  loading: {
    padding: 10,
    borderRadius: 12,
    background: "var(--panel)",
    border: "1px solid var(--border)",
    marginBottom: 12,
    color: "var(--text)",
  },
  card: {
    padding: 16,
    borderRadius: 18,
    background: "var(--panel)",
    border: "1px solid var(--border)",
    color: "var(--text)",
  },
  editBar: {
    marginBottom: 12,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255, 200, 70, 0.35)",
    background: "rgba(255, 200, 70, 0.10)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  payHint: {
    marginTop: 10,
    marginBottom: 10,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    fontSize: 12,
    opacity: 0.9,
  },
  subTitle: { fontSize: 14, fontWeight: "bold", margin: "12px 0" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
  cashierBox: {
    marginTop: 12,
    padding: "12px 12px",
    borderRadius: 16,
    border: "1px solid var(--border)",
    background: "rgba(255,255,255,0.04)",
  },
  cashierTitle: { fontSize: 13, fontWeight: 800, marginBottom: 8 },
  cashierGrid: { display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 12, alignItems: "end" },
  cashierInfo: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    fontSize: 13,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
  },
  cashierHint: { marginTop: 8, fontSize: 12, opacity: 0.75, lineHeight: 1.4 },
  grid4: { display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12 },
  grid4b: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.95 },
  input: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "rgba(0,0,0,0.20)",
    color: "var(--text)",
    outline: "none",
  },
  btn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--text)",
    cursor: "pointer",
  },
  btnPrimary: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(54, 208, 170, 0.5)",
    background: "rgba(54, 208, 170, 0.18)",
    color: "var(--text)",
    cursor: "pointer",
  },
  btnDanger: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255, 90, 90, 0.5)",
    background: "rgba(255, 90, 90, 0.18)",
    color: "var(--text)",
    cursor: "pointer",
  },
  btnGhost: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
  },
  btnWarn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255, 200, 70, 0.5)",
    background: "rgba(255, 200, 70, 0.14)",
    color: "var(--text)",
    cursor: "pointer",
  },
  btnRefund: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(120, 180, 255, 0.55)",
    background: "rgba(120, 180, 255, 0.14)",
    color: "var(--text)",
    cursor: "pointer",
  },
  tableWrap: {
    marginTop: 12,
    overflowX: "auto",
    overflowY: "auto",
    maxHeight: 360,
    borderRadius: 14,
    border: "1px solid var(--border)",
  },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 900 },
  infoBar: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  infoBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid var(--border)",
    background: "var(--panel)",
  },
  summaryRow: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, justifyContent: "end" },
  sumChip: {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    fontSize: 13,
  },
  badgePaid: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(54, 208, 170, 0.55)",
    background: "rgba(54, 208, 170, 0.18)",
    color: "var(--text)",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  badgePartial: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255, 200, 70, 0.55)",
    background: "rgba(255, 200, 70, 0.18)",
    color: "var(--text)",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  badgeUnpaid: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255, 90, 90, 0.55)",
    background: "rgba(255, 90, 90, 0.18)",
    color: "var(--text)",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  badgeVoid: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(200, 200, 200, 0.55)",
    background: "rgba(200, 200, 200, 0.18)",
    color: "var(--text)",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  badgeRefund: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(120, 180, 255, 0.55)",
    background: "rgba(120, 180, 255, 0.18)",
    color: "var(--text)",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  badgeSeller: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(30, 200, 120, 0.45)",
    background: "rgba(30, 200, 120, 0.16)",
    color: "var(--text)",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  badgeAdmin: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(120, 120, 120, 0.35)",
    background: "rgba(120, 120, 120, 0.12)",
    color: "var(--text)",
    fontSize: 12,
    whiteSpace: "nowrap",
  },

  modalBack: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    zIndex: 9999,
  },
  modal: {
    width: "min(720px, 96vw)",
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 18,
    padding: 16,
    color: "var(--text)",
  },
};
