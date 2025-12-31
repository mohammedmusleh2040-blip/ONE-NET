import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { setCurrentUser, rememberedEmail, setRememberedEmail } from "../lib/auth";

export default function Login() {
  const nav = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [remember, setRemember] = useState(true);
  const [showPass, setShowPass] = useState(false);

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const re = rememberedEmail();
    if (re) setUsername(re);
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setMsg("");
    setLoading(true);

    const { data, error } = await supabase.rpc("app_login", {
  p_username: username,
  p_password: password,
});


    setLoading(false);

    if (error) {
      setMsg("خطأ في الاتصال");
      return;
    }

    // app_login2 يرجع TABLE => array rows
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id) {
      setMsg("بيانات الدخول غير صحيحة");
      return;
    }

    setCurrentUser(row);

    if (remember) setRememberedEmail(username.trim());
    else setRememberedEmail("");

    nav("/dashboard", { replace: true });
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <form
        onSubmit={onSubmit}
        style={{
          width: 420,
          maxWidth: "95vw",
          background: "#fff",
          borderRadius: 18,
          padding: 26,
          boxShadow: "0 10px 30px rgba(0,0,0,.08)",
          direction: "rtl",
          fontFamily: "Arial",
        }}
      >
        <h2 style={{ margin: "0 0 6px", textAlign: "center" }}>تسجيل الدخول</h2>
        <div style={{ marginBottom: 18, color: "#666", textAlign: "center", fontSize: 13 }}>
          ادخل اسم المستخدم أو الإيميل وكلمة المرور
        </div>

        <label style={{ display: "block", marginBottom: 6 }}>اسم المستخدم</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="example@mail.com أو username"
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            marginBottom: 14,
          }}
        />

        <label style={{ display: "block", marginBottom: 6 }}>كلمة المرور</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            type={showPass ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          />
          <button
            type="button"
            onClick={() => setShowPass((s) => !s)}
            style={{
              padding: "0 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#f7f7f7",
              cursor: "pointer",
            }}
          >
            {showPass ? "إخفاء" : "إظهار"}
          </button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          تذكرني
        </label>

        {msg && <div style={{ color: "#c0392b", marginBottom: 10 }}>{msg}</div>}

        <button
          disabled={loading}
          type="submit"
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 12,
            border: "none",
            background: "#17a34a",
            color: "#fff",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          {loading ? "جاري الدخول..." : "دخول"}
        </button>
      </form>
    </div>
  );
}
  async function writeLoginLog(userId) {
    if (!userId) return;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const iso = new Date().toISOString();

    // schema may have logged_at or logged_at
    const tryPayloads = [
      { user_id: userId, logged_at: iso, user_agent: ua },
      { user_id: userId, logged_at: iso, user_agent: ua },
    ];

    for (const payload of tryPayloads) {
      const { error } = await supabase.from("login_logs").insert(payload);
      if (!error) return;
      // if column missing, try next
      if (String(error?.code || "") !== "42703") {
        // other errors (RLS etc.) stop
        console.warn("login_logs insert failed", error);
        return;
      }
    }
  }


