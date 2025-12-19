import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { canAccessPath, currentUser, loginAsync, logout, effectivePerms } from "../lib/auth.js";
import { supabase } from "../lib/supabaseClient.js";

/** Minimal inline SVG icons (no extra deps) */
function Icon({ name }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    className: "nav-icon-svg",
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path
            d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "box":
      return (
        <svg {...common}>
          <path
            d="M21 8.5 12 3 3 8.5 12 14 21 8.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M3 8.5V16.5L12 22l9-5.5V8.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M12 14v8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <path
            d="M16 11a4 4 0 1 0-8 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M3.5 20a7.5 7.5 0 0 1 17 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M19 8.5a3 3 0 0 1 0 6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity=".6"
          />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path
            d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-6Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M14 2v6h7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M8 13h8M8 17h8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "card":
      return (
        <svg {...common}>
          <path
            d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M3 10h18"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M7 15h4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity=".7"
          />
        </svg>
      );
    case "cashflow":
      return (
        <svg {...common}>
          <path d="M4 5v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path
            d="M7 8h13l-3-3"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7 16h13l-3 3"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M4 20V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path
            d="M8 16v-5M12 16v-9M16 16v-3"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M19.4 15a8 8 0 0 0 .1-1 8 8 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7.2 7.2 0 0 0-1.7-1L15 2h-6l-.4 2.1a7.2 7.2 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 13a8 8 0 0 0-.1 1 8 8 0 0 0 .1 1L2.6 16.5l2 3.4 2.3-1a7.2 7.2 0 0 0 1.7 1L9 22h6l.4-2.1a7.2 7.2 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            opacity=".95"
          />
        </svg>
      );
    default:
      return null;
  }
}

const navItems = [
  { to: "/dashboard", label: "الرئيسية", icon: "home" },
  { to: "/stock", label: "المخزون", icon: "box" },
  { to: "/customers", label: "العملاء", icon: "users" },
  { to: "/invoices", label: "الفواتير", icon: "file" },
  { to: "/payments", label: "السندات / السداد", icon: "card" },
  { to: "/expenses", label: "المصروفات والدخل", icon: "cashflow" },
  { to: "/ledger", label: "التقارير", icon: "chart" },
  { to: "/settings", label: "الإعدادات", icon: "settings" },
];

export default function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [sessUser, setSessUser] = useState(() => currentUser());
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginErr, setLoginErr] = useState("");

  // ===== Mobile UI toggle (SAFE – لا يؤثر على الكمبيوتر) =====
useEffect(() => {
  const applyMobileUI = () => {
    const isMobile = window.innerWidth <= 680;
    document.body.classList.toggle("mobile-ui", isMobile);
  };

  applyMobileUI(); // أول تحميل
  window.addEventListener("resize", applyMobileUI);

  return () => window.removeEventListener("resize", applyMobileUI);
}, []);

  useEffect(() => {
    setSessUser(currentUser());
  }, [location.pathname]);

  const perms = useMemo(() => effectivePerms(sessUser), [sessUser]);

  // ===== App Settings (network name / logo / threshold) =====
  const DEFAULT_SETTINGS = {
    company_name: "شبكة ون نت اللاسلكية",
    company_name_en: "Network One Net Wireless",
    logo_base64: null,
    logo_url: null,
    low_stock_threshold: 10,
  };
  const [appSettings, setAppSettings] = useState(() => {
    try {
      const cached = localStorage.getItem("onenet_app_settings_v1");
      return cached ? { ...DEFAULT_SETTINGS, ...JSON.parse(cached) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('settings').select('*').limit(1).maybeSingle();
        if (!mounted) return;
        if (!error && data) {
          const normalized = {
            ...DEFAULT_SETTINGS,
            ...data,
            company_name: data.company_name ?? data.shop_name ?? data.network_name ?? DEFAULT_SETTINGS.company_name,
            company_name_en: data.company_name_en ?? data.shop_name_en ?? DEFAULT_SETTINGS.company_name_en,
            logo_base64: data.logo_base64 ?? null,
            logo_url: data.logo_url ?? data.logo ?? null,
            low_stock_threshold: typeof data.low_stock_threshold === 'number' ? data.low_stock_threshold : DEFAULT_SETTINGS.low_stock_threshold,
          };
          setAppSettings(normalized);
          localStorage.setItem("onenet_app_settings_v1", JSON.stringify(normalized));
        }
      } catch {
        /* fallback already loaded */
      }
    })();
    return () => { mounted = false; };
  }, []);

  const navItemsFiltered = useMemo(() => {
    return navItems.filter((it) => {
      if (it.to === "/settings") return !!perms.view_settings || sessUser?.role === "Admin";
      if (it.to === "/ledger") return !!perms.view_reports || sessUser?.role === "Admin";
      if (it.to === "/stock") return !!perms.view_stock || sessUser?.role === "Admin";
      return true;
    });
  }, [perms, sessUser]);

  const current = (navItemsFiltered.find((x) => location.pathname.startsWith(x.to)) || navItemsFiltered[0] || navItems[0]);

  const allowed = sessUser ? canAccessPath(sessUser, location.pathname) : false;

  async function doLogin(e){
  e.preventDefault();
  const res = await loginAsync(loginForm.username, loginForm.password);
  if(!res.ok){
    setLoginErr(res.error || "خطأ في تسجيل الدخول");
    return;
  }
  setLoginErr("");
  setSessUser(res.user);
  navigate("/dashboard");
}


  function doLogout(){
    logout();
    setSessUser(null);
    navigate("/dashboard");
  }

async function loadAppSettings(){
  try{
    const { data } = await supabase.from("settings").select("*").limit(1).maybeSingle();
    const s = {
      shop_name: data?.shop_name || data?.network_name || "شبكة ون نت اللاسلكية",
      phone: data?.phone || "",
      address: data?.address || "",
      logo_base64: data?.logo_base64 || data?.logo_url || "",
    };
    setAppSettings(s);
  }catch{
    // ignore
  }
}

  return (
    <div className="app" dir="rtl" lang="ar">

{!sessUser && (
  <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:50}}>
    <div className="card" style={{width:380, maxWidth:"92vw"}}>
      <div className="card-head">
        <h3 style={{margin:0}}>تسجيل الدخول</h3>
        <span style={{fontSize:12,color:"var(--muted)"}}>Admin / Seller / Viewer</span>
      </div>
      <form onSubmit={doLogin} style={{padding:16, display:"grid", gap:10}}>
        <input className="input" placeholder="اسم المستخدم" value={loginForm.username} onChange={(e)=>setLoginForm(f=>({...f, username:e.target.value}))} />
        <input className="input" placeholder="كلمة المرور" type="password" value={loginForm.password} onChange={(e)=>setLoginForm(f=>({...f, password:e.target.value}))} />
        {loginErr && <div style={{color:"#b00020", fontSize:13}}>{loginErr}</div>}
        <button className="btn-primary" type="submit">دخول</button>
        <div style={{fontSize:12,color:"var(--muted)", lineHeight:1.6}}>
          الافتراضي: <b>admin</b> / <b>admin123</b>
        </div>
      </form>
    </div>
  </div>
)}

      <main className="main">
        <div className="topbar">
          <div className="topbar-title">
            <h1>{current?.label || "لوحة التحكم"}</h1>
            <span>OneNet ERP</span>
          </div>
          <div style={{display:"flex", alignItems:"center", gap:10}}>
            {sessUser && <div style={{fontSize:12,color:"var(--muted)"}}>مستخدم: <b>{sessUser.username}</b> ({sessUser.role})</div>}
            {sessUser && <button className="btn" type="button" onClick={doLogout}>خروج</button>}
          </div>
        </div>
        {allowed ? children : <div className="card" style={{marginTop:16}}><div className="card-body">ليس لديك صلاحية لعرض هذه الصفحة</div></div>}
      </main>

      <aside className="sidebar">
        <div className="brand">
          {appSettings.logo_base64 ? (
            <img className="brand-logo" src={appSettings.logo_base64} alt="logo" />
          ) : (
            <div className="brand-dot" />
          )}
          <div>
            <div className="brand-title">{appSettings.company_name || "شبكة ون نت اللاسلكية"}</div>
            <div className="brand-sub">ERP • React + Supabase</div>
          </div>
        </div>

        <nav className="nav-list">
          {navItemsFiltered.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
            >
              <span className="nav-text">{item.label}</span>
              <span className="nav-icon">
                <Icon name={item.icon} />
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="nav-version">
          <div>الإصدار 0.3</div>
          <div>ابدأ من Settings لضبط Supabase ثم أنشئ البيانات</div>
        </div>
      </aside>
    </div>
  );
}