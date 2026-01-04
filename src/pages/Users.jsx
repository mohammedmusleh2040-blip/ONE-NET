import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { currentUser } from "../lib/auth";

/**
 * Users.jsx (fixed)
 * - RPC payloads match DB function signatures exactly (no extra keys)
 * - Fix deactivateUser (no editId undefined, no app_users_update_v2)
 */

const PERM_DEFS = [
  { key: "dashboard", label: "الرئيسية" },
  { key: "customers", label: "العملاء" },
  { key: "invoices", label: "الفواتير" },
  { key: "invoices_edit", label: "تعديل الفواتير" },
  { key: "invoices_delete", label: "حذف الفواتير" },
  { key: "payments", label: "السندات" },
  { key: "expenses", label: "المصروفات" },
  { key: "reports", label: "التقارير" },
  { key: "stock", label: "المخزون" },
  { key: "users", label: "المستخدمين" },
  { key: "settings", label: "الإعدادات" },
];

function safeJson(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === "object") return v;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function toastText(setMsg, text, kind = "ok") {
  setMsg({ text, kind, t: Date.now() });
  setTimeout(() => setMsg(null), 3500);
}

export default function Users() {
  const actor = useMemo(() => {
    try {
      const u = currentUser?.();
      return u?.id || null;
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const [users, setUsers] = useState([]);
  const [loginInfo, setLoginInfo] = useState({}); // user_id -> {at, ua}

  // form state
  const [editingId, setEditingId] = useState(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState(""); // UI فقط (لن نرسلها للـ RPC لأن الدوال عندك ما تدعم email)
  const [role, setRole] = useState("viewer");
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState("");

  const [perms, setPerms] = useState(() => {
    const obj = {};
    PERM_DEFS.forEach((p) => (obj[p.key] = false));
    obj.dashboard = true;
    obj.customers = true;
    obj.invoices = true;
    obj.payments = true;
    obj.reports = true;
    return obj;
  });

  const [showLogs, setShowLogs] = useState(true);

  const resetForm = () => {
    setEditingId(null);
    setUsername("");
    setEmail("");
    setRole("viewer");
    setIsActive(true);
    setPassword("");
    const obj = {};
    PERM_DEFS.forEach((p) => (obj[p.key] = false));
    obj.dashboard = true;
    obj.customers = true;
    obj.invoices = true;
    obj.payments = true;
    obj.reports = true;
    setPerms(obj);
  };

  const togglePerm = (k) => setPerms((p) => ({ ...p, [k]: !p?.[k] }));

  const loadUsers = async () => {
    setLoading(true);
    try {
      let res = await supabase.rpc("app_users_list");
      if (res?.error) {
        res = await supabase
          .from("app_users")
          .select("id, username, role, is_active, perms, email")
          .order("username", { ascending: true });
      }
      if (res?.error) throw res.error;

      const rows = res?.data || [];
      setUsers(rows);

      await loadLoginInfo(rows.map((r) => r.id).filter(Boolean));
    } catch (e) {
      console.error(e);
      toastText(setMsg, `خطأ تحميل المستخدمين: ${e?.message || e}`, "err");
    } finally {
      setLoading(false);
    }
  };

  const loadLoginInfo = async (userIds) => {
    if (!showLogs) return;
    if (!userIds?.length) return setLoginInfo({});

    const tryCols = ["logged_at", "logged_in_at", "logged_at_ts"];
    for (const col of tryCols) {
      const { data, error } = await supabase
        .from("login_logs")
        .select(`user_id, ${col}, user_agent`)
        .in("user_id", userIds)
        .order(col, { ascending: false })
        .limit(5000);

      if (error) {
        if (String(error?.code) === "42703") continue; // column not found
        console.warn("login_logs load error:", error);
        return;
      }

      const m = {};
      for (const row of data || []) {
        const uid = row.user_id;
        if (!m[uid]) m[uid] = { at: row[col], ua: row.user_agent || "" };
      }
      setLoginInfo(m);
      return;
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLogs]);

  const fillEdit = (u) => {
    setEditingId(u.id);
    setUsername(u.username || "");
    setEmail(u.email || "");
    setRole(u.role || "viewer");
    setIsActive(u.is_active !== false);
    setPassword("");
    const p = safeJson(u.perms, {});
    const obj = {};
    PERM_DEFS.forEach((x) => (obj[x.key] = !!p?.[x.key]));
    setPerms(obj);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveUser = async () => {
    if (!username.trim()) return toastText(setMsg, "اكتب اسم المستخدم", "err");

    // create يحتاج كلمة مرور
    if (!editingId && password.trim().length < 4) {
      return toastText(setMsg, "اكتب كلمة مرور (4 أحرف أو أكثر)", "err");
    }

    setLoading(true);
    try {
      if (!editingId) {
        // ✅ CREATE: مطابق للتوقيع
       const payloadCreate = {
  p_username: username.trim(),
  p_password: password.trim(),
  p_role: role,
  p_is_active: !!isActive,       // ✅ لا تعكسها
  p_perms: perms || {},
  p_email: (email || "").trim() || null,
};


const { data, error } = await supabase
  .rpc("app_user_create", payloadCreate);

if (error) throw error;


        toastText(setMsg, "تم إضافة المستخدم بنجاح ✅", "ok");
        resetForm();
      } else {
        // ✅ UPDATE: مطابق للتوقيع
        const payloadCreate = {
  p_username: username.trim(),
  p_password: password.trim(),
  p_role: role,
  p_perms: perms || {},
  p_email: email?.trim() || null,
  p_is_active: !!isActive,
};


        const r = editingId
  ? await supabase.rpc("app_users_update", {
      p_user_id: editingId,
      p_username: username.trim(),
      p_role: role,
      p_perms: perms || {},
      p_is_active: !!isActive,
      p_email: email?.trim() || null,
    })
  : await supabase.rpc("app_user_create", payloadCreate);

        if (r?.error) throw r.error;

        // ✅ change password (اختياري)
        if (password && password.trim().length >= 4) {
          const r2 = await supabase.rpc("app_users_set_password", {
            p_actor_id: actor,
            p_user_id: editingId,
            p_new_password: password.trim(),
          });
          if (r2?.error) throw r2.error;
          toastText(setMsg, "تم حفظ التعديلات + تغيير كلمة المرور ✅", "ok");
        } else {
          toastText(setMsg, "تم حفظ التعديلات ✅", "ok");
        }

        resetForm();
      }

      await loadUsers();
    } catch (e) {
      console.error(e);
      toastText(setMsg, `خطأ حفظ المستخدم: ${e?.message || e}`, "err");
    } finally {
      setLoading(false);
    }
  };

  const deactivateUser = async (u) => {
    if (!u?.id) return;
    setLoading(true);
    try {
      const payload = {
        p_actor_id: actor,
        p_user_id: u.id,
        p_username: u.username,
        p_role: u.role || "viewer",
        p_is_active: false,
        p_perms: safeJson(u.perms, {}) || {},
      };

      const r = await supabase.rpc("app_users_update", payload);
      if (r?.error) throw r.error;

      toastText(setMsg, "تم إيقاف المستخدم ✅", "ok");
      await loadUsers();
    } catch (e) {
      console.error(e);
      toastText(setMsg, `خطأ: ${e?.message || e}`, "err");
    } finally {
      setLoading(false);
    }
  };

  // ===== Styles =====
  const cardStyle = {
    background: "#f3f4f6",
    borderRadius: 18,
    padding: 14,
    border: "1px solid rgba(0,0,0,0.05)",
    boxShadow: "0 6px 18px rgba(0,0,0,0.06) inset",
  };

  const inputStyle = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    padding: "8px 10px",
    outline: "none",
    background: "white",
  };

  const smallBtn = (active) => ({
    borderRadius: 10,
    border: active ? "1px solid rgba(16,185,129,0.55)" : "1px solid rgba(0,0,0,0.12)",
    padding: "7px 10px",
    background: active ? "rgba(16,185,129,0.14)" : "#fff",
    cursor: "pointer",
    fontSize: 13,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    userSelect: "none",
  });

  const mainBtn = {
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    padding: "10px 14px",
    background: "#e5e7eb",
    cursor: "pointer",
  };

  return (
    <div style={{ padding: 18, direction: "rtl" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <div style={{ width: "min(980px, 100%)" }}>
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>المستخدمين</div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>إضافة/تعديل المستخدمين والصلاحيات</div>
          </div>

          {msg?.text && (
            <div
              style={{
                marginBottom: 10,
                padding: "10px 12px",
                borderRadius: 12,
                background: msg.kind === "err" ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)",
                border: "1px solid rgba(0,0,0,0.08)",
                fontSize: 13,
              }}
            >
              {msg.text}
            </div>
          )}

          <div style={cardStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>اسم المستخدم</div>
                <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="اسم مستخدم" />
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>الإيميل (اختياري)</div>
                <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@mail.com" />
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>كلمة المرور</div>
                <input
                  style={inputStyle}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editingId ? "اتركها فارغة إذا ما تبي تغيرها" : "كلمة مرور"}
                  type="password"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>الدور</div>
                <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="viewer">viewer</option>
                  <option value="viewer">viewer</option>
                  <option value="seller">seller</option>
                  <option value="manager">manager</option>
                  <option value="super_admin">super_admin</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>الحالة</div>
                <select style={inputStyle} value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")}>
                  <option value="1">مُفعّل</option>
                  <option value="0">مُوقّف</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>الصلاحيات:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {PERM_DEFS.map((p) => {
                  const active = !!perms?.[p.key];
                  return (
                    <div key={p.key} style={smallBtn(active)} onClick={() => togglePerm(p.key)} title={p.key}>
                      <span style={{ width: 14, textAlign: "center" }}>{active ? "✓" : ""}</span>
                      <span>{p.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={mainBtn} onClick={loadUsers} disabled={loading}>
                  تحديث
                </button>
                <button style={mainBtn} onClick={resetForm} disabled={loading}>
                  جديد
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ fontSize: 13, opacity: 0.9, display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={showLogs} onChange={(e) => setShowLogs(e.target.checked)} />
                  عرض سجل الدخول
                </label>
                <button
                  style={{
                    ...mainBtn,
                    background: "rgba(16,185,129,0.16)",
                    borderColor: "rgba(16,185,129,0.28)",
                    fontWeight: 700,
                  }}
                  onClick={saveUser}
                  disabled={loading}
                >
                  حفظ
                </button>
              </div>
            </div>
          </div>

          <div style={{ height: 14 }} />

          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>قائمة المستخدمين</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{loading ? "جاري التحميل..." : `${users.length} مستخدم`}</div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "rgba(0,0,0,0.03)" }}>
                    <th style={{ padding: 10, textAlign: "right" }}>المستخدم</th>
                    <th style={{ padding: 10, textAlign: "right" }}>الدور</th>
                    <th style={{ padding: 10, textAlign: "right" }}>آخر دخول</th>
                    <th style={{ padding: 10, textAlign: "right" }}>الحالة</th>
                    <th style={{ padding: 10, textAlign: "right" }}>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const li = loginInfo?.[u.id];
                    const lastAt = li?.at ? new Date(li.at).toLocaleString("ar-SA") : "-";
                    return (
                      <tr key={u.id} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                        <td style={{ padding: 10, fontWeight: 700 }}>{u.username}</td>
                        <td style={{ padding: 10 }}>{u.role || "-"}</td>
                        <td style={{ padding: 10, direction: "ltr" }}>{lastAt}</td>
                        <td style={{ padding: 10 }}>{u.is_active === false ? "موقّف" : "مُفعّل"}</td>
                        <td style={{ padding: 10 }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button style={mainBtn} onClick={() => fillEdit(u)}>
                              تعديل
                            </button>
                            <button style={mainBtn} onClick={() => deactivateUser(u)} disabled={u.is_active === false}>
                              إيقاف
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!users.length && (
                    <tr>
                      <td colSpan={5} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>
                        لا يوجد مستخدمين
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {showLogs && (
              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
                ملاحظة: يتم عرض <b>آخر دخول</b> من جدول login_logs (إذا كان موجود ومفعل).
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
