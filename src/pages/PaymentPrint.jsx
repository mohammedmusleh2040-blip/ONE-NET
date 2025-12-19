import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => safeNum(v).toFixed(2);

export default function PaymentPrint() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const [loading, setLoading] = useState(true);
  const [pay, setPay] = useState(null);
  const [cust, setCust] = useState(null);
  const [inv, setInv] = useState(null);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        const { data: st } = await supabase.from("settings").select("*").limit(1).maybeSingle();
        setSettings(st || null);

        const { data: p, error: pe } = await supabase
          .from("payments")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (pe) throw pe;
        setPay(p);

        if (p?.customer_id) {
          const { data: c } = await supabase.from("customers").select("*").eq("id", p.customer_id).maybeSingle();
          setCust(c || null);
        }
        if (p?.invoice_id) {
          const { data: i } = await supabase.from("invoices").select("*").eq("id", p.invoice_id).maybeSingle();
          setInv(i || null);
        }

        setTimeout(() => window.print(), 250);
      } catch (e) {
        console.error(e);
        alert(e?.message || "فشل تحميل السند");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!pay) return <div style={{ padding: 24 }}>السند غير موجود</div>;

  const amt = safeNum(pay.amount);
  const typeLabel = amt < 0 ? "سند صرف" : "سند قبض";

  return (
    <div dir="rtl" style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{settings?.company_name || settings?.shop_name || "شبكة ون نت اللاسلكية"}</div>
          <div style={{ opacity: 0.8 }}>{settings?.address || ""}</div>
          <div style={{ opacity: 0.8 }}>{settings?.phone ? `هاتف: ${settings.phone}` : ""}</div>
        </div>
        {settings?.logo_base64 ? (
          <img alt="logo" src={settings.logo_base64} style={{ height: 60, objectFit: "contain" }} />
        ) : null}
      </div>

      <hr style={{ margin: "16px 0" }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{typeLabel}</div>
          <div style={{ opacity: 0.85 }}>رقم السند: {pay.number || pay.id}</div>
          <div style={{ opacity: 0.85 }}>التاريخ: {new Date(pay.created_at || Date.now()).toLocaleString("ar-EG")}</div>
        </div>
        <div style={{ textAlign: "left" }}>
          {inv?.number ? <div style={{ opacity: 0.85 }}>رقم الفاتورة: {inv.number}</div> : null}
          <div style={{ opacity: 0.85 }}>العميل: {cust?.name || "-"}</div>
          <div style={{ opacity: 0.85 }}>طريقة الدفع: {pay.method || "-"}</div>
        </div>
      </div>

      <div style={{ marginTop: 18, border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
          <div style={{ fontWeight: 700 }}>المبلغ</div>
          <div style={{ fontWeight: 900 }}>{money(Math.abs(amt))}</div>
        </div>
        {pay.note ? <div style={{ marginTop: 10, opacity: 0.85 }}>ملاحظة: {pay.note}</div> : null}
      </div>

      <div style={{ marginTop: 26, display: "flex", justifyContent: "space-between" }}>
        <div>توقيع المستلم: __________________</div>
        <div>توقيع المحاسب: __________________</div>
      </div>
    </div>
  );
}
