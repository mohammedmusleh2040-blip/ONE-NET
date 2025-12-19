// Simple local auth (for internal/local use)
const LS_USERS = "onenet_users_v1";
const LS_SESSION = "onenet_session_v1";

const defaultUsers = [
  {
    id: "admin",
    username: "admin",
    password: "admin123",
    role: "Admin",
    perms: {
      view_stock: true,
      create_invoices: true,
      edit_delete: true,
      view_reports: true,
      view_settings: true,
    },
  },
];

export function getUsers(){
  try{
    const raw = localStorage.getItem(LS_USERS);
    const arr = raw ? JSON.parse(raw) : null;
    if(Array.isArray(arr) && arr.length) return arr;
  }catch(e){}
  localStorage.setItem(LS_USERS, JSON.stringify(defaultUsers));
  return defaultUsers;
}

export function saveUsers(users){
  localStorage.setItem(LS_USERS, JSON.stringify(users||[]));
}

export function getSession(){
  try{
    const raw = localStorage.getItem(LS_SESSION);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

export function setSession(sess){
  localStorage.setItem(LS_SESSION, JSON.stringify(sess||null));
}

export function logout(){
  localStorage.removeItem(LS_SESSION);
}

export function currentUser(){
  const sess = getSession();
  if(!sess?.username) return null;
  const u = getUsers().find(x=>x.username===sess.username);
  return u || null;
}

export function login(username, password){
  const u = getUsers().find(x=>x.username===String(username||"").trim());
  if(!u) return { ok:false, error:"المستخدم غير موجود" };
  if(String(u.password) !== String(password||"")) return { ok:false, error:"كلمة المرور غير صحيحة" };
  setSession({ username: u.username, role: u.role, ts: Date.now() });
  return { ok:true, user:u };
}

const roleDefaults = {
  Admin: { view_stock:true, create_invoices:true, edit_delete:true, view_reports:true, view_settings:true },
  Seller:{ view_stock:true, create_invoices:true, edit_delete:false, view_reports:false, view_settings:false },
  Viewer:{ view_stock:true, create_invoices:false, edit_delete:false, view_reports:true, view_settings:false },
};

export function effectivePerms(user){
  if(!user) return {};
  const base = roleDefaults[user.role] || {};
  const p = user.perms || {};
  return { ...base, ...p };
}

export function canAccessPath(user, path){
  const perms = effectivePerms(user);
  if(path.startsWith("/settings")) return !!perms.view_settings;
  if(path.startsWith("/ledger")) return !!perms.view_reports;
  if(path.startsWith("/invoices") || path.startsWith("/payments") || path.startsWith("/customers") || path.startsWith("/expenses"))
    return !!perms.create_invoices || !!perms.view_reports || user?.role==="Admin"; // allow basic access
  if(path.startsWith("/stock")) return !!perms.view_stock;
  return true; // dashboard
}
