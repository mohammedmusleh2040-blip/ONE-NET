// src/components/Layout.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {canAccessPath, currentUser, logout, effectivePerms, setSessionUser } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";

function Icon({ name }) {
  const map = {
    home: "🏠",
    users: "👥",
    file: "🧾",
    card: "💳",
    cashflow: "💰",
    chart: "📊",
    box: "📦",
    lock: "🔐",
    settings: "⚙️",
  };
  return (
    <span style={{ width: 24, display: "inline-flex", justifyContent: "center", opacity: 0.95 }}>
      {map[name] || "•"}
    </span>
  );
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [sessUser, setSessUser] = useState(() => currentUser());
  const [brand, setBrand] = useState({ name: "ONE NET ERP", logo: "" });

  useEffect(() => {
    setSessUser(currentUser());
  }, [location.pathname]);
  // ✅ Refresh sidebar permissions immediately when user perms change (same tab / other tabs)
  useEffect(() => {
    const onChanged = () => setSessUser(currentUser());
    window.addEventListener("session_user_changed", onChanged);
    window.addEventListener("storage", (e) => {
      if (e.key === "onenet_session_user_v1") onChanged();
    });
    return () => {
      window.removeEventListener("session_user_changed", onChanged);
    };
  }, []);

  // ✅ Optional: live permissions updates from DB (requires Realtime enabled on public.app_users)
  useEffect(() => {
    if (!sessUser?.id) return;
    let channel;
    try {
      channel = supabase
        .channel("app_users_perm_watch_" + sessUser.id)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "app_users", filter: `id=eq.${sessUser.id}` },
          (payload) => {
            const nu = payload?.new || {};
            const merged = { ...currentUser(), ...nu };
            setSessionUser(merged);
            setSessUser(merged);
          }
        )
        .subscribe();
    } catch {}
    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {}
    };
  }, [sessUser?.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.from("settings").select("*").limit(1).maybeSingle();
        if (error || !alive) return;
        const name = data?.company_name || "ONE NET ERP";
        const logo = data?.logo_base64 || "";
        setBrand({ name, logo });
      } catch (e) {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);


  const perms = useMemo(() => effectivePerms(sessUser), [sessUser]);

  // If not logged in -> go login
  useEffect(() => {
    if (location.pathname === "/login") return;

    const u = currentUser();
    if (!u) {
      navigate("/login", { replace: true });
      return;
    }

    // Route guard
    if (!canAccessPath(location.pathname, u)) {
      navigate("/dashboard", { replace: true });
    }
  }, [location.pathname, navigate]);

  async function doLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const items = [
    { to: "/dashboard", label: "الرئيسية", icon: "home", show: !!perms.dashboard },
    { to: "/customers", label: "العملاء", icon: "users", show: !!perms.customers },
    { to: "/invoices", label: "الفواتير", icon: "file", show: !!perms.invoices },
    { to: "/payments", label: "السندات", icon: "card", show: !!perms.payments },
    { to: "/expenses", label: "المصروفات", icon: "cashflow", show: !!perms.expenses },
    { to: "/ledger", label: "التقارير", icon: "chart", show: !!perms.ledger },
    { to: "/stock", label: "المخزون", icon: "box", show: !!perms.stock },
    { to: "/vendors", label: "عهدة الباعة", icon: "box", show: (!!perms.stock || !!perms.users) },
    { to: "/users", label: "المستخدمين", icon: "lock", show: !!perms.users },
    { to: "/settings", label: "الإعدادات", icon: "settings", show: !!perms.settings },
  ];

  // On login page: render outlet only
  if (location.pathname === "/login") return <Outlet />;

  return (
    <div style={{ display: "flex", minHeight: "100vh", direction: "rtl", fontFamily: "Arial" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 260,
          background: "#0f172a",
          color: "#fff",
          padding: 14,
        }}
      >
        <div style={{ fontWeight: "bold", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
          {brand.logo ? (
            <img
              src={brand.logo}
              alt="logo"
              style={{ width: 34, height: 34, borderRadius: 10, objectFit: "cover" }}
            />
          ) : null}
          <span>{brand.name}</span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 14 }}>
          {sessUser?.username || sessUser?.email || "—"}
        </div>

        <nav style={{ display: "grid", gap: 6 }}>
          {items
            .filter((x) => x.show)
            .map((it) => {
              const active = location.pathname.startsWith(it.to);
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  style={{
                    textDecoration: "none",
                    color: "#fff",
                    padding: "10px 10px",
                    borderRadius: 10,
                    background: active ? "rgba(255,255,255,.12)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Icon name={it.icon} />
                  <span>{it.label}</span>
                </Link>
              );
            })}
        </nav>

        <button
          onClick={doLogout}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,.2)",
            background: "transparent",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          تسجيل خروج
        </button>
      </aside>

      {/* Content */}
      <main style={{ flex: 1, padding: 18, background: "#f3f4f6" }}>
        <Outlet />
      </main>
    </div>
  );
}
