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
  // عدّل هذا حسب منطقك الحالي إن كنت مسويه سابقاً
  // هنا مثال بسيط: إذا ما في user ممنوع كل شيء إلا الصفحة الرئيسية (لو تبغى)
  if (!user) return true; // أو false حسب تصميمك
  return true;
}

export async function login(username, password) {
  const u = String(username || "").trim();
  const p = String(password || "");
  if (!u || !p) return { ok: false, code: "missing", error: "أدخل اسم المستخدم وكلمة المرور" };

  // 1) حاول تسجيل الدخول عبر RPC
  const { data, error } = await supabase.rpc("app_login", {
    p_username: u,
    p_password: p,
  });

  if (error) {
    // خطأ تقني
    return { ok: false, code: "rpc_error", error: "تعذر تسجيل الدخول (خطأ في الاتصال/الخادم)" };
  }

  const user = Array.isArray(data) ? data[0] : data;
  if (!user) {
    // 2) لتفريق “مستخدم غير موجود” عن “كلمة مرور خاطئة”
    const { data: exData, error: exErr } = await supabase.rpc("app_user_exists", { p_username: u });
    if (!exErr && exData === true) {
      return { ok: false, code: "wrong_password", error: "كلمة المرور غير صحيحة" };
    }
    return { ok: false, code: "not_found", error: "المستخدم غير موجود" };
  }

  const sess = {
    ...user,
    login_at: new Date().toISOString(),
  };

  localStorage.setItem(LS_KEY, JSON.stringify(sess));

  // 3) تسجيل جلسة دخول (لو RPC موجود)
  try {
    await supabase.rpc("app_log_session", {
      p_user_id: sess.id,
      p_username: sess.username,
      p_role: sess.role,
      p_user_agent: navigator.userAgent,
      p_source: "web",
    });
  } catch {}

  return { ok: true, user: sess };
}

export function logout() {
  localStorage.removeItem(LS_KEY);
}
