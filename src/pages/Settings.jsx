
// src/pages/Settings.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { currentUser } from "../lib/auth";

// =====================
// Small helpers
// =====================
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pickFirst = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

function dlText(filename, text, mime = "application/json;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// =====================
// Component
// =====================
export default function Settings() {
  // ---- Tabs ----
  const TABS = useMemo(
    () => [
      { key: "identity", label: "🏷 الهوية" },
      { key: "general", label: "⚙ الإعدادات العامة" },
      { key: "backup", label: "💾 النسخ الاحتياطي" },
      { key: "audit", label: "🧾 سجل التدقيق" },
      { key: "danger", label: "☠ الحذف الشامل" },
    ],
    []
  );
  const [tab, setTab] = useState("identity");

  // ---- State ----
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [settings, setSettings] = useState({
    id: 1,
    shop_name: "",
    shop_name_en: "",
    company_name: "",
    company_name_en: "",
    phone: "",
    address: "",
    currency: "SAR",
    language: "ar",
    default_price_per_gb: 0,
    low_stock_threshold: 10,
    logo_url: "",
    logo_base64: "",
    reset_secret: "",
  });

  // Backup/Restore
  const [wipeToken, setWipeToken] = useState("");
  const [wipeAlsoResetIds, setWipeAlsoResetIds] = useState(true);
  const [restoreToken, setRestoreToken] = useState("");
  const restoreFileRef = useRef(null);

  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [wipeBusy, setWipeBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // ---- Admin + Audit ----
  const ADMIN_EMAIL = "mohammedmusleh2040@gmail.com";
  const [meEmail, setMeEmail] = useState("");
  const [auditRows, setAuditRows] = useState([]);
  const [auditBusy, setAuditBusy] = useState(false);

  const isAdmin = useMemo(() => {
    const a = String(ADMIN_EMAIL || "").trim().toLowerCase();
    const e =
      String(meEmail || "").trim().toLowerCase() ||
      String(currentUser()?.email || "").trim().toLowerCase() ||
      String(currentUser()?.username || "").trim().toLowerCase();
    return !!a && e === a;
  }, [meEmail, ADMIN_EMAIL]);


  // ---- Load ----
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        setLoading(true);
        // get current auth email (for admin-only tabs)
        try {
          const { data: authData } = await supabase.auth.getUser();
          if (alive) setMeEmail(authData?.user?.email || "");
        } catch (e) {
          // ignore
        }
        setMsg("");
        const { data, error } = await supabase
          .from("settings")
          .select("*")
          .order("id", { ascending: true })
          .limit(1);

        if (error) throw error;

        const row = pickFirst(data);
        if (row) {
          if (!alive) return;
          setSettings((prev) => ({
            ...prev,
            ...row,
            id: row.id ?? 1,
          }));
        } else {
          // If table empty, create default row id=1
          const { error: insErr } = await supabase.from("settings").insert([{ ...settings }]);
          if (insErr) throw insErr;
        }
      } catch (e) {
        console.error(e);
        if (alive) setMsg(`خطأ تحميل الإعدادات: ${e?.message || e}`);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  
  useEffect(() => {
    if (tab === "audit") loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isAdmin]);

const setField = (k, v) => {
    setSettings((p) => ({ ...p, [k]: v }));
  };

  // ---- Save ----
  async function saveSettings() {
    try {
      setSaving(true);
      setMsg("");
      const payload = { ...settings, id: settings.id ?? 1 };
      const { error } = await supabase.from("settings").upsert(payload, { onConflict: "id" });
      if (error) throw error;
      setMsg("✅ تم حفظ الإعدادات");
    } catch (e) {
      console.error(e);
      setMsg(`❌ خطأ حفظ الإعدادات: ${e?.message || e}`);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(""), 2500);
    }
  }

  // ---- Logo helpers ----
  async function onPickLogoFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || "");
      setField("logo_base64", base64);
      // keep logo_url as-is (optional)
    };
    reader.readAsDataURL(file);
  }

  function clearLogo() {
    setField("logo_base64", "");
    setField("logo_url", "");
  }

  // ---- Backup (Download JSON + store in app_backups) ----
  async function buildBackupObject() {
    // Build a JSON backup of key tables.
    // NOTE: Some deployments may not have all tables (e.g., invoice_line_items).
    // We safely skip missing tables so Backup never breaks.
    const tables = [
      "settings",
      "customers",
      "items",
      "card_types",
      "card_movements",
      "invoices",
      "invoice_line_items", // optional
      "payments",
      "expenses",
    ];

    const out = {
      meta: {
        created_at: new Date().toISOString(),
        created_by: currentUser()?.email || currentUser()?.username || "unknown",
        missing_tables: [],
        errors: [],
      },
      tables: {},
    };

    for (const t of tables) {
      try {
        const { data, error } = await supabase.from(t).select("*");
        if (error) {
          const msg = String(error.message || "");
          if (
            error.code === "PGRST202" ||
            msg.includes("Could not find the table") ||
            msg.includes("schema cache")
          ) {
            out.meta.missing_tables.push(t);
            continue;
          }
          out.meta.errors.push({ table: t, code: error.code || null, message: msg });
          continue;
        }
        out.tables[t] = data || [];
      } catch (e) {
        out.meta.errors.push({ table: t, code: null, message: String(e) });
      }
    }

    return out;
  }

  async function doBackup() {
    try {
      setBackupBusy(true);
      setMsg("");
      const backup = await buildBackupObject();

      // Download
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `onenet-backup-${stamp}.json`;
      dlText(filename, JSON.stringify(backup, null, 2));

      // Store in Supabase (app_backups)
      // NOTE: app_backups.created_by is UUID (FK to auth.users). Store label separately.
      const { data: authData } = await supabase.auth.getUser();
      const uid = currentUser()?.id || null;

      console.log("CURRENT USER =", currentUser());
      console.log("UID =", uid);
      
      const label =
        currentUser()?.email ||
        currentUser()?.username ||
        authData?.user?.email ||
        "mohammedmusleh2040@gmail.com" ||
        "unknown";

      // enrich backup meta (optional)
      backup.meta.created_by = label;
      backup.meta.created_by_uuid = uid;

      const { error: insErr } = await supabase.from("app_backups").insert([
        {
          note: filename,
          data: backup,
          created_by: uid,
          created_by_label: label,
        },
      ]);
      if (insErr) throw insErr;

      setMsg("✅ تم تنزيل النسخة + حفظها في Supabase");
    } catch (e) {
      console.error(e);
      setMsg(`❌ فشل النسخ الاحتياطي: ${e?.message || e}`);
    } finally {
      setBackupBusy(false);
      setTimeout(() => setMsg(""), 3500);
    }
  }

  
  // ---- Audit (admin only) ----
  async function loadAudit() {
    if (!isAdmin) return;
    try {
      setAuditBusy(true);
      const { data, error } = await supabase
        .from("audit_log")
        .select("id,created_at,action,actor_label,details")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setAuditRows(data || []);
    } catch (e) {
      console.error(e);
      setMsg(`❌ فشل تحميل سجل التدقيق: ${e?.message || e}`);
    } finally {
      setAuditBusy(false);
    }
  }

// ---- Restore (from JSON file) ----
  async function doRestoreFromFile(file) {
    if (!file) return;
    try {
      setRestoreBusy(true);
      setMsg("");

      const token = String(restoreToken || "").trim();
      if (!token) {
        setMsg("❌ اكتب reset_secret أولاً لاسترجاع النسخة");
        return;
      }

      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup?.tables) throw new Error("ملف النسخة غير صحيح (tables غير موجودة)");

      // 1) wipe all existing data (RPC)


const { error: wipeErr } = await supabase.rpc("admin_wipe_all", {
  p_actor_id: uid,
  p_reset_secret: token,
  p_reset_ids: true,
});
      if (wipeErr) throw wipeErr;

      // 2) insert back data (order matters due to FK)
      const order = [
        "settings",
        "customers",
        "items",
        "card_types",
        "invoices",
        "invoice_line_items",
        "payments",
        "expenses",
        "card_movements",
      ];

      for (const t of order) {
      const rows = backup.tables?.[t] || [];
      if (!backup.tables || !(t in backup.tables)) continue;
      if (!rows.length) continue;

      const { error } = await supabase.from(t).insert(rows);
      if (error) {
        const msg = String(error.message || "");
        if (error.code === "PGRST202" || msg.includes("Could not find the table") || msg.includes("schema cache")) {
          continue; // table not present in this deployment
        }
        throw new Error(`${t}: ${msg}`);
      }
    }

      setMsg("✅ تم الاسترجاع بنجاح");
    } catch (e) {
      console.error(e);
      setMsg(`❌ فشل الاسترجاع: ${e?.message || e}`);
    } finally {
      setRestoreBusy(false);
      setTimeout(() => setMsg(""), 3500);
      if (restoreFileRef.current) restoreFileRef.current.value = "";
    }
  }

  // ---- Wipe All ----
  async function doWipeAll() {
    try {
      setWipeBusy(true);
      setMsg("");
      const token = String(wipeToken || "").trim();
      if (!token) {
        setMsg("❌ لازم تكتب reset_secret لتأكيد الحذف الشامل");
        return;
      }

      const ok = window.confirm("⚠️ تأكيد: سيتم حذف كل البيانات نهائياً. هل أنت متأكد؟");
      if (!ok) return;

      // ✅ Auto Backup before Wipe (download + store in app_backups)
      // لن نكمل الحذف إذا فشل حفظ النسخة
      const backup = await buildBackupObject();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `onenet-backup-before-wipe-${stamp}.json`;

      // تنزيل نسخة للمستخدم
      dlText(filename, JSON.stringify(backup, null, 2));

      // حفظ النسخة في Supabase
      const { data: authData } = await supabase.auth.getUser();
      const uid = currentUser()?.id || null;

      console.log("CURRENT USER =", currentUser());
      console.log("UID =", uid);
      
      const label =
        authData?.user?.email ||
        currentUser()?.email ||
        currentUser()?.username ||
        "unknown";

      backup.meta = backup.meta || {};
      backup.meta.created_by_uuid = uid;
      backup.meta.created_by = label;

      const { error: backupErr } = await supabase.from("app_backups").insert([
        {
          note: filename,
          data: backup,
          created_by: uid,
          created_by_label: label,
        },
      ]);
      if (backupErr) throw backupErr;

 console.log("AUTH USER =", authData);
console.log("AUTH ID =", authData?.user?.id);     

const { error } = await supabase.rpc("admin_wipe_all", {
  p_actor_id: uid,
  p_reset_secret: token,
  p_reset_ids: !!wipeAlsoResetIds,
});
      if (error) throw error;

      setMsg("✅ تم الحذف الشامل");
    } catch (e) {
      console.error(e);
      setMsg(`❌ فشل الحذف الشامل: ${e?.message || e}`);
    } finally {
      setWipeBusy(false);
      setTimeout(() => setMsg(""), 3500);
    }
  }

  // ---- Reset IDs only (RPC admin_reset_sequences) ----
  async function doResetIdsOnly() {
    try {
      setResetBusy(true);
      setMsg("");
      const token = String(wipeToken || "").trim();
      if (!token) {
        setMsg("❌ اكتب reset_secret لتصفير الـ IDs");
        return;
      }
      const ok = window.confirm("تأكيد: تصفير الـ IDs فقط (بدون حذف البيانات)؟");
      if (!ok) return;

      const { error } = await supabase.rpc("admin_reset_sequences", { p_token: token });
      if (error) throw error;
      setMsg("✅ تم تصفير الـ IDs");
    } catch (e) {
      console.error(e);
      setMsg(`❌ فشل تصفير الـ IDs: ${e?.message || e}`);
    } finally {
      setResetBusy(false);
      setTimeout(() => setMsg(""), 3500);
    }
  }

  // =====================
  // UI styles (lightweight, match your current soft UI)
  // =====================
  const card = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    marginBottom: 16,
  };
  const h3 = { margin: "0 0 12px", fontSize: 16, fontWeight: 900 };
  const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
  const label = { display: "block", marginBottom: 6, color: "#374151", fontWeight: 700, fontSize: 13 };
  const input = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    outline: "none",
  };
  const tabRow = { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 };
  const tabBtn = (active) => ({
    padding: "10px 12px",
    borderRadius: 14,
    border: active ? "1px solid #10b981" : "1px solid #e5e7eb",
    background: active ? "#d1fae5" : "#fff",
    cursor: "pointer",
    fontWeight: 900,
  });
  const btn = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 800,
  };
  const btnPrimary = {
    ...btn,
    background: "#d1fae5",
    border: "1px solid #10b981",
  };
  const btnDanger = {
    ...btn,
    background: "#fee2e2",
    border: "1px solid #ef4444",
    color: "#b91c1c",
  };
  const dangerBox = {
    borderRadius: 14,
    border: "1px solid rgba(239,68,68,.35)",
    background: "rgba(239,68,68,.05)",
    padding: 16,
  };

  const logoPreview = settings.logo_base64 || settings.logo_url;

  return (
    <div className="page">
      <div className="page-header">
        <h1>الإعدادات</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={saveSettings} disabled={saving || loading} className="btn primary">
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </button>
        </div>
      </div>

      {msg ? (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 12, background: "#f3f4f6", border: "1px solid #e5e7eb" }}>
          {msg}
        </div>
      ) : null}

      <div style={tabRow}>
        {TABS.map((t) => (
          <button key={t.key} style={tabBtn(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ===================== TAB: IDENTITY ===================== */}
      {tab === "identity" && (
        <>
          <div style={card}>
            <div style={h3}>🏷 الهوية</div>

            <div style={grid2}>
              <div>
                <label style={label}>اسم الشركة</label>
                <input style={input} value={settings.company_name || ""} onChange={(e) => setField("company_name", e.target.value)} />
              </div>
              <div>
                <label style={label}>Company Name (EN)</label>
                <input style={input} value={settings.company_name_en || ""} onChange={(e) => setField("company_name_en", e.target.value)} />
              </div>

              <div>
                <label style={label}>اسم المتجر</label>
                <input style={input} value={settings.shop_name || ""} onChange={(e) => setField("shop_name", e.target.value)} />
              </div>
              <div>
                <label style={label}>Shop Name (EN)</label>
                <input style={input} value={settings.shop_name_en || ""} onChange={(e) => setField("shop_name_en", e.target.value)} />
              </div>

              <div>
                <label style={label}>الهاتف</label>
                <input style={input} value={settings.phone || ""} onChange={(e) => setField("phone", e.target.value)} />
              </div>
              <div>
                <label style={label}>العنوان</label>
                <input style={input} value={settings.address || ""} onChange={(e) => setField("address", e.target.value)} />
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={h3}>الشعار</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12, alignItems: "start" }}>
              <div>
                <label style={label}>رابط الشعار (URL) - اختياري</label>
                <input style={input} value={settings.logo_url || ""} onChange={(e) => setField("logo_url", e.target.value)} placeholder="https://..." />
                <div style={{ height: 10 }} />
                <label style={label}>أو ارفع صورة (Base64)</label>
                <input type="file" accept="image/*" onChange={(e) => onPickLogoFile(e.target.files?.[0])} />
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <button style={btn} onClick={clearLogo}>
                    حذف الشعار
                  </button>
                </div>
                <div style={{ marginTop: 8, color: "#6b7280", fontSize: 12 }}>
                  سيتم حفظ الشعار داخل جدول الإعدادات (logo_base64) أو بالرابط (logo_url).
                </div>
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ marginBottom: 8, fontWeight: 800 }}>معاينة</div>
                <div
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: 18,
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {logoPreview ? <img alt="logo" src={logoPreview} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ color: "#9ca3af" }}>لا يوجد</span>}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===================== TAB: GENERAL ===================== */}
      {tab === "general" && (
        <>
          <div style={card}>
            <div style={h3}>⚙ الإعدادات العامة</div>

            <div style={grid2}>
              <div>
                <label style={label}>العملة</label>
                <input style={input} value={settings.currency || "SAR"} onChange={(e) => setField("currency", e.target.value)} />
              </div>

              <div>
                <label style={label}>اللغة</label>
                <select style={input} value={settings.language || "ar"} onChange={(e) => setField("language", e.target.value)}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </div>

              <div>
                <label style={label}>سعر افتراضي للجيجا</label>
                <input style={input} type="number" value={safeNum(settings.default_price_per_gb)} onChange={(e) => setField("default_price_per_gb", safeNum(e.target.value))} />
              </div>

              <div>
                <label style={label}>تنبيه قرب نفاد المخزون (Threshold)</label>
                <input style={input} type="number" value={safeNum(settings.low_stock_threshold)} onChange={(e) => setField("low_stock_threshold", safeNum(e.target.value))} />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={label}>رمز الحذف الشامل (reset_secret)</label>
                <input style={input} value={settings.reset_secret || ""} onChange={(e) => setField("reset_secret", e.target.value)} placeholder="مثال: 1234" />
                <div style={{ marginTop: 8, color: "#6b7280", fontSize: 12 }}>احتفظ به سري. سيُستخدم للحذف الشامل + الاسترجاع + تصفير IDs.</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===================== TAB: BACKUP ===================== */}
      {tab === "backup" && (
        <>
          <div style={card}>
            <div style={h3}>💾 النسخ الاحتياطي والاسترجاع</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button style={btnPrimary} onClick={doBackup} disabled={backupBusy || loading}>
                {backupBusy ? "جارٍ إنشاء النسخة..." : "تنزيل نسخة احتياطية (JSON)"}
              </button>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  style={{ ...input, width: 220 }}
                  value={restoreToken}
                  onChange={(e) => setRestoreToken(e.target.value)}
                  placeholder="اكتب reset_secret للاسترجاع"
                />
                <input ref={restoreFileRef} type="file" accept="application/json" onChange={(e) => doRestoreFromFile(e.target.files?.[0])} disabled={restoreBusy} />
              </div>
            </div>

            <div style={{ marginTop: 10, color: "#6b7280", fontSize: 12 }}>
              النسخة تشمل: العملاء / الأصناف / أنواع الكروت / الفواتير / بنود الفواتير / السداد / المصروفات / حركات الكروت + الإعدادات.
              <br />
              عند التنزيل: يتم حفظ نسخة داخل Supabase في جدول <b>app_backups</b> تلقائياً.
            </div>
          </div>
        </>
      )}

      
      {/* ===================== TAB: AUDIT ===================== */}
      {tab === "audit" && (
        <>
          {!isAdmin ? (
            <div style={card}>
              <div style={h3}>🧾 سجل التدقيق</div>
              <div style={{ color: "#b91c1c", fontWeight: 800 }}>
                غير مصرح لك بعرض هذا السجل.
              </div>
            </div>
          ) : (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={h3}>🧾 سجل التدقيق (Audit)</div>
                  <div style={{ color: "#6b7280", fontSize: 12 }}>
                    يظهر عمليات الحذف الشامل ومن قام بها ووقتها.
                  </div>
                </div>

                <button style={btn} onClick={loadAudit} disabled={auditBusy}>
                  {auditBusy ? "جارٍ التحديث..." : "تحديث"}
                </button>
              </div>

              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>الوقت</th>
                      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>العملية</th>
                      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>المستخدم</th>
                      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>تفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(auditRows || []).length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 10, color: "#6b7280", textAlign: "center" }}>
                          لا توجد سجلات
                        </td>
                      </tr>
                    ) : (
                      auditRows.map((r) => (
                        <tr key={r.id}>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap" }}>
                            {new Date(r.created_at).toLocaleString("ar-EG")}
                          </td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontWeight: 900 }}>
                            {r.action}
                          </td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                            {r.actor_label || "-"}
                          </td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap", direction: "ltr", fontSize: 12 }}>
                              {JSON.stringify(r.details || {}, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}


      {/* ===================== TAB: DANGER ===================== */}
      {tab === "danger" && (
        <>
          <div style={card}>
            <div style={h3}>☠ عمليات خطرة</div>

            <div style={dangerBox}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>حذف شامل لكل البيانات</div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <input style={{ ...input, width: 220 }} value={wipeToken} onChange={(e) => setWipeToken(e.target.value)} placeholder="اكتب reset_secret" />
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                  <input type="checkbox" checked={wipeAlsoResetIds} onChange={(e) => setWipeAlsoResetIds(e.target.checked)} />
                  تصفير IDs بعد الحذف
                </label>

                <button style={btnDanger} onClick={doWipeAll} disabled={wipeBusy}>
                  {wipeBusy ? "جارٍ الحذف..." : "حذف شامل لكل البيانات"}
                </button>

                <button style={btn} onClick={doResetIdsOnly} disabled={resetBusy}>
                  {resetBusy ? "جارٍ التصفير..." : "تصفير IDs فقط"}
                </button>
              </div>

              <div style={{ marginTop: 10, color: "#7f1d1d", fontSize: 12 }}>
                ⚠️ ملاحظة: الحذف الشامل لا يمكن التراجع عنه. استخدم النسخ الاحتياطي قبل الحذف.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
