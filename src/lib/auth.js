// src/lib/auth.js
import { supabase } from "./supabaseClient";

/**
 * Local session user (for UI + perms)
 */

const LS_USER = "onenet_session_user_v1";
const LS_REMEMBER = "onenet_login_remember_v1";
const LS_USERS = "onenet_app_users_v1"; // optional local cache for Settings users page

export function setSessionUser(user) {
  try {
    if (!user) {
      localStorage.removeItem(LS_USER);
    } else {
      localStorage.setItem(LS_USER, JSON.stringify(user));
    }
  } finally {
    // ✅ notify UI to refresh permissions immediately (same tab)
    try {
      window.dispatchEvent(new Event("session_user_changed"));
    } catch {}
  }
}

export const setCurrentUser = setSessionUser; // backward-compatible alias

export function currentUser() {
  try {
    const raw = localStorage.getItem(LS_USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function rememberedEmail() {
  try {
    const raw = localStorage.getItem(LS_REMEMBER);
    return raw || "";
  } catch {
    return "";
  }
}

export function setRememberedEmail(v) {
  try {
    if (!v) localStorage.removeItem(LS_REMEMBER);
    else localStorage.setItem(LS_REMEMBER, String(v));
  } catch {}
}

export async function logout() {
  setSessionUser(null);
  try {
    await supabase.auth.signOut();
  } catch {}
  return { ok: true };
}

// ---------- Permissions helpers ----------
export function effectivePerms(user) {
  const ALL_KEYS = [
    "dashboard",
    "customers",
    "invoices",
    "payments",
    "expenses",
    "ledger",
    "stock",
    "reports",
    "users",
    "settings",
  ];

  const u = user || {};
  const role = String(u.role || "").toLowerCase();
  const username = String(u.username || "").toLowerCase();

  // Base map (all false)
  const base = {};
  ALL_KEYS.forEach((k) => (base[k] = false));

  // ✅ Admin / Super admin / Owner => everything
  if (role === "owner" || role === "admin" || role === "super_admin" || username === "admin") {
    const all = {};
    ALL_KEYS.forEach((k) => (all[k] = true));
    return all;
  }

  // ---- Read perms from DB/session ----
  let rawPerms = null;

  // perms as ARRAY: supports ["*"] or explicit keys
  if (Array.isArray(u.perms)) {
    const arr = u.perms.map((x) => String(x).toLowerCase());
    if (arr.includes("*") || arr.includes("all")) {
      const all = {};
      ALL_KEYS.forEach((k) => (all[k] = true));
      return all;
    }
    rawPerms = {};
    arr.forEach((k) => {
      if (ALL_KEYS.includes(k)) rawPerms[k] = true;
      // alias support
      if (k === "report" || k === "reports") rawPerms.reports = true;
    });
  }

  // perms as OBJECT: {dashboard:true, ...}
  if (!rawPerms && u.perms && typeof u.perms === "object") {
    rawPerms = u.perms;
  }

  // If no perms provided => keep base (all false)
  if (!rawPerms) return base;

  // Normalize: only known keys, coerce to boolean
  const norm = { ...base };
  ALL_KEYS.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(rawPerms, k)) {
      norm[k] = !!rawPerms[k];
    }
  });

  // ✅ Alias: some UIs store "reports" while the app route/menu uses "ledger"
  if (!!rawPerms.reports && !Object.prototype.hasOwnProperty.call(rawPerms, "ledger")) {
    norm.ledger = true;
  }
  if (!!rawPerms.ledger && !Object.prototype.hasOwnProperty.call(rawPerms, "reports")) {
    norm.reports = true;
  }

  return norm;
}


export function canAccessPath(path, user) {
  const p = String(path || "/").toLowerCase();
  const perms = effectivePerms(user);

  if (p === "/login") return true;
  if (!user) return false;

  if (p.startsWith("/dashboard")) return !!perms.dashboard;
  if (p.startsWith("/customers")) return !!perms.customers;
  if (p.startsWith("/invoices")) return !!perms.invoices;
  if (p.startsWith("/payments")) return !!perms.payments;
  if (p.startsWith("/expenses")) return !!perms.expenses;
  if (p.startsWith("/ledger")) return !!perms.ledger;
  if (p.startsWith("/stock")) return !!perms.stock;
  if (p.startsWith("/users")) return !!perms.users;
  if (p.startsWith("/settings")) return !!perms.settings;

  return true;
}

// ---------- Users storage for Settings page ----------
export function getUsers() {
  try {
    const raw = localStorage.getItem(LS_USERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveUsers(list) {
  try {
    localStorage.setItem(LS_USERS, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {}
}

async function logLogin(userId) {
  try {
    await supabase.from("login_logs").insert({
      user_id: userId || null,
      created_at: new Date().toISOString(),
    });
  } catch {}
}

export async function loginWithEmail(email, password, remember = true) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session) return { ok: false, error: error?.message || "فشل تسجيل الدخول" };

  const uiUser = {
    id: data.user?.id || null,
    email: data.user?.email || email,
    username: null,
    role: "admin",
    perms: {},
  };

  setSessionUser(uiUser);
  if (remember) setRememberedEmail(email);
  else setRememberedEmail("");

  await logLogin(uiUser.id);
  return { ok: true, user: uiUser };
}

// ✅ هنا التعديل: app_login2 + دعم TABLE return
export async function loginWithUsername(username, password, remember = true) {
  try {
    const { data, error } = await supabase.rpc("app_login2", {
  p_username: username,
  p_password: password,
});

    if (error) return { ok: false, error: error.message || "فشل تسجيل الدخول" };

    // data ممكن تكون:
    // 1) array rows (TABLE return)
    // 2) single row
    // 3) {ok,user}
    const row =
      (Array.isArray(data) ? data[0] : null) ||
      (data?.user ? data.user : null) ||
      (data && typeof data === "object" ? data : null);

    if (!row?.id) {
      return { ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
    }

    const uiUser = {
      id: row.id,
      email: row.email || null,
      username: row.username || username,
      role: String(row.role || "viewer").toLowerCase(),
      perms: row.perms ?? null,
    };

    setSessionUser(uiUser);
    if (remember) setRememberedEmail(username);
    else setRememberedEmail("");

    await logLogin(uiUser.id);
    return { ok: true, user: uiUser };
  } catch (e) {
    return { ok: false, error: String(e?.message || e || "فشل تسجيل الدخول") };
  }
}

export async function login(userOrEmail, password, remember = true) {
  const v = String(userOrEmail || "").trim();
  if (!v || !password) return { ok: false, error: "أدخل البيانات" };

  if (v.includes("@")) return loginWithEmail(v, password, remember);
  return loginWithUsername(v, password, remember);
}
