// src/lib/auth.js
import { supabase } from "./supabaseClient";

// ====== Local fallback (لو Supabase غير جاهز) ======
const LS_USERS = "onenet_users_v1";
const LS_SESSION = "onenet_session_v1";

function safeParse(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}

function normalizeUser(u) {
  return {
    id: u?.id ?? null,
    username: String(u?.username || "").trim(),
    password: String(u?.password || ""), // (حالياً plaintext مثل نظامك)
    role: u?.role || "Seller",
    perms: u?.perms && typeof u.perms === "object" ? u.perms : {},
  };
}

// ====== Users (Supabase first) ======
export async function getUsersAsync() {
  // try supabase
  try {
    const { data, error } = await supabase.from("app_users").select("*").order("username");
    if (!error && Array.isArray(data)) return data.map(normalizeUser);
  } catch {}
  // fallback local
  const local = safeParse(localStorage.getItem(LS_USERS) || "[]", []);
  return Array.isArray(local) ? local.map(normalizeUser) : [];
}

// sync version (for existing code)
export function getUsers() {
  const local = safeParse(localStorage.getItem(LS_USERS) || "[]", []);
  return Array.isArray(local) ? local.map(normalizeUser) : [];
}

// save local + best-effort supabase upsert
export function saveUsers(users) {
  const arr = Array.isArray(users) ? users.map(normalizeUser) : [];
  localStorage.setItem(LS_USERS, JSON.stringify(arr));

  // best-effort: upsert to supabase (لا نكسر UI لو فشل)
  (async () => {
    try {
      // upsert by username (لازم تعمل unique على username في الجدول)
      const payload = arr.map((u) => ({
        username: u.username,
        password: u.password,
        role: u.role,
        perms: u.perms || {},
      }));
      await supabase.from("app_users").upsert(payload, { onConflict: "username" });
    } catch {}
  })();
}

// ====== Session ======
export function currentUser() {
  const raw = localStorage.getItem(LS_SESSION);
  const u = raw ? safeParse(raw, null) : null;
  return u ? normalizeUser(u) : null;
}

export function logout() {
  localStorage.removeItem(LS_SESSION);
}

// ====== Login (Supabase first) ======
export async function loginAsync(username, password) {
  const uName = String(username || "").trim();
  const pass = String(password || "");

  if (!uName || !pass) return { ok: false, error: "أدخل اسم المستخدم وكلمة المرور" };

  // 1) Supabase users
  try {
    const { data, error } = await supabase
      .from("app_users")
      .select("*")
      .eq("username", uName)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      if (String(data.password || "") !== pass) {
        await logAuthEvent(uName, "login_failed");
        return { ok: false, error: "بيانات الدخول غير صحيحة" };
      }
      const user = normalizeUser(data);
      localStorage.setItem(LS_SESSION, JSON.stringify(user));
      await logAuthEvent(uName, "login_success");
      return { ok: true, user };
    }
  } catch {}

  // 2) Fallback local users
  const localUsers = getUsers();
  const found = localUsers.find((x) => x.username === uName);
  if (!found) {
    await logAuthEvent(uName, "login_failed");
    return { ok: false, error: "المستخدم غير موجود" };
  }
  if (String(found.password || "") !== pass) {
    await logAuthEvent(uName, "login_failed");
    return { ok: false, error: "بيانات الدخول غير صحيحة" };
  }
  localStorage.setItem(LS_SESSION, JSON.stringify(found));
  await logAuthEvent(uName, "login_success");
  return { ok: true, user: found };
}

// Sync wrapper (لو في مكان قديم يستخدم login())
export function login(username, password) {
  // هذا فقط للرجوع للخلف (لا يعتمد عليه للجوال)
  const users = getUsers();
  const uName = String(username || "").trim();
  const pass = String(password || "");
  const found = users.find((x) => x.username === uName);
  if (!found) return { ok: false, error: "المستخدم غير موجود" };
  if (String(found.password || "") !== pass) return { ok: false, error: "بيانات الدخول غير صحيحة" };
  localStorage.setItem(LS_SESSION, JSON.stringify(found));
  return { ok: true, user: found };
}

// ====== Permissions ======
export function effectivePerms(user) {
  const role = user?.role || "Seller";
  const p = user?.perms || {};
  if (role === "Admin") {
    return {
      view_stock: true,
      view_reports: true,
      view_settings: true,
      create_invoice: true,
      edit_delete: true,
      ...p,
    };
  }
  return {
    view_stock: !!p.view_stock,
    view_reports: !!p.view_reports,
    view_settings: !!p.view_settings,
    create_invoice: !!p.create_invoice,
    edit_delete: !!p.edit_delete,
  };
}

export function canAccessPath(user, path) {
  const perms = effectivePerms(user);
  const p = String(path || "");
  if (p.startsWith("/settings")) return !!perms.view_settings || user?.role === "Admin";
  if (p.startsWith("/ledger")) return !!perms.view_reports || user?.role === "Admin";
  if (p.startsWith("/stock")) return !!perms.view_stock || user?.role === "Admin";
  return true;
}

// ====== Audit / Tracking ======
export async function logAuthEvent(username, action) {
  try {
    await supabase.from("user_audit").insert([
      { username: String(username || ""), action: String(action || ""), at: new Date().toISOString() },
    ]);
  } catch {}
}
