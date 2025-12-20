// src/lib/auth.js
import { supabase } from "./supabaseClient.js";

const LS_KEY = "onenet_sess_user_v1";

export function currentUser() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem(LS_KEY);
}

export function effectivePerms(user) {
  return user?.perms || {};
}

// لو عندك نظام صلاحيات لاحقاً عدله
export function canAccessPath(user, pathname) {
  return true;
}

/**
 * login:
 * - يميز بين: المستخدم غير موجود / كلمة السر غلط
 * - يحفظ السيشن في localStorage عشان يشتغل بأي متصفح / جهاز
 */
export async function login(username, password) {
  const u = String(username || "").trim();
  const p = String(password || "");
  if (!u || !p) return { ok: false, error: "أدخل اسم المستخدم وكلمة المرور" };

  // 1) تأكد المستخدم موجود
  const { data: urow, error: uerr } = await supabase
    .from("app_users")
    .select("id, username, role, perms")
    .eq("username", u)
    .maybeSingle();

  if (uerr) {
    console.error("app_users error", uerr);
    return { ok: false, error: "تعذر التحقق من المستخدم (قاعدة البيانات)" };
  }
  if (!urow) {
    return { ok: false, error: "المستخدم غير موجود" };
  }

  // 2) تحقق كلمة السر عبر RPC (app_login)
  const { data, error } = await supabase.rpc("app_login", {
    p_username: u,
    p_password: p,
  });

  if (error) {
    console.error("app_login rpc error", error);
    return { ok: false, error: "تعذر تسجيل الدخول (خطأ اتصال)" };
  }

  // إذا رجّع null/empty => كلمة السر غلط
  const user = Array.isArray(data) ? data[0] : data;
  if (!user) {
    return { ok: false, error: "كلمة السر غير صحيحة" };
  }

  // 3) خزّن سيشن
  const sess = { ...user, login_at: new Date().toISOString() };
  localStorage.setItem(LS_KEY, JSON.stringify(sess));

  // 4) سجّل دخول (اختياري) — لو عندك جدول sessions
  try {
    await supabase.from("app_user_sessions").insert([
      {
        user_id: user.id,
        username: user.username,
        action: "login",
        user_agent: navigator.userAgent,
      },
    ]);
  } catch (e) {
    // لا نوقف الدخول لو فشل اللوق
    console.warn("session log insert skipped", e);
  }

  return { ok: true, user: sess };
}
