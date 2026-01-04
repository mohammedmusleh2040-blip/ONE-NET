// src/pages/Vendors.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { currentUser } from "../lib/auth";

// ===== helpers =====
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => safeNum(v).toFixed(2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowText = () => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ===== small toast =====
function Toast({ msg, kind = "ok", onClose }) {
  if (!msg) return null;
  const bg = kind === "err" ? "#ffe7e7" : kind === "warn" ? "#fff3cd" : "#e7fff1";
  const br = kind === "err" ? "#ff6b6b" : kind === "warn" ? "#ffbf00" : "#20c997";
  return (
    <div
      style={{
        position: "fixed",
        left: 18,
        bottom: 18,
        zIndex: 9999,
        background: bg,
        border: `1px solid ${br}`,
        borderRadius: 12,
        padding: "10px 12px",
        minWidth: 260,
        boxShadow: "0 10px 30px rgba(0,0,0,.12)",
      }}
      onClick={onClose}
      title="اضغط للإغلاق"
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{kind === "err" ? "خطأ" : kind === "warn" ? "تنبيه" : "تم"}</div>
      <div style={{ opacity: 0.9, lineHeight: 1.35 }}>{msg}</div>
    </div>
  );
}

export default function Vendors() {
  const me = useMemo(() => currentUser?.() || null, []);
  const actorId = me?.id || null;

  // ===== UI state =====
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState("ok");
  const toast = (m, k = "ok") => {
    setMsgKind(k);
    setMsg(m);
    window.clearTimeout(window.__toastTimer);
    window.__toastTimer = window.setTimeout(() => setMsg(""), 3500);
  };

  const [loading, setLoading] = useState(false);

  // Sellers list (role = seller)
  const [sellers, setSellers] = useState([]);
  const [sellerId, setSellerId] = useState("");

  // card types
  const [cardTypes, setCardTypes] = useState([]);
  const [cardTypeId, setCardTypeId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");

  // balances table (if table exists)
  const [balances, setBalances] = useState([]);

  // settlement filters
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [settleSellerId, setSettleSellerId] = useState(""); // (الكل أو بائع محدد)

  // settlement data
  const [invoices, setInvoices] = useState([]);
  const [deposits, setDeposits] = useState([]);

  const styles = useMemo(
    () => ({
      page: { padding: "18px 16px 28px" },
      headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
      h1: { margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: 0.2 },
      btn: {
        border: "1px solid rgba(0,0,0,.12)",
        background: "white",
        borderRadius: 12,
        padding: "8px 12px",
        cursor: "pointer",
      },
      btnPrimary: {
        border: "0",
        background: "#111827",
        color: "white",
        borderRadius: 12,
        padding: "10px 14px",
        cursor: "pointer",
        minWidth: 160,
      },
      card: {
        background: "white",
        borderRadius: 18,
        border: "1px solid rgba(0,0,0,.08)",
        boxShadow: "0 10px 30px rgba(0,0,0,.06)",
        padding: 16,
        marginTop: 14,
      },
      grid4: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 },
      grid3: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 },
      grid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 },
      input: {
        width: "100%",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,.12)",
        padding: "10px 12px",
        outline: "none",
        background: "white",
      },
      select: {
        width: "100%",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,.12)",
        padding: "10px 12px",
        outline: "none",
        background: "white",
      },
      label: { fontSize: 12, opacity: 0.75, marginBottom: 6 },
      table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, overflow: "hidden" },
      th: {
        textAlign: "right",
        fontSize: 12,
        opacity: 0.7,
        padding: "10px 10px",
        borderBottom: "1px solid rgba(0,0,0,.08)",
        background: "#fafafa",
      },
      td: { padding: "10px 10px", borderBottom: "1px solid rgba(0,0,0,.06)", fontSize: 13 },
      kpiWrap: { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 },
      kpi: {
        background: "#fff",
        borderRadius: 16,
        border: "1px solid rgba(0,0,0,.08)",
        padding: 12,
        minHeight: 72,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      },
      kpiTitle: { fontSize: 12, opacity: 0.7, marginBottom: 6 },
      kpiVal: { fontSize: 18, fontWeight: 900 },
      note: { marginTop: 10, fontSize: 12, opacity: 0.7, lineHeight: 1.45 },
      divider: { height: 1, background: "rgba(0,0,0,.08)", margin: "12px 0" },
    }),
    []
  );

  const refreshLists = async () => {
    setLoading(true);
    try {
      // sellers (role = seller)
      const s1 = await supabase.from("app_users").select("id, username, role").order("username", { ascending: true });
      if (s1.error) throw s1.error;
      const sellerRows = (s1.data || []).filter((r) => String(r.role || "").toLowerCase() === "seller");
      setSellers(sellerRows);

      // card types
      const ct = await supabase.from("card_types").select("id, name").order("id", { ascending: true });
      if (ct.error) throw ct.error;
      setCardTypes(ct.data || []);

      // balances if table exists
      await refreshBalances(sellerId || (sellerRows[0]?.id || ""));
    } catch (e) {
      console.error(e);
      toast(e?.message || String(e), "err");
    } finally {
      setLoading(false);
    }
  };

  const refreshBalances = async (sid) => {
    // Load balances from vendor_stock (no view required)
    try {
      if (!sid) {
        setBalances([]);
        return;
      }

      let r = await supabase
        .from("v_vendor_stock")
.select("card_type_id,card_name,price,qty")
        .eq("seller_user_id", sid);
      if (!r.error) {
        // add card_name from cardTypes
        const nameMap = new Map((cardTypes || []).map((c) => [Number(c.id), c.name]));
        const rows = (r.data || []).map((x) => ({ ...x, card_name: nameMap.get(Number(x.card_type_id)) || `#${x.card_type_id}` }));
        setBalances(rows);
        return;
      }
      setBalances([]);
    } catch {
      setBalances([]);
    }
  };

  useEffect(() => {
    refreshLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sellerId) refreshBalances(sellerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId, cardTypes]);

  const submitAssign = async () => {
    if (!sellerId) return toast("اختر البائع أولاً", "warn");
    if (!cardTypeId) return toast("اختر نوع الكرت", "warn");
    const q = safeNum(qty);
    if (q <= 0) return toast("اكتب كمية صحيحة", "warn");

    setLoading(true);
    try {
      const payload = {
        p_actor_id: actorId,
        p_seller_user_id: sellerId,
        p_card_type_id: Number(cardTypeId),
        p_movement_type: "assign",
        p_qty: q,
        p_note: (note || "").trim() || null,
        p_created_at: new Date().toISOString(),
      };

      const r = await supabase.rpc("vendor_stock_move", payload);
      if (r.error) throw r.error;

      toast("تم تسليم العهدة للبائع ✅", "ok");
      setQty("");
      setNote("");
      await refreshBalances(sellerId);
    } catch (e) {
      console.error(e);
      toast(e?.message || String(e), "err");
    } finally {
      setLoading(false);
    }
  };

  const calcSettlement = async () => {
    setLoading(true);
    try {
      const sid = settleSellerId || null;

      // invoices
      let invQ = supabase
        .from("invoices")
        .select("id, number, invoice_date, customer_id, total_after_discount, paid_amount, remaining_amount, status, seller_user_id")
        .gte("invoice_date", fromDate)
        .lte("invoice_date", toDate)
        .order("invoice_date", { ascending: true });

      if (sid) invQ = invQ.eq("seller_user_id", sid);
      const invR = await invQ;
      if (invR.error) throw invR.error;

      // deposits (IMPORTANT: column is deposit_date)
      let depQ = supabase
        .from("seller_deposits")
        .select("id, seller_user_id, deposit_date, amount, note, created_at")
        .gte("deposit_date", fromDate)
        .lte("deposit_date", toDate)
        .order("deposit_date", { ascending: true })
        .order("created_at", { ascending: true });

      if (sid) depQ = depQ.eq("seller_user_id", sid);
      const depR = await depQ;
      if (depR.error) throw depR.error;

      setInvoices(invR.data || []);
      setDeposits(depR.data || []);

      toast("تم تحديث التسوية ✅", "ok");
    } catch (e) {
      console.error(e);
      toast(e?.message || String(e), "err");
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    const sales = invoices.reduce((a, x) => a + safeNum(x.total_after_discount), 0);
    const paid = invoices.reduce((a, x) => a + safeNum(x.paid_amount), 0);
    const remaining = invoices.reduce((a, x) => a + safeNum(x.remaining_amount), 0);
    const deps = deposits.reduce((a, x) => a + safeNum(x.amount), 0);
    // المطلوب من البائع = إجمالي المبيعات - التوريدات (لأن الدفع للعميل قد يكون ديون)
    // إذا تبغى تعتبر "المطلوب" = المتبقي على الفواتير (ديون العملاء) + (مبيعات كاش غير موردة) فهذا يحتاج منطق أعمق.
    const net = sales - deps;
    return { sales, paid, remaining, deps, net };
  }, [invoices, deposits]);

  const sellerName = (id) => sellers.find((s) => s.id === id)?.username || "";
  const cardName = (id) => cardTypes.find((c) => String(c.id) === String(id))?.name || `#${id}`;

  const openPrint = () => {
    const sid = settleSellerId || "";
    const title = sid ? `كشف حساب البائع: ${sellerName(sid)}` : "كشف حساب البائع (الكل)";
    const html = `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  body{font-family: Arial, "Tajawal", sans-serif; margin:18px; color:#111;}
  .top{display:flex; justify-content:space-between; align-items:flex-start; gap:10px;}
  .brand{font-weight:900; font-size:16px; line-height:1.35;}
  .meta{font-size:12px; opacity:.75; line-height:1.5;}
  .kpis{display:grid; grid-template-columns: repeat(5, 1fr); gap:10px; margin:14px 0;}
  .kpi{border:1px solid #ddd; border-radius:12px; padding:10px;}
  .kpi .t{font-size:12px; opacity:.7; margin-bottom:6px}
  .kpi .v{font-size:18px; font-weight:900}
  h3{margin:14px 0 8px}
  table{width:100%; border-collapse:collapse; font-size:12px;}
  th,td{border:1px solid #e5e5e5; padding:8px; text-align:right}
  th{background:#fafafa}
  .muted{opacity:.7}
  @media print{button{display:none}}
</style>
</head>
<body>
  <div class="top">
    <div class="brand">
      ONE NET ERP<br/>
      <span style="font-weight:700; font-size:13px;">كشف حساب البائع / التسوية</span>
    </div>
    <div class="meta">
      <div><b>البائع:</b> ${sid ? sellerName(sid) : "الكل"}</div>
      <div><b>الفترة:</b> ${fromDate} → ${toDate}</div>
      <div><b>وقت الطباعة:</b> ${nowText()}</div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="t">إجمالي البيع</div><div class="v">${money(totals.sales)}</div></div>
    <div class="kpi"><div class="t">إجمالي المدفوع (حسب الفواتير)</div><div class="v">${money(totals.paid)}</div></div>
    <div class="kpi"><div class="t">إجمالي المتبقي (ديون العملاء)</div><div class="v">${money(totals.remaining)}</div></div>
    <div class="kpi"><div class="t">إجمالي التوريد</div><div class="v">${money(totals.deps)}</div></div>
    <div class="kpi"><div class="t">الصافي (البيع - التوريد)</div><div class="v">${money(totals.net)}</div></div>
  </div>

  <h3>تفاصيل الفواتير</h3>
  <table>
    <thead>
      <tr>
        <th>#</th><th>التاريخ</th><th>رقم</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th>
      </tr>
    </thead>
    <tbody>
      ${invoices
        .map(
          (x, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${x.invoice_date || ""}</td>
          <td>${x.number || x.id}</td>
          <td>${money(x.total_after_discount)}</td>
          <td>${money(x.paid_amount)}</td>
          <td>${money(x.remaining_amount)}</td>
          <td class="muted">${x.status || ""}</td>
        </tr>`
        )
        .join("")}
      ${invoices.length ? "" : `<tr><td colspan="7" class="muted">لا توجد فواتير ضمن الفترة.</td></tr>`}
    </tbody>
  </table>

  <h3>تفاصيل التوريدات (نهاية اليوم)</h3>
  <table>
    <thead>
      <tr>
        <th>#</th><th>اليوم</th><th>المبلغ</th><th>ملاحظة</th><th>وقت الإدخال</th>
      </tr>
    </thead>
    <tbody>
      ${deposits
        .map(
          (x, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${x.deposit_date || ""}</td>
          <td>${money(x.amount)}</td>
          <td class="muted">${(x.note || "").replace(/</g, "&lt;")}</td>
          <td class="muted">${(x.created_at || "").replace("T", " ").slice(0, 19)}</td>
        </tr>`
        )
        .join("")}
      ${deposits.length ? "" : `<tr><td colspan="5" class="muted">لا توجد توريدات مسجلة ضمن الفترة.</td></tr>`}
    </tbody>
  </table>

  <div style="margin-top:16px; font-size:12px; opacity:.75;">
    ملاحظة: الصافي هنا = إجمالي المبيعات - إجمالي التوريدات. (ديون العملاء تظهر في خانة المتبقي).
  </div>

  <button onclick="window.print()" style="margin-top:14px; padding:10px 14px; border-radius:10px; border:1px solid #ddd; background:white; cursor:pointer;">طباعة</button>
</body>
</html>`;
    const w = window.open("", "_blank");
    if (!w) return toast("السماح بالنوافذ المنبثقة (Popups) للطباعة", "warn");
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      try {
        w.focus();
      } catch {}
    }, 200);
  };

  // ===== Add deposit (توريد) =====
  const [depSellerId, setDepSellerId] = useState("");
  const [depDate, setDepDate] = useState(todayISO());
  const [depAmount, setDepAmount] = useState("");
  const [depNote, setDepNote] = useState("");

  
  const addDeposit = async () => {
    const sid = depSellerId || settleSellerId || sellerId;
    if (!sid) return toast("اختر البائع للتوريد", "warn");
    const a = safeNum(depAmount);
    if (a <= 0) return toast("اكتب مبلغ صحيح", "warn");

    setLoading(true);
    try {
      const ins = await supabase.from("seller_deposits").insert([
        {
          actor_id: actorId,
          seller_user_id: sid,
          deposit_date: depDate,
          amount: a,
          note: (depNote || "").trim() || null,
        },
      ]);
      if (ins.error) throw ins.error;

      toast("تم حفظ التوريد ✅", "ok");
      setDepAmount("");
      setDepNote("");
      // تحديث التسوية مباشرة إذا نفس الفترة
      await calcSettlement();
    } catch (e) {
      console.error(e);
      toast(e?.message || String(e), "err");
    } finally {
      setLoading(false);
    }
  };

  // ✅ طباعة عهدة البائع (A4 احترافية) + إجمالي + توقيع/ختم + اسم المستخدم ووقت رسمي
  const openPrintCustody = () => {
    const sid = sellerId || "";
    if (!sid) {
      toast("اختر بائع أولاً لطباعة العهدة", "warn");
      return;
    }

    const printedBy = (me?.username || me?.email || actorId || "").toString();
    const printedAt = nowText();

    const rows = (balances || []).map((b) => ({
      card: b.card_name || cardName(b.card_type_id),
      qty: safeNum(b.qty),
      price: safeNum(b.price ?? 0),
      value: safeNum(b.qty) * safeNum(b.price ?? 0),
    }));

    const totalQty = rows.reduce((a, r) => a + safeNum(r.qty), 0);
    const totalValue = rows.reduce((a, r) => a + safeNum(r.value), 0);

    const title = `عهدة البائع: ${sellerName(sid)}`;

    const html = `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Tajawal", sans-serif; color:#111; margin:0; }
  .sheet { width: 100%; }
  .header {
    display:flex; justify-content:space-between; align-items:flex-start; gap:12px;
    border:1px solid #e5e5e5; border-radius:14px; padding:12px 14px;
  }
  .brand { font-weight:900; font-size:16px; line-height:1.35; }
  .sub { font-size:12px; opacity:.75; margin-top:2px; }
  .meta { font-size:12px; line-height:1.8; text-align:left; }
  .meta b { font-weight:800; }
  .kpis { display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin:12px 0; }
  .kpi { border:1px solid #e5e5e5; border-radius:14px; padding:10px; }
  .kpi .t { font-size:12px; opacity:.7; margin-bottom:6px; }
  .kpi .v { font-size:18px; font-weight:900; }
  table { width:100%; border-collapse: collapse; font-size:12px; }
  th, td { border:1px solid #e5e5e5; padding:8px; text-align:right; vertical-align:middle; }
  th { background:#fafafa; font-weight:800; }
  .right { text-align:right; }
  .left { text-align:left; }
  .muted { opacity:.7; }
  .footer {
    margin-top:12px;
    display:grid; grid-template-columns: 1fr 1fr; gap:12px;
  }
  .box {
    border:1px solid #e5e5e5; border-radius:14px; padding:12px;
    min-height: 92px;
  }
  .box .t { font-weight:900; margin-bottom:10px; }
  .line { border-bottom:1px dashed #bbb; height: 18px; margin-top:12px; }
  .stamp {
    border:2px dashed #bbb; border-radius:12px; height: 70px;
    display:flex; align-items:center; justify-content:center; color:#666; font-weight:800;
  }
  .note {
    margin-top:10px; font-size:11px; opacity:.75; line-height:1.6;
  }
  .printbtn { margin-top:12px; padding:10px 14px; border-radius:10px; border:1px solid #ddd; background:white; cursor:pointer; }
  @media print { .no-print { display:none !important; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="brand">ONE NET ERP</div>
        <div class="sub">نموذج عهدة بائع (Vendor Custody Sheet)</div>
      </div>
      <div class="meta">
        <div><b>البائع:</b> ${sellerName(sid)}</div>
        <div><b>وقت الطباعة:</b> ${printedAt}</div>
        <div><b>طُبع بواسطة:</b> ${String(printedBy).replace(/</g,"&lt;")}</div>
        <div class="muted">المصدر: v_vendor_stock</div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="t">عدد الأصناف</div><div class="v">${rows.length}</div></div>
      <div class="kpi"><div class="t">إجمالي الكمية</div><div class="v">${money(totalQty)}</div></div>
      <div class="kpi"><div class="t">إجمالي القيمة</div><div class="v">${money(totalValue)}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th>الكرت</th>
          <th style="width:90px">السعر</th>
          <th style="width:90px">الكمية</th>
          <th style="width:110px">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r,i)=>`
          <tr>
            <td>${i+1}</td>
            <td>${String(r.card||"").replace(/</g,"&lt;")}</td>
            <td>${money(r.price)}</td>
            <td style="font-weight:900">${money(r.qty)}</td>
            <td style="font-weight:900">${money(r.value)}</td>
          </tr>
        `).join("")}
        ${rows.length ? "" : `<tr><td colspan="5" class="muted">لا توجد عهدة للبائع.</td></tr>`}
      </tbody>
      <tfoot>
        <tr>
          <th colspan="3" class="left">الإجمالي</th>
          <th>${money(totalQty)}</th>
          <th>${money(totalValue)}</th>
        </tr>
      </tfoot>
    </table>

    <div class="footer">
      <div class="box">
        <div class="t">توقيع المستلم (البائع)</div>
        <div class="muted">الاسم:</div>
        <div class="line"></div>
        <div class="muted">التوقيع:</div>
        <div class="line"></div>
      </div>

      <div class="box">
        <div class="t">اعتماد الإدارة</div>
        <div class="muted">الاسم / التوقيع:</div>
        <div class="line"></div>
        <div class="muted">الختم:</div>
        <div class="stamp">STAMP / ختم</div>
      </div>
    </div>

    <div class="note">
      * هذه الوثيقة للمتابعة الداخلية. في حال وجود أي اختلاف يرجى مراجعة الإدارة فوراً.<br/>
      * تم إنشاء هذا التقرير تلقائياً من النظام.
    </div>

    <div class="no-print">
      <button class="printbtn" onclick="window.print()">طباعة</button>
    </div>
  </div>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) return toast("المتصفح منع نافذة الطباعة", "warn");
    w.document.open();
    w.document.write(html);
    w.document.close();
  };


  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div style={styles.h1}>البائعين / العهد</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={styles.btn} onClick={refreshLists} disabled={loading}>
            تحديث
          </button>
          <button style={styles.btn} onClick={openPrint} disabled={loading}>
            طباعة
          </button>
        </div>
      </div>

      {/* ===== Card: Assign stock ===== */}
      <div style={styles.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900 }}>إضافة عهدة (تسليم كروت للبائع)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} className="no-print">
            <button style={styles.btn} onClick={openPrintCustody} disabled={loading}>
              طباعة العهدة
            </button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            يتم الخصم من مخزون الكروت (المخزون النهائي) + يُضاف لرصيد البائع.
          </div>
        </div>

        <div style={{ marginTop: 12, ...styles.grid4 }}>
          <div>
            <div style={styles.label}>البائع</div>
            <select style={styles.select} value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">— اختر —</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.username}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={styles.label}>نوع الكرت</div>
            <select style={styles.select} value={cardTypeId} onChange={(e) => setCardTypeId(e.target.value)}>
              <option value="">— اختر —</option>
              {cardTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={styles.label}>الكمية</div>
            <input style={styles.input} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="مثال: 50" inputMode="numeric" />
          </div>

          <div>
            <div style={styles.label}>ملاحظة</div>
            <input style={styles.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: عهدة صباح" />
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-start" }}>
          <button style={styles.btnPrimary} onClick={submitAssign} disabled={loading}>
            تسليم
          </button>
        </div>

        <div style={styles.divider} />

        <div style={{ fontWeight: 900, marginBottom: 8 }}>الرصيد عند البائع</div>
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>الكرت</th>
                <th style={styles.th}>الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {(balances || []).map((b, i) => (
                <tr key={i}>
                  <td style={styles.td}>{b.card_name || cardName(b.card_type_id)}</td>
                  <td style={styles.td}>{safeNum(b.qty)}</td>
                </tr>
              ))}
              {!balances?.length && (
                <tr>
                  <td style={styles.td} colSpan={2}>
                    لا يوجد عهدة للبائع بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={styles.note}>
          ملاحظة: إذا لم يظهر الرصيد، تأكد من وجود جدول/عرض <b>vendor_stock</b> أو <b>v_vendor_stock_balances</b> في قاعدة البيانات (حسب سكربت النظام).
        </div>
      </div>

      {/* ===== Card: Settlement ===== */}
      <div style={styles.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
  <div style={{ fontWeight: 900, marginBottom: 10 }}>تسوية البائع (الفواتير + التوريدات)</div>
  <div className="no-print">
    <button style={styles.btn} onClick={openPrint} disabled={loading}>طباعة التسوية</button>
  </div>
</div>

        <div style={styles.grid4}>
          <div>
            <div style={styles.label}>البائع</div>
            <select style={styles.select} value={settleSellerId} onChange={(e) => setSettleSellerId(e.target.value)}>
              <option value="">(الكل)</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.username}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={styles.label}>من تاريخ</div>
            <input style={styles.input} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>

          <div>
            <div style={styles.label}>إلى تاريخ</div>
            <input style={styles.input} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button style={styles.btnPrimary} onClick={calcSettlement} disabled={loading}>
              تحديث التسوية
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, ...styles.kpiWrap }}>
          <div style={styles.kpi}>
            <div style={styles.kpiTitle}>إجمالي البيع</div>
            <div style={styles.kpiVal}>{money(totals.sales)}</div>
          </div>
          <div style={styles.kpi}>
            <div style={styles.kpiTitle}>إجمالي المدفوع</div>
            <div style={styles.kpiVal}>{money(totals.paid)}</div>
          </div>
          <div style={styles.kpi}>
            <div style={styles.kpiTitle}>إجمالي التوريد</div>
            <div style={styles.kpiVal}>{money(totals.deps)}</div>
          </div>
          <div style={styles.kpi}>
            <div style={styles.kpiTitle}>إجمالي المتبقي (ديون العملاء)</div>
            <div style={styles.kpiVal}>{money(totals.remaining)}</div>
          </div>
          <div style={styles.kpi}>
            <div style={styles.kpiTitle}>الصافي (البيع - التوريد)</div>
            <div style={styles.kpiVal}>{money(totals.net)}</div>
          </div>
        </div>

        <div style={styles.divider} />

        <div style={{ fontWeight: 900, marginBottom: 8 }}>تفاصيل الفواتير</div>
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>#</th>
                <th style={styles.th}>التاريخ</th>
                <th style={styles.th}>الرقم</th>
                <th style={styles.th}>الإجمالي</th>
                <th style={styles.th}>المدفوع</th>
                <th style={styles.th}>المتبقي</th>
                <th style={styles.th}>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((x, i) => (
                <tr key={x.id}>
                  <td style={styles.td}>{i + 1}</td>
                  <td style={styles.td}>{x.invoice_date}</td>
                  <td style={styles.td}>{x.number || x.id}</td>
                  <td style={styles.td}>{money(x.total_after_discount)}</td>
                  <td style={styles.td}>{money(x.paid_amount)}</td>
                  <td style={styles.td}>{money(x.remaining_amount)}</td>
                  <td style={styles.td}>{x.status || ""}</td>
                </tr>
              ))}
              {!invoices.length && (
                <tr>
                  <td style={styles.td} colSpan={7}>
                    لا توجد فواتير ضمن الفترة (أو لم يتم ربط الفاتورة بالبائع <b>seller_user_id</b>).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={styles.divider} />

        <div style={{ fontWeight: 900, marginBottom: 8 }}>إضافة توريد (نهاية اليوم)</div>
        <div style={styles.grid4}>
          <div>
            <div style={styles.label}>البائع</div>
            <select style={styles.select} value={depSellerId} onChange={(e) => setDepSellerId(e.target.value)}>
              <option value="">— اختر —</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.username}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={styles.label}>اليوم</div>
            <input style={styles.input} type="date" value={depDate} onChange={(e) => setDepDate(e.target.value)} />
          </div>
          <div>
            <div style={styles.label}>المبلغ</div>
            <input style={styles.input} value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder="مثال: 15000" inputMode="decimal" />
          </div>
          <div>
            <div style={styles.label}>ملاحظة</div>
            <input style={styles.input} value={depNote} onChange={(e) => setDepNote(e.target.value)} placeholder="مثال: توريد نهاية اليوم" />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button style={styles.btnPrimary} onClick={addDeposit} disabled={loading}>
            حفظ التوريد
          </button>
        </div>

        <div style={{ marginTop: 12, fontWeight: 900 }}>توريدات مسجلة ضمن الفترة</div>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>#</th>
                <th style={styles.th}>اليوم</th>
                <th style={styles.th}>المبلغ</th>
                <th style={styles.th}>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((x, i) => (
                <tr key={x.id}>
                  <td style={styles.td}>{i + 1}</td>
                  <td style={styles.td}>{x.deposit_date}</td>
                  <td style={styles.td}>{money(x.amount)}</td>
                  <td style={styles.td}>{x.note || ""}</td>
                </tr>
              ))}
              {!deposits.length && (
                <tr>
                  <td style={styles.td} colSpan={4}>
                    لا توجد توريدات مسجلة ضمن الفترة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={styles.note}>
          إذا كانت الأرقام = 0: غالباً السبب أن الفواتير لا تحمل <b>seller_user_id</b> أو لم تسجل توريدات في جدول <b>seller_deposits</b>.
        </div>
      </div>

      <Toast msg={msg} kind={msgKind} onClose={() => setMsg("")} />
    </div>
  );
}
