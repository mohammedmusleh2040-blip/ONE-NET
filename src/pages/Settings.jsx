import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { currentUser, getUsers, saveUsers } from "../lib/auth.js";

const LS_EXTRA = "onenet_settings_extra_v1";

const emptySettings = {
  id: null,
  company_name: "شبكة ون نت اللاسلكية",
  company_name_en: "Network One Net Wireless",
  logo_base64: "",
  logo_url: "",
  phone: "",
  address: "",
  currency: "YER",
  language: "ar",
  default_price_per_gb: 0,
  low_stock_threshold: 10,
};;

const emptyExtra = {
  currency: "SAR",
  language: "ar",
  reset_secret: "1234",
};

function loadExtra(){
  try{
    const raw = localStorage.getItem(LS_EXTRA);
    const obj = raw ? JSON.parse(raw) : null;
    if(obj && typeof obj === "object") return { ...emptyExtra, ...obj };
  }catch(e){}
  return { ...emptyExtra };
}

function saveExtra(extra){
  localStorage.setItem(LS_EXTRA, JSON.stringify(extra||{}));
}

export default function Settings() {
  const me = currentUser();
  const isAdmin = me?.role === "Admin";

  const [tab, setTab] = useState("system"); // system | users | backup | reset
  const [settings, setSettings] = useState(emptySettings);
  const [extra, setExtra] = useState(loadExtra());

  const [saving, setSaving] = useState(false);

  // Users management
  const [users, setUsers] = useState(() => getUsers());
  const [userForm, setUserForm] = useState({ id:"", username:"", password:"", role:"Seller", perms:{} });
  const [editingId, setEditingId] = useState(null);

  // Backup / restore
  const fileRef = useRef(null);
  const [busyBackup, setBusyBackup] = useState(false);

  // Wipe / reset
  const [wiping, setWiping] = useState(false);
  const [wipeOptions, setWipeOptions] = useState({
    customers: false,
    invoices: false,
    stock: false,
    expenses: false,
  });
  const [resetCode, setResetCode] = useState("");

  const load = async () => {
    const { data, error } = await supabase.from("settings").select("*").limit(1).maybeSingle();

    const lowLocal = Number(localStorage.getItem("low_stock_threshold") || 10);

    if (!error && data) {
      setSettings({
        id: data.id,
        company_name: data.company_name || "",
        logo_url: data.logo_url || "",
        phone: data.phone || "",
        address: data.address || "",
        default_price_per_gb: data.default_price_per_gb || 0,
        low_stock_threshold: typeof data.low_stock_threshold === "number" ? data.low_stock_threshold : lowLocal,
      });
    } else {
      setSettings((prev) => ({ ...prev, low_stock_threshold: lowLocal }));
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    // keep users in sync
    saveUsers(users);
  }, [users]);

  const canSeeAdmin = isAdmin;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings((prev) => ({ ...prev, [name]: value }));
  };

  const handleExtraChange = (e) => {
    const { name, value } = e.target;
    setExtra((prev) => {
      const next = { ...prev, [name]: value };
      saveExtra(next);
      return next;
    });
  };

  const handleLogoUpload = async (e) => {
    const f = e.target.files?.[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result || "");
      setSettings((prev)=>({ ...prev, logo_url: b64 }));
    };
    reader.readAsDataURL(f);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);

    const payload = {
      company_name: settings.company_name,
      logo_url: settings.logo_url,
      phone: settings.phone,
      address: settings.address,
      default_price_per_gb: Number(settings.default_price_per_gb || 0),
      low_stock_threshold: Number(settings.low_stock_threshold || 0),
    };

    try {
      if (settings.id) {
        let { error } = await supabase.from("settings").update(payload).eq("id", settings.id);
        if (error) {
          // fallback: save threshold locally then retry without the column
          localStorage.setItem("low_stock_threshold", String(payload.low_stock_threshold));
          const { low_stock_threshold, ...safePayload } = payload;
          ({ error } = await supabase.from("settings").update(safePayload).eq("id", settings.id));
          if (error) throw error;
        } else {
          localStorage.setItem("low_stock_threshold", String(payload.low_stock_threshold));
        }
      } else {
        let { data, error } = await supabase.from("settings").insert(payload).select().single();
        if (error) {
          localStorage.setItem("low_stock_threshold", String(payload.low_stock_threshold));
          const { low_stock_threshold, ...safePayload } = payload;
          ({ data, error } = await supabase.from("settings").insert(safePayload).select().single());
          if (error) throw error;
        } else {
          localStorage.setItem("low_stock_threshold", String(payload.low_stock_threshold));
        }
        if (data?.id) setSettings((prev) => ({ ...prev, id: data.id }));
      }

      // always persist extra locally
      saveExtra(extra);

      alert("✅ تم حفظ الإعدادات");
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء الحفظ. تأكد من إعداد Supabase و الجداول.");
    } finally {
      setSaving(false);
    }
  };

  // ===== Users management =====
  const roleOptions = ["Admin","Seller","Viewer"];

  function startAddUser(){
    setEditingId(null);
    setUserForm({ id:"", username:"", password:"", role:"Seller", perms:{
      view_stock:true, create_invoices:true, edit_delete:false, view_reports:false, view_settings:false
    }});
  }

  function startEditUser(u){
    setEditingId(u.id);
    setUserForm({ ...u, perms: u.perms || {} });
  }

  function saveUser(){
    if(!canSeeAdmin){
      alert("هذه الميزة للمدير فقط");
      return;
    }
    const username = String(userForm.username||"").trim();
    if(!username) return alert("اكتب اسم المستخدم");
    if(!editingId && !String(userForm.password||"")) return alert("اكتب كلمة المرور");

    const next = [...users];
    if(editingId){
      const i = next.findIndex(x=>x.id===editingId);
      if(i>=0){
        next[i] = { ...next[i], username, role:userForm.role, perms:userForm.perms || {}, password: String(userForm.password||next[i].password||"") };
      }
    }else{
      if(next.some(x=>x.username===username)) return alert("اسم المستخدم موجود بالفعل");
      next.push({
        id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
        username,
        password: String(userForm.password||""),
        role: userForm.role,
        perms: userForm.perms || {},
      });
    }
    setUsers(next);
    alert("✅ تم حفظ المستخدم");
    startAddUser();
  }

  function deleteUser(id){
    if(!canSeeAdmin) return;
    if(id==="admin") return alert("لا يمكن حذف admin الافتراضي");
    if(!confirm("حذف المستخدم؟")) return;
    setUsers(users.filter(x=>x.id!==id));
  }

  function togglePerm(key){
    setUserForm((prev)=>({
      ...prev,
      perms:{ ...(prev.perms||{}), [key]: !prev.perms?.[key] }
    }));
  }

  // ===== Backup / Restore =====
  async function exportJson(){
    if(!canSeeAdmin){
      alert("هذه الميزة للمدير فقط");
      return;
    }
    setBusyBackup(true);
    try{
      const tables = ["customers","card_types","card_stock","card_movements","invoices","invoice_line_items","payments","expenses","settings"];
      const out = { meta:{ exported_at: new Date().toISOString(), app:"OneNet ERP" }, tables:{} };
      for(const t of tables){
        const { data, error } = await supabase.from(t).select("*");
        if(error) throw new Error(t + ": " + error.message);
        out.tables[t] = data || [];
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "onenet_backup.json";
      a.click();
      URL.revokeObjectURL(url);
    }catch(err){
      console.error(err);
      alert("فشل التصدير: " + (err?.message||""));
    }finally{
      setBusyBackup(false);
    }
  }

  async function importJsonFile(file){
    if(!canSeeAdmin){
      alert("هذه الميزة للمدير فقط");
      return;
    }
    if(!file) return;
    setBusyBackup(true);
    try{
      const text = await file.text();
      const obj = JSON.parse(text);
      const tables = obj?.tables || {};
      if(!tables || typeof tables !== "object") throw new Error("ملف غير صحيح");

      // optional: wipe first
      if(!confirm("سيتم استيراد البيانات. هل تريد حذف البيانات الحالية أولاً؟")) {
        // continue without wipe
      }else{
        // delete in safe order (children first)
        const delOrder = ["invoice_line_items","payments","invoices","card_movements","card_stock","card_types","expenses","customers","settings"];
        for(const t of delOrder){
          await supabase.from(t).delete().neq("id", -1);
        }
      }

      const insOrder = ["customers","card_types","card_stock","card_movements","invoices","invoice_line_items","payments","expenses","settings"];
      for(const t of insOrder){
        const rows = Array.isArray(tables[t]) ? tables[t] : [];
        if(!rows.length) continue;
        // chunk inserts
        const chunk = 500;
        for(let i=0;i<rows.length;i+=chunk){
          const part = rows.slice(i,i+chunk);
          const { error } = await supabase.from(t).insert(part);
          if(error) throw new Error(t + ": " + error.message);
        }
      }

      alert("✅ تم الاستيراد بنجاح");
      await load();
    }catch(err){
      console.error(err);
      alert("فشل الاستيراد: " + (err?.message||""));
    }finally{
      setBusyBackup(false);
      if(fileRef.current) fileRef.current.value = "";
    }
  }

  // ===== Wipe selected (existing) =====
  const handleWipeOptionChange = (e) => {
    const { name, checked } = e.target;
    setWipeOptions((prev) => ({ ...prev, [name]: checked }));
  };

  const handleWipeSelected = async () => {
    if (wiping) return;

    if (!wipeOptions.customers && !wipeOptions.invoices && !wipeOptions.stock && !wipeOptions.expenses) {
      alert("اختر نوع البيانات التي تريد حذفها أولاً.");
      return;
    }

    if(!canSeeAdmin){
      alert("الحذف للمدير فقط");
      return;
    }

    setWiping(true);
    try {
      // delete in safe order
      if (wipeOptions.invoices) {
        await supabase.from("invoice_line_items").delete().neq("id", -1);
        await supabase.from("payments").delete().neq("id", -1);
        await supabase.from("invoices").delete().neq("id", -1);
      }
      if (wipeOptions.stock) {
        await supabase.from("card_movements").delete().neq("id", -1);
        await supabase.from("card_stock").delete().neq("id", -1);
        await supabase.from("card_types").delete().neq("id", -1);
      }
      if (wipeOptions.expenses) {
        await supabase.from("expenses").delete().neq("id", -1);
      }
      if (wipeOptions.customers) {
        await supabase.from("customers").delete().neq("id", -1);
      }

      alert("✅ تم حذف البيانات المحددة");
    } catch (err) {
      console.error(err);
      alert("حصل خطأ أثناء الحذف");
    } finally {
      setWiping(false);
    }
  };

  // ===== Reset with secret code =====
  async function resetAll(){
    if(!canSeeAdmin){
      alert("هذه الميزة للمدير فقط");
      return;
    }
    if(String(resetCode||"").trim() !== String(extra.reset_secret||"").trim()){
      alert("رمز الحذف غير صحيح");
      return;
    }
    if(!confirm("⚠️ سيتم حذف كل البيانات (عملاء/مخزون/فواتير/سندات/مصروفات). متأكد؟")) return;

    setWiping(true);
    try{
      const delOrder = ["invoice_line_items","payments","invoices","card_movements","card_stock","card_types","expenses","customers"];
      for(const t of delOrder){
        await supabase.from(t).delete().neq("id", -1);
      }
      alert("✅ تم حذف كل البيانات");
    }catch(err){
      console.error(err);
      alert("فشل الحذف الكلي");
    }finally{
      setWiping(false);
      setResetCode("");
    }
  }

  const lowThresh = Number(settings.low_stock_threshold || 0);

  return (
    <div className="page">
      <div className="card" style={{marginBottom:14}}>
        <div className="card-head">
          <h3 style={{margin:0}}>الإعدادات</h3>
          <span style={{fontSize:12,color:"var(--muted)"}}>System • Users • Backup • Reset</span>
        </div>

        <div className="tabs" style={{display:"flex", gap:8, padding:"0 16px 12px", flexWrap:"wrap"}}>
          <button className={"btn " + (tab==="system"?"btn-primary":"")} onClick={()=>setTab("system")} type="button">إعدادات النظام</button>
          <button className={"btn " + (tab==="users"?"btn-primary":"")} onClick={()=>setTab("users")} type="button" disabled={!canSeeAdmin}>إدارة المستخدمين</button>
          <button className={"btn " + (tab==="backup"?"btn-primary":"")} onClick={()=>setTab("backup")} type="button" disabled={!canSeeAdmin}>النسخ الاحتياطي</button>
          <button className={"btn danger " + (tab==="reset"?"btn-primary":"")} onClick={()=>setTab("reset")} type="button" disabled={!canSeeAdmin}>حذف شامل</button>
        </div>
      </div>

      {tab==="system" && (
        <div className="card">
          <div className="card-head"><h3 style={{margin:0}}>إعدادات النظام</h3><span style={{fontSize:12,color:"var(--muted)"}}>بيانات الشبكة وواجهة النظام</span></div>

          <form onSubmit={save} style={{padding:16}}>
            <div className="grid" style={{display:"grid", gap:12}}>
              <div className="row" style={{display:"flex", gap:12, flexWrap:"wrap"}}>
                <div className="col" style={{flex:"1 1 240px"}}>
                  <label style={{fontSize:12,color:"var(--muted)"}}>اسم الشبكة</label>
                  <input className="input" name="company_name" value={settings.company_name} onChange={handleChange}/>
                </div>
                <div className="col" style={{flex:"1 1 240px"}}>
                  <label style={{fontSize:12,color:"var(--muted)"}}>الهاتف</label>
                  <input className="input" name="phone" value={settings.phone} onChange={handleChange}/>
                </div>
                <div className="col" style={{flex:"1 1 240px"}}>
                  <label style={{fontSize:12,color:"var(--muted)"}}>العنوان</label>
                  <input className="input" name="address" value={settings.address} onChange={handleChange}/>
                </div>
              </div>

              <div className="row" style={{display:"flex", gap:12, flexWrap:"wrap"}}>
                <div className="col" style={{flex:"1 1 260px"}}>
                  <label style={{fontSize:12,color:"var(--muted)"}}>الشعار (Base64 أو رابط)</label>
                  <input className="input" name="logo_url" value={settings.logo_url} onChange={handleChange} placeholder="DataURL أو رابط"/>
                  <div style={{marginTop:8, display:"flex", gap:10, alignItems:"center", flexWrap:"wrap"}}>
                    <input type="file" accept="image/*" onChange={handleLogoUpload}/>
                    {settings.logo_url && <img src={settings.logo_url} alt="logo" style={{height:36, borderRadius:8}}/>}
                  </div>
                </div>

                <div className="col" style={{flex:"0 0 200px"}}>
                  <label style={{fontSize:12,color:"var(--muted)"}}>سعر الجيجا الافتراضي</label>
                  <input className="input" type="number" name="default_price_per_gb" value={settings.default_price_per_gb} onChange={handleChange}/>
                </div>

                <div className="col" style={{flex:"0 0 200px"}}>
                  <label style={{fontSize:12,color:"var(--muted)"}}>حد تنبيه نفاد المخزون</label>
                  <input className="input" type="number" name="low_stock_threshold" min={0} value={settings.low_stock_threshold} onChange={handleChange}/>
                  <div style={{fontSize:12, color:"var(--muted)", marginTop:6}}>التنبيه يظهر إذا الرصيد ≤ {lowThresh}</div>
                </div>
              </div>

              <div className="row" style={{display:"flex", gap:12, flexWrap:"wrap"}}>
                <div className="col" style={{flex:"0 0 200px"}}>
                  <label style={{fontSize:12,color:"var(--muted)"}}>العملة</label>
                  <select className="input" name="currency" value={extra.currency} onChange={handleExtraChange}>
                    <option value="SAR">SAR</option>
                    <option value="YER">YER</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="col" style={{flex:"0 0 200px"}}>
                  <label style={{fontSize:12,color:"var(--muted)"}}>اللغة</label>
                  <select className="input" name="language" value={extra.language} onChange={handleExtraChange}>
                    <option value="ar">عربي</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              <div style={{marginTop:8}}>
                <button className="btn-primary" type="submit" disabled={saving}>
                  {saving ? "جارِ الحفظ..." : "حفظ الإعدادات"}
                </button>
              </div>
            </div>
          </form>

          <div className="card" style={{margin:16}}>
            <div className="card-head"><h3 style={{margin:0}}>حذف بيانات محددة</h3><span style={{fontSize:12,color:"var(--muted)"}}>يحذف السجلات فقط (لا يحذف الجداول)</span></div>
            <div style={{padding:16}}>
              <div style={{display:"flex", gap:12, flexWrap:"wrap"}}>
                <label className="pill"><input type="checkbox" name="customers" checked={wipeOptions.customers} onChange={handleWipeOptionChange}/> العملاء</label>
                <label className="pill"><input type="checkbox" name="invoices" checked={wipeOptions.invoices} onChange={handleWipeOptionChange}/> الفواتير + السندات</label>
                <label className="pill"><input type="checkbox" name="stock" checked={wipeOptions.stock} onChange={handleWipeOptionChange}/> الكروت + المخزون</label>
                <label className="pill"><input type="checkbox" name="expenses" checked={wipeOptions.expenses} onChange={handleWipeOptionChange}/> المصروفات</label>
              </div>

              <div style={{marginTop:12}}>
                <button className="btn-primary danger" type="button" onClick={handleWipeSelected} disabled={wiping || !canSeeAdmin}>
                  {wiping ? "جارِ الحذف..." : "حذف البيانات المحددة"}
                </button>
              </div>
              {!canSeeAdmin && <div style={{marginTop:8, fontSize:12, color:"var(--muted)"}}>الحذف متاح للمدير فقط</div>}
            </div>
          </div>
        </div>
      )}

      {tab==="users" && (
        <div className="card">
          <div className="card-head"><h3 style={{margin:0}}>إدارة المستخدمين</h3><span style={{fontSize:12,color:"var(--muted)"}}>Admin / Seller / Viewer</span></div>
          <div style={{padding:16}}>
            {!canSeeAdmin ? (
              <div className="muted">هذه الصفحة للمدير فقط</div>
            ) : (
              <>
                <div style={{display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", marginBottom:12}}>
                  <button className="btn-primary" type="button" onClick={startAddUser}>إضافة مستخدم</button>
                </div>

                <div className="card" style={{marginBottom:14}}>
                  <div className="card-head"><h3 style={{margin:0}}>{editingId ? "تعديل مستخدم" : "مستخدم جديد"}</h3><span style={{fontSize:12,color:"var(--muted)"}} /></div>
                  <div style={{padding:16, display:"grid", gap:10}}>
                    <div style={{display:"flex", gap:10, flexWrap:"wrap"}}>
                      <input className="input" style={{flex:"1 1 220px"}} placeholder="اسم المستخدم" value={userForm.username} onChange={(e)=>setUserForm(f=>({...f, username:e.target.value}))}/>
                      <input className="input" style={{flex:"1 1 220px"}} placeholder={editingId ? "كلمة المرور (اختياري)" : "كلمة المرور"} type="password" value={userForm.password} onChange={(e)=>setUserForm(f=>({...f, password:e.target.value}))}/>
                      <select className="input" style={{flex:"0 0 180px"}} value={userForm.role} onChange={(e)=>setUserForm(f=>({...f, role:e.target.value}))}>
                        {roleOptions.map(r=><option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>

                    <div style={{display:"flex", gap:10, flexWrap:"wrap"}}>
                      <label className="pill"><input type="checkbox" checked={!!userForm.perms?.view_stock} onChange={()=>togglePerm("view_stock")} /> رؤية المخزون</label>
                      <label className="pill"><input type="checkbox" checked={!!userForm.perms?.create_invoices} onChange={()=>togglePerm("create_invoices")} /> إنشاء فواتير</label>
                      <label className="pill"><input type="checkbox" checked={!!userForm.perms?.edit_delete} onChange={()=>togglePerm("edit_delete")} /> تعديل/حذف</label>
                      <label className="pill"><input type="checkbox" checked={!!userForm.perms?.view_reports} onChange={()=>togglePerm("view_reports")} /> رؤية التقارير</label>
                      <label className="pill"><input type="checkbox" checked={!!userForm.perms?.view_settings} onChange={()=>togglePerm("view_settings")} /> رؤية الإعدادات</label>
                    </div>

                    <div style={{display:"flex", gap:10}}>
                      <button className="btn-primary" type="button" onClick={saveUser}>حفظ</button>
                      {editingId && <button className="btn" type="button" onClick={startAddUser}>إلغاء</button>}
                    </div>
                  </div>
                </div>

                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>المستخدم</th>
                        <th>الصلاحية</th>
                        <th>الصلاحيات</th>
                        <th>إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u, idx)=>(
                        <tr key={u.id}>
                          <td>{idx+1}</td>
                          <td>{u.username}</td>
                          <td>{u.role}</td>
                          <td style={{fontSize:12,color:"var(--muted)"}}>
                            {u.perms?.view_stock ? "مخزون " : ""}
                            {u.perms?.create_invoices ? "فواتير " : ""}
                            {u.perms?.edit_delete ? "تعديل " : ""}
                            {u.perms?.view_reports ? "تقارير " : ""}
                            {u.perms?.view_settings ? "إعدادات " : ""}
                          </td>
                          <td>
                            <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                              <button className="btn" type="button" onClick={()=>startEditUser(u)}>تعديل</button>
                              <button className="btn danger" type="button" onClick={()=>deleteUser(u.id)}>حذف</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab==="backup" && (
        <div className="card">
          <div className="card-head"><h3 style={{margin:0}}>النسخ الاحتياطي</h3><span style={{fontSize:12,color:"var(--muted)"}}>Export / Restore JSON</span></div>
          <div style={{padding:16, display:"grid", gap:14}}>
            {!canSeeAdmin ? (
              <div className="muted">هذه الصفحة للمدير فقط</div>
            ) : (
              <>
                <div style={{display:"flex", gap:10, flexWrap:"wrap"}}>
                  <button className="btn-primary" type="button" onClick={exportJson} disabled={busyBackup}>
                    {busyBackup ? "جارِ التصدير..." : "تصدير JSON"}
                  </button>
                </div>

                <div className="card">
                  <div className="card-head"><h3 style={{margin:0}}>استيراد (Restore)</h3><span style={{fontSize:12,color:"var(--muted)"}}>ملف onenet_backup.json</span></div>
                  <div style={{padding:16, display:"flex", gap:10, alignItems:"center", flexWrap:"wrap"}}>
                    <input ref={fileRef} type="file" accept="application/json" onChange={(e)=>importJsonFile(e.target.files?.[0])} />
                    <div style={{fontSize:12,color:"var(--muted)"}}>
                      إذا اخترت “حذف البيانات أولاً” سيتم تنظيف الجداول ثم إدخال الملف.
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab==="reset" && (
        <div className="card">
          <div className="card-head"><h3 style={{margin:0}}>حذف جميع البيانات</h3><span style={{fontSize:12,color:"var(--muted)"}}>Admin + Secret Code</span></div>
          <div style={{padding:16}}>
            {!canSeeAdmin ? (
              <div className="muted">هذه الصفحة للمدير فقط</div>
            ) : (
              <>
                <div className="card" style={{marginBottom:14}}>
                  <div className="card-head"><h3 style={{margin:0}}>الرمز السري</h3><span style={{fontSize:12,color:"var(--muted)"}}>غيره من هنا</span></div>
                  <div style={{padding:16, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center"}}>
                    <input className="input" style={{flex:"0 0 220px"}} name="reset_secret" value={extra.reset_secret} onChange={handleExtraChange} />
                    <div style={{fontSize:12,color:"var(--muted)"}}>سيُحفظ محلياً على هذا الجهاز</div>
                  </div>
                </div>

                <div className="card" style={{border:"1px solid rgba(176,0,32,.25)"}}>
                  <div className="card-head"><h3 style={{margin:0, color:"#b00020"}}>تحذير</h3><span style={{fontSize:12,color:"var(--muted)"}}>لا يمكن التراجع</span></div>
                  <div style={{padding:16, display:"grid", gap:10}}>
                    <div>هذا الزر يحذف: العملاء + المخزون + الفواتير + السندات + المصروفات.</div>
                    <input className="input" placeholder="أدخل الرمز السري للحذف" value={resetCode} onChange={(e)=>setResetCode(e.target.value)} />
                    <button className="btn-primary danger" type="button" onClick={resetAll} disabled={wiping}>
                      {wiping ? "جارِ الحذف..." : "حذف كل البيانات الآن"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
