import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { currentUser } from "../lib/auth.js";

// ========= Helpers =========
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function sha256(text) {
  const enc = new TextEncoder().encode(String(text || ""));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ⚠️ ملاحظة: هذا Hash بسيط على المتصفح. لاحقاً نقدر نحسنها بسيرفر/Edge Function.
async function hashPassword(password) {
  // salt بسيط ثابت للتطبيق (ممكن تخليه إعداد في Supabase لاحقاً)
  const salt = "ONENET_SALT_V1";
  return sha256(`${salt}::${password}`);
}

const emptySettings = {
  id: null,
  company_name: "شبكة ون نت اللاسلكية",
  company_name_en: "Network One Net Wireless",
  logo_base64: "",
  logo_url: "",
  phone: "",
  address: "",
  currency: "YER",
  language: "ar",
  default_price_per_gb: 0,
  low_stock_threshold: 10,
  reset_secret: "1234",
};

export default function Settings() {
  const me = currentUser();
  const isAdmin = me?.role === "Admin";

  const [tab, setTab] = useState("system"); // system | users | backup | reset
  const [settings, setSettings] = useState(emptySettings);
  const [saving, setSaving] = useState(false);

  // Users
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userForm, setUserForm] = useState({
    id: "",
    username: "",
    password: "",
    role: "Seller",
    perms: {},
    is_active: true,
  });
  const [editingId, setEditingId] = useState(null);

  // Backup / restore
  const fileRef = useRef(null);
  const [busyBackup, setBusyBackup] = useState(false);

  // Reset
  const [wiping, setWiping] = useState(false);
  const [resetCode, setResetCode] = useState("");

  const roleOptions = ["Admin", "Seller", "Viewer"];

  const canSeeAdmin = isAdmin;

  async function writeAudit(action, entity, entityId, detail) {
    try {
      await supabase.from("app_audit_logs").insert({
        actor_user_id: me?.id || null, // لو ما عندك id في currentUser لا تقلق، بيكون null
        action,
        entity,
        entity_id: entityId ? String(entityId) : null,
        detail: detail || {},
      });
    } catch (e) {
      // لا نوقف النظام على audit
      console.warn("audit failed", e);
    }
  }

  // ========= Load Settings from Supabase =========
  const loadSettings = async () => {
    const { data, error } = await supabase.from("settings").select("*").limit(1).maybeSingle();
    if (!error && data) {
      setSettings((prev) => ({
        ...prev,
        id: data.id,
        company_name: data.company_name ?? "",
        company_name_en: data.company_name_en ?? prev.company_name_en,
        logo_base64: data.logo_base64 ?? "",
        logo_url: data.logo_url ?? "",
        phone: data.phone ?? "",
        address: data.address ?? "",
        currency: data.currency ?? prev.currency,
        language: data.language ?? prev.language,
        default_price_per_gb: safeNum(data.default_price_per_gb),
        low_stock_threshold: typeof data.low_stock_threshold === "number" ? data.low_stock_threshold : prev.low_stock_threshold,
        reset_secret: data.reset_secret ?? prev.reset_secret,
      }));
    } else {
      // لو ما في صف settings، نترك الافتراضي
      console.warn("settings load error", error);
    }
  };

  // ========= Load Users from Supabase =========
  const loadUsers = async () => {
    if (!canSeeAdmin) return;
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, username, role, perms, is_active, login_count, last_login_at, created_at")
        .order("created_at", { ascending: true });

      if (error) throw error;
      setUsers(data || []);
    } catch (e) {
      console.error(e);
      alert("فشل تحميل المستخدمين من Supabase");
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (tab === "users") loadUsers();
  }, [tab]); // eslint-disable-line

  // ========= Handlers =========
  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings((prev) => ({ ...prev, [name]: value }));
  };

  const handleLogoUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result || "");
      // نخزنها في logo_url كـ dataURL (كما كان عندك)
      setSettings((prev) => ({ ...prev, logo_url: b64 }));
    };
    reader.readAsDataURL(f);
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);

    const payload = {
      company_name: settings.company_name,
      company_name_en: settings.company_name_en,
      logo_base64: settings.logo_base64 || "",
      logo_url: settings.logo_url || "",
      phone: settings.phone || "",
      address: settings.address || "",
      currency: settings.currency || "YER",
      language: settings.language || "ar",
      default_price_per_gb: safeNum(settings.default_price_per_gb),
      low_stock_threshold: safeNum(settings.low_stock_threshold),
      reset_secret: String(settings.reset_secret || "1234"),
    };

    try {
      if (settings.id) {
        const { error } = await supabase.from("settings").update(payload).eq("id", settings.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("settings").insert(payload).select().single();
        if (error) throw error;
        if (data?.id) setSettings((prev) => ({ ...prev, id: data.id }));
      }

      await writeAudit("SETTINGS_UPDATE", "settings", settings.id || "settings", { payload_keys: Object.keys(payload) });
      alert("✅ تم حفظ الإعدادات (Supabase)");
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء حفظ الإعدادات. تأكد من جدول settings و الأعمدة.");
    } finally {
      setSaving(false);
    }
  };

  // ========= Users management (Supabase) =========
  function startAddUser() {
    setEditingId(null);
    setUserForm({
      id: "",
      username: "",
      password: "",
      role: "Seller",
      is_active: true,
      perms: {
        view_stock: true,
        create_invoices: true,
        edit_delete: false,
        view_reports: false,
        view_settings: false,
      },
    });
  }

  function startEditUser(u) {
    setEditingId(u.id);
    setUserForm({
      id: u.id,
      username: u.username,
      password: "",
      role: u.role,
      is_active: !!u.is_active,
      perms: u.perms || {},
    });
  }

  function togglePerm(key) {
    setUserForm((prev) => ({
      ...prev,
      perms: { ...(prev.perms || {}), [key]: !prev.perms?.[key] },
    }));
  }

  async function saveUser() {
    if (!canSeeAdmin) return alert("هذه الميزة للمدير فقط");

    const username = String(userForm.username || "").trim();
    if (!username) return alert("اكتب اسم المستخدم");

    // إضافة: لازم كلمة مرور
    if (!editingId && !String(userForm.password || "")) return alert("اكتب كلمة المرور");

    try {
      if (editingId) {
        const patch = {
          username,
          role: userForm.role,
          perms: userForm.perms || {},
          is_active: !!userForm.is_active,
          updated_at: new Date().toISOString(),
        };

        // لو كتب باسورد جديد نحدث hash
        if (String(userForm.password || "").trim()) {
          patch.password_hash = await hashPassword(userForm.password);
        }

        const { error } = await supabase.from("app_users").update(patch).eq("id", editingId);
        if (error) throw error;

        await writeAudit("USER_UPDATE", "app_users", editingId, { username, role: userForm.role });

        alert("✅ تم تحديث المستخدم");
      } else {
        // تحقق من التكرار
        const { data: exists } = await supabase.from("app_users").select("id").eq("username", username).maybeSingle();
        if (exists?.id) return alert("اسم المستخدم موجود بالفعل");

        const password_hash = await hashPassword(userForm.password);

        const insertPayload = {
          username,
          password_hash,
          role: userForm.role,
          perms: userForm.perms || {},
          is_active: !!userForm.is_active,
        };

        const { data, error } = await supabase.from("app_users").insert(insertPayload).select("id").single();
        if (error) throw error;

        await writeAudit("USER_CREATE", "app_users", data?.id, { username, role: userForm.role });

        alert("✅ تم إضافة المستخدم");
      }

      startAddUser();
      await loadUsers();
    } catch (e) {
      console.error(e);
      alert("فشل حفظ المستخدم. تأكد من جدول app_users.");
    }
  }

  async function deleteUser(id) {
    if (!canSeeAdmin) return;
    if (!confirm("حذف المستخدم؟")) return;

    try {
      const { error } = await supabase.from("app_users").delete().eq("id", id);
      if (error) throw error;

      await writeAudit("USER_DELETE", "app_users", id, {});
      await loadUsers();
      alert("✅ تم حذف المستخدم");
    } catch (e) {
      console.error(e);
      alert("فشل حذف المستخدم (قد يكون مرتبط بجلسات/قيود).");
    }
  }

  // ========= Backup / Restore (كما هو مع إضافة app_users) =========
  async function exportJson() {
    if (!canSeeAdmin) return alert("هذه الميزة للمدير فقط");
    setBusyBackup(true);
    try {
      const tables = [
        "customers",
        "card_types",
        "card_stock",
        "card_movements",
        "invoices",
        "invoice_line_items",
        "payments",
        "expenses",
        "settings",
        "app_users",
        "app_user_sessions",
        "app_audit_logs",
      ];

      const out = { meta: { exported_at: new Date().toISOString(), app: "OneNet ERP" }, tables: {} };

      for (const t of tables) {
        const { data, error } = await supabase.from(t).select("*");
        if (error) throw new Error(t + ": " + error.message);
        out.tables[t] = data || [];
      }

      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "onenet_backup.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("فشل التصدير: " + (err?.message || ""));
    } finally {
      setBusyBackup(false);
    }
  }

  async function importJsonFile(file) {
    if (!canSeeAdmin) return alert("هذه الميزة للمدير فقط");
    if (!file) return;

    setBusyBackup(true);
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      const tables = obj?.tables || {};
      if (!tables || typeof tables !== "object") throw new Error("ملف غير صحيح");

      const wantWipe = confirm("سيتم استيراد البيانات. هل تريد حذف البيانات الحالية أولاً؟");

      if (wantWipe) {
        const delOrder = [
          "app_audit_logs",
          "app_user_sessions",
          "app_users",
          "invoice_line_items",
          "payments",
          "invoices",
          "card_movements",
          "card_stock",
          "card_types",
          "expenses",
          "customers",
          "settings",
        ];
        for (const t of delOrder) await supabase.from(t).delete().neq("id", -1);
      }

      const insOrder = [
        "customers",
        "card_types",
        "card_stock",
        "card_movements",
        "invoices",
        "invoice_line_items",
        "payments",
        "expenses",
        "settings",
        "app_users",
        "app_user_sessions",
        "app_audit_logs",
      ];

      for (const t of insOrder) {
        const rows = Array.isArray(tables[t]) ? tables[t] : [];
        if (!rows.length) continue;
        const chunk = 500;
        for (let i = 0; i < rows.length; i += chunk) {
          const part = rows.slice(i, i + chunk);
          const { error } = await supabase.from(t).insert(part);
          if (error) throw new Error(t + ": " + error.message);
        }
      }

      alert("✅ تم الاستيراد بنجاح");
      await loadSettings();
      if (tab === "users") await loadUsers();
    } catch (err) {
      console.error(err);
      alert("فشل الاستيراد: " + (err?.message || ""));
    } finally {
      setBusyBackup(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function resetAll() {
    if (!canSeeAdmin) return alert("هذه الميزة للمدير فقط");
    if (String(resetCode || "").trim() !== String(settings.reset_secret || "").trim()) return alert("رمز الحذف غير صحيح");
    if (!confirm("⚠️ سيتم حذف كل البيانات. متأكد؟")) return;

    setWiping(true);
    try {
      const delOrder = [
        "invoice_line_items",
        "payments",
        "invoices",
        "card_movements",
        "card_stock",
        "card_types",
        "expenses",
        "customers",
      ];
      for (const t of delOrder) await supabase.from(t).delete().neq("id", -1);

      await writeAudit("RESET_ALL", "system", null, { tables: delOrder });
      alert("✅ تم حذف كل البيانات");
    } catch (e) {
      console.error(e);
      alert("فشل الحذف الكلي");
    } finally {
      setWiping(false);
      setResetCode("");
    }
  }

  const lowThresh = safeNum(settings.low_stock_threshold);

  return (
    <div className="page">
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h3 style={{ margin: 0 }}>الإعدادات</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>System • Users • Backup • Reset</span>
        </div>

        <div className="tabs" style={{ display: "flex", gap: 8, padding: "0 16px 12px", flexWrap: "wrap" }}>
          <button className={"btn " + (tab === "system" ? "btn-primary" : "")} onClick={() => setTab("system")} type="button">
            إعدادات النظام
          </button>
          <button
            className={"btn " + (tab === "users" ? "btn-primary" : "")}
            onClick={() => setTab("users")}
            type="button"
            disabled={!canSeeAdmin}
          >
            إدارة المستخدمين
          </button>
          <button
            className={"btn " + (tab === "backup" ? "btn-primary" : "")}
            onClick={() => setTab("backup")}
            type="button"
            disabled={!canSeeAdmin}
          >
            النسخ الاحتياطي
          </button>
          <button
            className={"btn danger " + (tab === "reset" ? "btn-primary" : "")}
            onClick={() => setTab("reset")}
            type="button"
            disabled={!canSeeAdmin}
          >
            حذف شامل
          </button>
        </div>
      </div>

      {tab === "system" && (
        <div className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>إعدادات النظام</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>كلها من Supabase</span>
          </div>

          <form onSubmit={saveSettings} style={{ padding: 16 }}>
            <div className="grid" style={{ display: "grid", gap: 12 }}>
              <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div className="col" style={{ flex: "1 1 240px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>اسم الشبكة (عربي)</label>
                  <input className="input" name="company_name" value={settings.company_name} onChange={handleChange} />
                </div>
                <div className="col" style={{ flex: "1 1 240px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>اسم الشبكة (English)</label>
                  <input className="input" name="company_name_en" value={settings.company_name_en} onChange={handleChange} />
                </div>
                <div className="col" style={{ flex: "1 1 220px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>الهاتف</label>
                  <input className="input" name="phone" value={settings.phone} onChange={handleChange} />
                </div>
                <div className="col" style={{ flex: "1 1 240px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>العنوان</label>
                  <input className="input" name="address" value={settings.address} onChange={handleChange} />
                </div>
              </div>

              <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div className="col" style={{ flex: "1 1 320px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>الشعار (Base64 أو رابط)</label>
                  <input className="input" name="logo_url" value={settings.logo_url} onChange={handleChange} placeholder="DataURL أو رابط" />
                  <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <input type="file" accept="image/*" onChange={handleLogoUpload} />
                    {settings.logo_url && <img src={settings.logo_url} alt="logo" style={{ height: 36, borderRadius: 8 }} />}
                  </div>
                </div>

                <div className="col" style={{ flex: "0 0 210px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>سعر الجيجا الافتراضي</label>
                  <input className="input" type="number" name="default_price_per_gb" value={settings.default_price_per_gb} onChange={handleChange} />
                </div>

                <div className="col" style={{ flex: "0 0 220px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>حد تنبيه نفاد المخزون</label>
                  <input className="input" type="number" name="low_stock_threshold" min={0} value={settings.low_stock_threshold} onChange={handleChange} />
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>التنبيه يظهر إذا الرصيد ≤ {lowThresh}</div>
                </div>
              </div>

              <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div className="col" style={{ flex: "0 0 200px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>العملة</label>
                  <select className="input" name="currency" value={settings.currency} onChange={handleChange}>
                    <option value="SAR">SAR</option>
                    <option value="YER">YER</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="col" style={{ flex: "0 0 200px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>اللغة</label>
                  <select className="input" name="language" value={settings.language} onChange={handleChange}>
                    <option value="ar">عربي</option>
                    <option value="en">English</option>
                  </select>
                </div>

                <div className="col" style={{ flex: "0 0 240px" }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>رمز الحذف الشامل</label>
                  <input className="input" name="reset_secret" value={settings.reset_secret} onChange={handleChange} />
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                <button className="btn-primary" type="submit" disabled={saving}>
                  {saving ? "جارِ الحفظ..." : "حفظ الإعدادات"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {tab === "users" && (
        <div className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>إدارة المستخدمين (Supabase)</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Admin / Seller / Viewer + tracking</span>
          </div>

          <div style={{ padding: 16 }}>
            {!canSeeAdmin ? (
              <div className="muted">هذه الصفحة للمدير فقط</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                  <button className="btn-primary" type="button" onClick={startAddUser}>
                    إضافة مستخدم
                  </button>
                  <button className="btn" type="button" onClick={loadUsers} disabled={loadingUsers}>
                    {loadingUsers ? "تحميل..." : "تحديث القائمة"}
                  </button>
                </div>

                <div className="card" style={{ marginBottom: 14 }}>
                  <div className="card-head">
                    <h3 style={{ margin: 0 }}>{editingId ? "تعديل مستخدم" : "مستخدم جديد"}</h3>
                    <span style={{ fontSize: 12, color: "var(--muted)" }} />
                  </div>

                  <div style={{ padding: 16, display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input
                        className="input"
                        style={{ flex: "1 1 220px" }}
                        placeholder="اسم المستخدم"
                        value={userForm.username}
                        onChange={(e) => setUserForm((f) => ({ ...f, username: e.target.value }))}
                      />
                      <input
                        className="input"
                        style={{ flex: "1 1 220px" }}
                        placeholder={editingId ? "كلمة المرور (اختياري)" : "كلمة المرور"}
                        type="password"
                        value={userForm.password}
                        onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
                      />
                      <select className="input" style={{ flex: "0 0 180px" }} value={userForm.role} onChange={(e) => setUserForm((f) => ({ ...f, role: e.target.value }))}>
                        {roleOptions.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <label className="pill">
                        <input type="checkbox" checked={!!userForm.is_active} onChange={(e) => setUserForm((f) => ({ ...f, is_active: e.target.checked }))} /> فعال
                      </label>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <label className="pill">
                        <input type="checkbox" checked={!!userForm.perms?.view_stock} onChange={() => togglePerm("view_stock")} /> رؤية المخزون
                      </label>
                      <label className="pill">
                        <input type="checkbox" checked={!!userForm.perms?.create_invoices} onChange={() => togglePerm("create_invoices")} /> إنشاء فواتير
                      </label>
                      <label className="pill">
                        <input type="checkbox" checked={!!userForm.perms?.edit_delete} onChange={() => togglePerm("edit_delete")} /> تعديل/حذف
                      </label>
                      <label className="pill">
                        <input type="checkbox" checked={!!userForm.perms?.view_reports} onChange={() => togglePerm("view_reports")} /> رؤية التقارير
                      </label>
                      <label className="pill">
                        <input type="checkbox" checked={!!userForm.perms?.view_settings} onChange={() => togglePerm("view_settings")} /> رؤية الإعدادات
                      </label>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn-primary" type="button" onClick={saveUser}>
                        حفظ
                      </button>
                      {editingId && (
                        <button className="btn" type="button" onClick={startAddUser}>
                          إلغاء
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>المستخدم</th>
                        <th>الصلاحية</th>
                        <th>الحالة</th>
                        <th>عدد الدخول</th>
                        <th>آخر دخول</th>
                        <th>الصلاحيات</th>
                        <th>إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u, idx) => (
                        <tr key={u.id}>
                          <td>{idx + 1}</td>
                          <td>{u.username}</td>
                          <td>{u.role}</td>
                          <td style={{ fontSize: 12, color: "var(--muted)" }}>{u.is_active ? "فعال" : "موقوف"}</td>
                          <td>{safeNum(u.login_count)}</td>
                          <td style={{ fontSize: 12, color: "var(--muted)" }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "-"}</td>
                          <td style={{ fontSize: 12, color: "var(--muted)" }}>
                            {u.perms?.view_stock ? "مخزون " : ""}
                            {u.perms?.create_invoices ? "فواتير " : ""}
                            {u.perms?.edit_delete ? "تعديل " : ""}
                            {u.perms?.view_reports ? "تقارير " : ""}
                            {u.perms?.view_settings ? "إعدادات " : ""}
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button className="btn" type="button" onClick={() => startEditUser(u)}>
                                تعديل
                              </button>
                              <button className="btn danger" type="button" onClick={() => deleteUser(u.id)}>
                                حذف
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!users.length && (
                        <tr>
                          <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)" }}>
                            لا يوجد مستخدمين
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "backup" && (
        <div className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>النسخ الاحتياطي</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Export / Restore JSON</span>
          </div>

          <div style={{ padding: 16, display: "grid", gap: 14 }}>
            {!canSeeAdmin ? (
              <div className="muted">هذه الصفحة للمدير فقط</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn-primary" type="button" onClick={exportJson} disabled={busyBackup}>
                    {busyBackup ? "جارِ التصدير..." : "تصدير JSON"}
                  </button>
                </div>

                <div className="card">
                  <div className="card-head">
                    <h3 style={{ margin: 0 }}>استيراد (Restore)</h3>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>ملف onenet_backup.json</span>
                  </div>
                  <div style={{ padding: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <input ref={fileRef} type="file" accept="application/json" onChange={(e) => importJsonFile(e.target.files?.[0])} />
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>إذا اخترت “حذف البيانات أولاً” سيتم تنظيف الجداول ثم إدخال الملف.</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "reset" && (
        <div className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>حذف جميع البيانات</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Admin + Secret Code (from Supabase)</span>
          </div>

          <div style={{ padding: 16 }}>
            {!canSeeAdmin ? (
              <div className="muted">هذه الصفحة للمدير فقط</div>
            ) : (
              <div className="card" style={{ border: "1px solid rgba(176,0,32,.25)" }}>
                <div className="card-head">
                  <h3 style={{ margin: 0, color: "#b00020" }}>تحذير</h3>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>لا يمكن التراجع</span>
                </div>
                <div style={{ padding: 16, display: "grid", gap: 10 }}>
                  <div>أدخل رمز الحذف الشامل (محفوظ في settings داخل Supabase).</div>
                  <input className="input" placeholder="أدخل الرمز السري للحذف" value={resetCode} onChange={(e) => setResetCode(e.target.value)} />
                  <button className="btn-primary danger" type="button" onClick={resetAll} disabled={wiping}>
                    {wiping ? "جارِ الحذف..." : "حذف كل البيانات الآن"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
