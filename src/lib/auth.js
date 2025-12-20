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

export function effectivePerms(user) {
  return user?.perms || {};
}

export function canAccessPath(user, pathname) {
  // حسب نظامك، خليها true مؤقتًا
  return true;
}

export async function login(username, password) {
  const u = String(username || "").trim();
  const p = String(password || "");
  if (!u || !p) return { ok: false, error: "أدخل اسم المستخدم وكلمة المرور" };

  const { data, error } = await supabase.rpc("app_login", {
    p_username: u,
    p_password: p,
  });

  if (error) return { ok: false, error: "تعذر تسجيل الدخول (خطأ اتصال)" };

  const user = Array.isArray(data) ? data[0] : data;
  if (!user) return { ok: false, error: "بيانات الدخول غير صحيحة" };

  const sess = { ...user, login_at: new Date().toISOString() };
  localStorage.setItem(LS_KEY, JSON.stringify(sess));
  return { ok: true, user: sess };
}

export function logout() {
  localStorage.removeItem(LS_KEY);
}
