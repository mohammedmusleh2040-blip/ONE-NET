// src/pages/Invoices.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ===== Helpers =====
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => safeNum(v).toFixed(2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

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

  // ===== Master data =====
  const [customers, setCustomers] = useState([]);
  const [cards, setCards] = useState([]); // from v_card_balances
  const [invoices, setInvoices] = useState([]);

  // ===== منع التكرار + وضع تعديل =====
  const [saving, setSaving] = useState(false);
  const [clientUid, setClientUid] = useState(null);

  const [editMode, setEditMode] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState(null);
  const [editOldLines, setEditOldLines] = useState([]);

  // ===== Create invoice =====
  const [invoiceType, setInvoiceType] = useState("cards"); // cards | giga
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [customerId, setCustomerId] = useState("");
  const [note, setNote] = useState("");

  // Customer Autocomplete
  const [customerQuery, setCustomerQuery] = useState("");
  const [showCustomerList, setShowCustomerList] = useState(false);
  const customerBoxRef = useRef(null);

  // Discount + payment now
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);

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

  // Pay modal
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState("cash");
  const [payRef, setPayRef] = useState("");
  const [payNote, setPayNote] = useState("");

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

  // ===== دين العميل =====
  const customerDebt = useMemo(() => {
    if (!selectedCustomer) return 0;
    const cid = Number(selectedCustomer.id);
    const opening = safeNum(selectedCustomer.opening_balance);
    const due = (invoices || [])
      .filter((i) => Number(i.customer_id) === cid)
      .reduce((s, i) => s + safeNum(i.remaining_amount), 0);
    return opening + due;
  }, [selectedCustomer, invoices]);

  // ===== Loaders =====
  async function loadCustomers() {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,type,phone,address,notes,opening_balance,price_per_gb,last_reading_gb,created_at")
      .order("id", { ascending: true });
    if (error) throw error;
    setCustomers(data || []);
    return data || [];
  }

  async function loadCardBalances() {
    const { data, error } = await supabase.from("v_card_balances").select("*");
    if (error) throw error;

    const mapped = (data || [])
      .map((r) => ({
        card_type_id: r.card_type_id ?? r.ct_id ?? r.id ?? null,
        name: r.name ?? r.card_name ?? r.card_type_name ?? "",
        price: safeNum(r.price ?? r.selling_price ?? 0),
        quantity: safeNum(r.quantity ?? r.qty ?? r.balance ?? 0),
      }))
      .filter((x) => x.card_type_id != null);

    setCards(mapped);

    if (!selCardId && mapped.length) {
      setSelCardId(String(mapped[0].card_type_id));
      setSelPrice(mapped[0].price);
    }
  }

  async function loadInvoices(customersList = customers) {
    // view أولاً
    const { data: vData, error: vErr } = await supabase
      .from("v_invoices")
      .select("*")
      .order("id", { ascending: false });

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
    const { data, error } = await supabase
      .from("invoices")
      .select("id,number,customer_id,invoice_type,invoice_date,total_before_discount,discount_percent,discount_value,total_after_discount,paid_amount,remaining_amount,status,note,created_at")
      .order("id", { ascending: false });
    if (error) throw error;

    const cm = new Map((customersList || []).map((c) => [c.id, c.name]));
    setInvoices((data || []).map((x) => ({ ...x, customer_name: cm.get(x.customer_id) || "" })));
  }

  // ===== Init =====
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      try {
        setLoading(true);
        const cs = await loadCustomers();
        await loadCardBalances();
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
    const c = cards.find((x) => String(x.card_type_id) === String(selCardId));
    if (c) setSelPrice(safeNum(c.price));
  }, [selCardId, invoiceType, cards]);

  // ===== Lines =====
  function addLine() {
    const c = cards.find((x) => String(x.card_type_id) === String(selCardId));
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
  async function rpcCardMove({ card_type_id, movement_type, qty, noteText, created_at_iso }) {
    // محاولة 1: توقيع فيه p_created_at
    let res = await supabase.rpc("apply_card_movement", {
      p_card_type_id: Number(card_type_id),
      p_movement_type: String(movement_type).toUpperCase(),
      p_qty: Number(qty),
      p_note: noteText || null,
      // مهم: إرسال null لـ p_created_at قد يجعل PostgREST غير قادر على تحديد نوع الباراميتر
      // لذلك لا نرسل p_created_at إلا إذا كان لدينا قيمة ISO صحيحة.
      ...(created_at_iso ? { p_created_at: String(created_at_iso) } : {}),
    });

    if (!res.error) return res.data;

    // محاولة 2: بدون p_created_at (لو الدالة عندك 4 باراميتر)
    res = await supabase.rpc("apply_card_movement", {
      p_card_type_id: Number(card_type_id),
      p_movement_type: String(movement_type).toUpperCase(),
      p_qty: Number(qty),
      p_note: noteText || null,
    });

    if (!res.error) return res.data;

    // لا نحاول أسماء مختلفة هنا لأن هذا غالبًا يولّد نفس الخطأ (توقيع غير مطابق).
    // نعيد الخطأ الحقيقي لكي يظهر لك في الـ Console بوضوح.
    throw res.error;
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
        // ISO مع Z عشان يطابق timestamptz بسهولة
        created_at_iso: invDateStr ? `${invDateStr}T12:00:00.000Z` : null,
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
        created_at_iso: invDateStr ? `${invDateStr}T12:00:00.000Z` : null,
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
        invoice_date: invoiceDate,
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
        await revertCardInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, "رجوع (إلغاء)");
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

  async function refundInvoice(inv) {
    if (!inv?.id) return;
    const st = statusUi(inv);
    if (st.key === "void" || st.key === "refund") return showToast("هذه الفاتورة تم إغلاقها مسبقاً", "warn");

    const ok = confirm(`مرتجع للفاتورة ${inv.number || inv.id} ؟\nسيتم إرجاع المخزون + تسجيل سند مرتجع + تصفير الفاتورة.`);
    if (!ok) return;

    try {
      setLoading(true);

      const invRow = await getInvoiceRow(inv.id);
      if (!invRow) return showToast("الفاتورة غير موجودة", "err");

      const invLines = await fetchInvoiceLines(inv.id);

      // 1) رجّع المخزون لو كروت (IN)
      if (String(invRow.invoice_type || "").toLowerCase() === "cards") {
        await revertCardInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, "رجوع (مرتجع)");
      }

      // 2) سجل سند “مرتجع” في payments (amount سالب)
      const refundAmount = Math.max(0, safeNum(invRow.paid_amount) || safeNum(invRow.total_after_discount));
      if (refundAmount > 0) {
        const { error: payErr } = await supabase.from("payments").insert({
          customer_id: invRow.customer_id,
          invoice_id: invRow.id,
          amount: -refundAmount,
          payment_type: "other",
          method: "cash",
          reference: null,
          note: `[REFUND] مرتجع للفاتورة ${invRow.number || invRow.id}`,
          created_at: nowISO(),
        });
        if (payErr) throw payErr;
      }

      // 3) صفّر الفاتورة
      await zeroInvoice(inv.id, "REFUND");

      await loadCardBalances();
      await loadInvoices();
      showToast("تم إنشاء المرتجع", "ok");
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
        await revertCardInByLines(invRow.number || invRow.id, invRow.invoice_date, invLines, "رجوع (حذف)");
      }

      const { error: eDelLines } = await supabase.from("invoice_line_items").delete().eq("invoice_id", inv.id);
      if (eDelLines) throw eDelLines;

      const { error: eDelInv } = await supabase.from("invoices").delete().eq("id", inv.id);
      if (eDelInv) throw eDelInv;

      await loadCardBalances();
      await loadInvoices();
      showToast("تم حذف الفاتورة", "ok");
    } catch (e) {
      console.error(e);
      showToast("فشل حذف الفاتورة", "err");
    } finally {
      setLoading(false);
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
          const c = cards.find((x) => String(x.card_type_id) === String(l.card_type_id));
          if (!c) return showToast("خطأ: بند غير موجود في المخزون", "err");
          if (!editMode && safeNum(l.qty) > safeNum(c.quantity)) return showToast(`الرصيد غير كافي للصنف: ${c.name}`, "warn");
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
        invoice_date: invoiceDate,
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
          await revertCardInByLines(dbInv.number || dbInv.id, dbInv.invoice_date, editOldLines, "تصحيح (رجوع قديم)");
        }

        // امسح البنود القديمة
        const { error: eDel } = await supabase.from("invoice_line_items").delete().eq("invoice_id", invoiceId);
        if (eDel) throw eDel;

        // حدّث رأس الفاتورة
        const { data: upInv, error: eUp } = await supabase.from("invoices").update(invRow).eq("id", invoiceId).select("*").single();
        if (eUp) throw eUp;

        invNumber = upInv.number || upInv.id;

        // أدخل البنود الجديدة + خصم OUT
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

          await applyCardOutByLines(invNumber, invoiceDate, lines);
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

      // Insert line items + خصم مخزون
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

        // خصم OUT عبر RPC (ينشئ حركة ويحدث الرصيد)
        await applyCardOutByLines(invNumber, invoiceDate, lines);
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
          amount: safeNum(paidAmount),
          payment_type: "invoice",
          method: "cash",
          reference: null,
          note: `سند تلقائي من الفاتورة ${invNumber}`,
          created_at: `${invoiceDate}T12:00:00`,
        });
      }

      await loadCardBalances();
      await loadInvoices();

      showToast(`تم حفظ الفاتورة: ${invNumber}`, "ok");
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

      const debtVal =
        (customers.find((c) => c.id === inv.customer_id)?.opening_balance ?? 0) +
        (invoices || [])
          .filter((i) => Number(i.customer_id) === Number(inv.customer_id))
          .reduce((s, i) => s + safeNum(i.remaining_amount), 0);

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
    setPayModalOpen(true);
  }

  async function doPay() {
    if (!payInvoice?.id) return;
    const amt = Math.max(0, safeNum(payAmount));
    if (amt <= 0) return showToast("أدخل مبلغ سداد صحيح", "warn");

    try {
      setLoading(true);

      const invId = payInvoice.id;

      const { data: invRow, error: e1 } = await supabase.from("invoices").select("*").eq("id", invId).maybeSingle();
      if (e1) throw e1;
      if (!invRow) return showToast("الفاتورة غير موجودة أو تم حذفها سابقاً", "warn");

      const st = statusUi(invRow);
      if (st.key === "void" || st.key === "refund") return showToast("لا يمكن السداد لفاتورة ملغاة/مرتجعة", "warn");

      const paidNew = safeNum(invRow.paid_amount) + amt;
      const totalAfter = safeNum(invRow.total_after_discount);
      const remainingNew = Math.max(0, totalAfter - paidNew);

      const { error: pErr } = await supabase.from("payments").insert({
        customer_id: invRow.customer_id,
        invoice_id: invId,
        amount: amt,
        payment_type: "invoice",
        method: payMethod,
        reference: payRef || null,
        note: payNote || null,
        created_at: `${todayISO()}T12:00:00`,
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
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const id = String(inv.id ?? "");
      const num = String(inv.number ?? "").toLowerCase();
      const name = String(inv.customer_name ?? "").toLowerCase();
      const type = String(inv.invoice_type ?? "").toLowerCase();
      const status = String(inv.status ?? "").toLowerCase();
      const date = String(inv.invoice_date ?? "").toLowerCase();
      const note = String(inv.note ?? "").toLowerCase();
      return [id, num, name, type, status, date, note].some((x) => x.includes(q));
    });
  }, [invoices, invoiceSearch]);

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
                await loadCardBalances();
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
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} style={styles.input} />
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
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      maxHeight: 240,
                      overflowY: "auto",
                      zIndex: 2000,
                      color: "var(--text)",
                    }}
                  >
                    {filteredCustomersForUi.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => {
                          setCustomerId(String(c.id));
                          setCustomerQuery(c.name || "");
                          setShowCustomerList(false);
                        }}
                        style={{
                          padding: "10px 12px",
                          cursor: "pointer",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 11, opacity: 0.65 }}>
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
                    {cards.map((c) => (
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
                    <tr>
                      <th>#</th>
                      <th>الصنف</th>
                      <th>الكمية</th>
                      <th>السعر</th>
                      <th>الإجمالي</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "center", opacity: 0.7 }}>
                          لا توجد بنود
                        </td>
                      </tr>
                    ) : (
                      lines.map((x, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{x.name}</td>
                          <td>{x.qty}</td>
                          <td>{money(x.price)}</td>
                          <td>{money(x.line_total)}</td>
                          <td>
                            <button onClick={() => removeLine(i)} style={styles.btnDanger}>
                              حذف
                            </button>
                          </td>
                        </tr>
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

          <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
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
                <tr>
                  <th>#</th>
                  <th>رقم</th>
                  <th>العميل</th>
                  <th>النوع</th>
                  <th>التاريخ</th>
                  <th>الإجمالي</th>
                  <th>المدفوع</th>
                  <th>المتبقي</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: "center", opacity: 0.7 }}>
                      لا توجد بيانات
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const st = statusUi(inv);
                    const isClosed = st.key === "void" || st.key === "refund";
                    return (
                      <tr key={inv.id}>
                        <td>{inv.id}</td>
                        <td>{inv.number || "-"}</td>
                        <td>{inv.customer_name || "-"}</td>
                        <td>{String(inv.invoice_type).toLowerCase() === "cards" ? "كروت" : "جيجا"}</td>
                        <td>{inv.invoice_date || (inv.created_at ? String(inv.created_at).slice(0, 10) : "")}</td>
                        <td>{money(inv.total_after_discount)}</td>
                        <td>{money(inv.paid_amount)}</td>
                        <td>{money(inv.remaining_amount)}</td>
                        <td>
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
                        </td>
                        <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button onClick={() => printSavedInvoice(inv)} style={styles.btn}>
                            طباعة
                          </button>

                          <button onClick={() => openPay(inv)} style={styles.btnPrimary} disabled={isClosed}>
                            سداد
                          </button>

                          <button onClick={() => startEdit(inv)} style={styles.btn} disabled={isClosed}>
                            تعديل
                          </button>

                          <button onClick={() => voidInvoice(inv)} style={styles.btnWarn} disabled={isClosed || safeNum(inv.paid_amount) > 0}>
                            إلغاء
                          </button>

                          <button onClick={() => refundInvoice(inv)} style={styles.btnRefund} disabled={isClosed}>
                            مرتجع
                          </button>

                          <button onClick={() => deleteInvoice(inv)} style={styles.btnDanger} disabled={isClosed}>
                            حذف
                          </button>
                        </td>
                      </tr>
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
                <tr>
                  <th>#</th>
                  <th>رقم</th>
                  <th>العميل</th>
                  <th>التاريخ</th>
                  <th>الإجمالي</th>
                  <th>المدفوع</th>
                  <th>المتبقي</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {unpaidInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", opacity: 0.7 }}>
                      لا توجد فواتير متبقية
                    </td>
                  </tr>
                ) : (
                  unpaidInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.id}</td>
                      <td>{inv.number || "-"}</td>
                      <td>{inv.customer_name || "-"}</td>
                      <td>{inv.invoice_date || ""}</td>
                      <td>{money(inv.total_after_discount)}</td>
                      <td>{money(inv.paid_amount)}</td>
                      <td>{money(inv.remaining_amount)}</td>
                      <td>
                        <button onClick={() => openPay(inv)} style={styles.btnPrimary}>
                          سداد
                        </button>
                      </td>
                    </tr>
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
                مبلغ السداد
                <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} style={styles.input} />
              </label>

              <label style={styles.label}>
                الطريقة
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={styles.input}>
                  <option value="cash">نقدي</option>
                  <option value="transfer">تحويل</option>
                  <option value="other">أخرى</option>
                </select>
              </label>
            </div>

            <div style={styles.grid2}>
              <label style={styles.label}>
                مرجع (اختياري)
                <input value={payRef} onChange={(e) => setPayRef(e.target.value)} style={styles.input} />
              </label>
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
