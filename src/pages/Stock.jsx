import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { currentUser, effectivePerms } from "../lib/auth";

function dtLocalNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
// ===== Helpers =====
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function Stock() {
  // حد تنبيه المخزون: من الإعدادات (إن وجد) وإلا من localStorage وإلا 10
  const [lowStockThreshold, setLowStockThreshold] = useState(
    Number(localStorage.getItem("low_stock_threshold") || 10)
  );
  const [tab, setTab] = useState("balance"); // balance | newType | movement
  const [loading, setLoading] = useState(false);

  // Session user + permissions
  const sessUser = currentUser();
  const perms = useMemo(() => effectivePerms(sessUser), [sessUser]);

  const [balances, setBalances] = useState([]);     // v_card_balances
  const [movements, setMovements] = useState([]);   // v_card_movements

  // ====== Balance
  const [q, setQ] = useState("");
  const filteredBalances = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return balances;
    return balances.filter((r) => (r.name || "").toLowerCase().includes(s));
  }, [balances, q]);

  // ====== Add Type
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState(0);
  const [newLow, setNewLow] = useState(Number(localStorage.getItem("new_type_low_threshold") || lowStockThreshold || 0));
  const [addingType, setAddingType] = useState(false);

  // ====== Edit Type
  const [editTypeOpen, setEditTypeOpen] = useState(false);
  const [editTypeRow, setEditTypeRow] = useState(null);
  const [editTypeName, setEditTypeName] = useState("");
  const [editTypePrice, setEditTypePrice] = useState(0);
  const [editTypeLow, setEditTypeLow] = useState(0);
  const [savingType, setSavingType] = useState(false);

  // ====== Movement
  const [mode, setMode] = useState("IN");
  const [cardTypeId, setCardTypeId] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const [useCustomDate, setUseCustomDate] = useState(false);
  const [movementDate, setMovementDate] = useState(dtLocalNow());

  const loadLowStockThreshold = async () => {
    try {
      const { data, error } = await supabase
        .from("settings")
        .select("low_stock_threshold")
        .limit(1)
        .maybeSingle();
      if (!error && data && typeof data.low_stock_threshold === "number") {
        setLowStockThreshold(data.low_stock_threshold);
        localStorage.setItem("low_stock_threshold", String(data.low_stock_threshold));
      }
    } catch {
      // ignore
    }
  };

  const [logFilter, setLogFilter] = useState("ALL"); // ALL | IN | OUT | DELETE
  const filteredMovements = useMemo(() => {
    return (movements || []).filter((m) => {
      if (logFilter === "ALL") return true;
      if (logFilter === "DELETE")
        return (m.note || "").includes("حذف") || (m.note || "").includes("تصحيح");
      return m.movement_type === logFilter;
    });
  }, [movements, logFilter]);

  // ====== Edit Modal
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [editQty, setEditQty] = useState(1);
  const [editUseDate, setEditUseDate] = useState(false);
  const [editDate, setEditDate] = useState(dtLocalNow());
  const [editNote, setEditNote] = useState("");

  const fmtDate = (iso) => {
    if (!iso) return "-";
    try { return new Date(iso).toLocaleString("ar-SA"); }
    catch { return iso; }
  };

  const rowBg = (noteText) => {
    const t = noteText || "";
    if (t.includes("حذف")) return "#dd1616ff";
    if (t.includes("تصحيح")) return "#152bbaff";
    return "transparent";
  };

  const opType = (noteText) => {
    const t = noteText || "";
    if (t.includes("حذف")) return "حذف";
    if (t.includes("تصحيح")) return "تصحيح";
    return "عادية";
  };

  


  async function loadData() {
    setLoading(true);
    try {
      const { data: b, error: eb } = await supabase
        .from("v_card_stock_summary")
        .select("*")
        .order("card_type_id", { ascending: true });
      if (eb) throw eb;
      // Enrich balances with per-card metadata (name/price) + thresholds (from card_types)
      // ملاحظة: بعض الـ views (مثل v_card_stock_summary) قد ترجع card_type_id + balance فقط
      // بدون name/price، لذلك لازم نجيبها من card_types ونركّبها هنا.
      const { data: trows, error: et } = await supabase
        .from("card_types")
        .select("id, name, price, low_stock_threshold, alert_qty, low_stock_alert");
      if (et) throw et;

      const tmap = new Map((trows || []).map((r) => [Number(r.id), r]));
      const enriched = (b || []).map((row) => {
        const t = tmap.get(Number(row.card_type_id));
        return {
          ...row,
          // name/price قد تكون NULL من الـ view، لذلك نأخذها من card_types
          name:
            row.name ??
            row.card_type_name ??
            row.card_name ??
            row.card ??
            row.card_type ??
            row.cardType ??
            row.cardtype ??
            t?.name ??
            "",
          price: (row.price ?? t?.price ?? 0),
          // نثبت الحقل اللي نعرضه في شاشة "رصيد الكروت" على أنه quantity
          // مع الاحتفاظ بـ balance للتوافق مع باقي الكود.
          quantity: Number(row.quantity ?? row.balance ?? row.current_qty ?? row.stock_qty ?? row.qty ?? 0),
          balance: Number(row.balance ?? row.quantity ?? row.current_qty ?? row.stock_qty ?? row.qty ?? 0),
          low_stock_threshold:
            (t && (t.low_stock_threshold ?? t.alert_qty)) ?? row.low_stock_threshold,
          alert_qty: (t && t.alert_qty) ?? row.alert_qty,
          low_stock_alert: (t && t.low_stock_alert) ?? row.low_stock_alert,
        };
      });

      setBalances(enriched);


      // Movements: some DB views might not include the card type name, so we fallback safely.
      const typeNameById = new Map((enriched || []).map((t) => [String(t.card_type_id), t.name]));

      let movementsRows = [];
      const { data: m, error: em } = await supabase
        .from("v_card_movements")
        .select("*")
        .order("id", { ascending: false })
        .limit(500);

      if (em) {
        // fallback below
      } else {
        movementsRows = Array.isArray(m) ? m : [];
      }

      const hasTypeName =
        movementsRows.length &&
        (movementsRows[0].card_type_name || movementsRows[0].name || movementsRows[0].card_name);

      if (!hasTypeName) {
        const { data: raw, error: rawErr } = await supabase
          .from("card_movements")
          .select("id, created_at, card_type_id, movement_type, qty, note, op_type, ref_type, ref_id")
          .order("id", { ascending: false })
          .limit(500);

        if (rawErr) throw rawErr;
        movementsRows = (raw || []).map((r) => ({
          ...r,
          card_type_name: typeNameById.get(String(r.card_type_id)) || null,
          name: typeNameById.get(String(r.card_type_id)) || null,
        }));
      } else {
        // normalize name field
        movementsRows = movementsRows.map((r) => ({
          ...r,
          card_type_name: r.card_type_name || r.card_name || r.name || typeNameById.get(String(r.card_type_id)) || null,
        }));
      }

      setMovements(movementsRows || []);

      if (!cardTypeId && (b || []).length) setCardTypeId(String(b[0].card_type_id));
    } catch (e) {
      console.error(e);
      alert("خطأ في تحميل المخزون (تأكد من Views + الدوال في Supabase)");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLowStockThreshold();
    loadData();
    /* eslint-disable-next-line */
  }, []);

  // ====== Add card type
  async function addCardType() {
    if (addingType) return;
    if (!newName.trim()) return alert("اكتب اسم الكرت");

    setAddingType(true);
    try {
      const { error } = await supabase.from("card_types").insert({
        name: newName.trim(),
        price: Number(newPrice || 0),
        low_stock_threshold: Number(newLow || 0),
        alert_qty: Number(newLow || 0),
      });
      if (error) throw error;

      setNewName("");
      setNewPrice(0);
      setNewLow(Number(lowStockThreshold || 0));
      localStorage.setItem("new_type_low_threshold", String(Number(lowStockThreshold || 0)));

      await loadData();
      setTab("balance");
      alert("تم إضافة نوع الكرت");
    } catch (e) {
      console.error(e);
      alert("فشل إضافة نوع الكرت");
    } finally {
      setAddingType(false);
    }
  }

  function openEditType(row){
    if(!row) return;
    setEditTypeRow(row);
    setEditTypeName(String(row.name || ""));
    setEditTypePrice(Number(row.price || 0));
    setEditTypeLow(Number(row.low_stock_threshold ?? row.alert_qty ?? lowStockThreshold ?? 0));
    setEditTypeOpen(true);
  }

  async function saveEditType(){
    if(savingType) return;
    if(!editTypeRow?.card_type_id) return;
    if(!editTypeName.trim()) return alert("اكتب اسم الكرت");
    setSavingType(true);
    try{
      const id = Number(editTypeRow.card_type_id);
      const payload = {
        name: editTypeName.trim(),
        price: Number(editTypePrice || 0),
        low_stock_threshold: Number(editTypeLow || 0),
        alert_qty: Number(editTypeLow || 0),
      };
      const { error } = await supabase.from("card_types").update(payload).eq("id", id);
      if(error) throw error;
      setEditTypeOpen(false);
      await loadData();
      alert("تم تحديث نوع الكرت");
    }catch(e){
      console.error(e);
      alert("فشل تحديث نوع الكرت");
    }finally{
      setSavingType(false);
    }
  }

  async function deleteType(row){
    if(!row?.card_type_id) return;
    if(!confirm(`حذف نوع الكرت: ${row.name} ؟

ملاحظة: الحذف يسجل حركة عكسية/تنظيف حسب دالة السيرفر.`)) return;
    try{
      const actorId = sessUser?.id || null;
      const id = Number(row.card_type_id);
      // Try common signatures
      let res = await supabase.rpc("card_type_delete", { p_actor_id: actorId, p_id: id });
      if(res?.error && String(res.error.message||"").includes("schema cache")){
        res = await supabase.rpc("card_type_delete", { p_id: id });
      }
      if(res?.error) throw res.error;
      await loadData();
      alert("تم حذف نوع الكرت بنجاح");
    }catch(e){
      console.error(e);
      alert(e?.message || "فشل حذف نوع الكرت");
    }
  }

  // ====== Apply Movement
async function applyMovement() {
  if (!cardTypeId) return alert("اختر نوع الكرت");
  if (!qty || Number(qty) <= 0) return alert("الكمية يجب أن تكون أكبر من صفر");

  // الحركة عندك في قاعدة البيانات تستقبل DATE فقط
  const movementDateOnly = useCustomDate
    ? String(movementDate).slice(0, 10) // من datetime-local ناخذ YYYY-MM-DD
    : new Date().toISOString().slice(0, 10);

  // مهم: لازم ref_id يكون فريد لكل حركة (عشان ما يصير تعارض 409)
  const refId = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  const payload = {
    p_stock_account_id: 1,                 // غيّرها لو حساب المخزون عندك غير 1
    p_card_type_id: Number(cardTypeId),
    p_movement_type: String(mode).toUpperCase(), // IN / OUT
    p_qty: parseInt(qty, 10),              // الدالة الثانية qty = integer
    p_ref_type: "stock",
    p_ref_id: refId,
    p_note: note || null,
    p_movement_date: movementDateOnly,
  };

  const { error } = await supabase.rpc("apply_card_movement", payload);

  if (error) {
    console.error(error);

    // 409 غالباً بسبب تعارض (Unique) على ref_id/ref_type — بعد ما صرنا نولد refId فريد غالباً ما بتتكرر
    if (String(error?.code || "") === "23505") {
      return alert("فشل الحركة: يوجد تعارض (تم تسجيل نفس المرجع سابقاً). جرّب مرة ثانية.");
    }

    return alert(`فشل الحركة: ${error?.message || "تأكد من الدالة + الرصيد"}`);
  }

  setQty(1);
  setNote("");
  setUseCustomDate(false);
  setMovementDate(dtLocalNow());
  await loadData();
  alert("تم تسجيل الحركة");
}


  // ====== Reverse with reason
  async function reverseMovement(row) {
    if (!row?.id) return;

    const reasons = ["خطأ إدخال", "طباعة مكررة", "إلغاء عملية", "تلف", "أخرى"];
    const chosen = prompt(
      `سبب حذف الحركة #${row.id}:\n` +
        reasons.map((r, i) => `${i + 1}- ${r}`).join("\n") +
        `\n\nاكتب رقم السبب`
    );
    if (chosen === null) return;

    const idx = Number(chosen) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= reasons.length) {
      alert("اختيار غير صحيح");
      return;
    }

    let reasonText = reasons[idx];
    if (reasonText === "أخرى") {
      const custom = prompt("اكتب سبب الحذف:");
      if (custom === null) return;
      if (!custom?.trim()) return alert("سبب الحذف مطلوب");
      reasonText = custom.trim();
    }

    const { error } = await supabase.rpc("reverse_card_movement", {
      p_movement_id: Number(row.id),
      p_note: `حذف حركة #${row.id} — السبب: ${reasonText}`,
      p_created_at: null,
    });

    if (error) {
      console.error(error);
      const msg = String(error.message || "");
      if (msg.includes("insufficient stock")) {
        alert("لا يمكن عكس هذه الحركة لأن الرصيد الحالي لا يكفي. غالباً تم صرف الكروت بعد هذه الإضافة، لذلك حذفها سيجعل الرصيد سالب.");
      } else {
        alert(error.message || "فشل الحذف/الإلغاء");
      }
      return;
    }

    await loadData();
    alert("تم الحذف (تسجيل حركة عكسية بسبب الحذف)");
  }

  // ====== Edit (adjust)
  function openEdit(row) {
    setEditRow(row);
    setEditQty(Number(row.qty || 1));
    setEditUseDate(false);
    setEditDate(dtLocalNow());
    setEditNote(`تصحيح حركة #${row.id}`);
    setEditOpen(true);
  }

  async function submitEdit() {
    if (!editRow?.id) return;
    const newQ = Number(editQty || 0);
    if (!newQ || newQ <= 0) return alert("الكمية الجديدة يجب أن تكون أكبر من صفر");

    const createdAt = editUseDate ? new Date(editDate).toISOString() : null;

    const { error } = await supabase.rpc("adjust_card_movement", {
      p_movement_id: Number(editRow.id),
      p_new_qty: newQ,
      p_note: editNote || null,
      p_created_at: createdAt,
    });

    if (error) {
      console.error(error);
      alert("فشل التعديل");
      return;
    }

    setEditOpen(false);
    setEditRow(null);
    await loadData();
    alert("تم حفظ التعديل (كتصحيح محاسبي)");
  }

  const TabButton = ({ active, icon, title, sub, onClick }) => (
    <button
      type="button"
      onClick={onClick}
      className={`btn ${active ? "btn-primary" : ""}`}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        padding: "14px 18px",
        minHeight: 60,
        borderRadius: 18,
        minWidth: 240,
      }}
    >
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ fontWeight: 900, fontSize: 15 }}>{title}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</span>
      </span>
    </button>
  );

  return (
    <div style={{ padding: "10px 6px" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* ===== Sticky top tabs ===== */}
        <div
          className="card"
          style={{
            position: "sticky",
            top: 10,
            zIndex: 20,
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <TabButton
                active={tab === "balance"}
                icon="📦"
                title="رصيد الكروت"
                sub="عرض الرصيد + بحث"
                onClick={() => setTab("balance")}
              />
              <TabButton
                active={tab === "newType"}
                icon="➕"
                title="إضافة نوع كرت"
                sub="اسم + سعر"
                onClick={() => setTab("newType")}
              />
              <TabButton
                active={tab === "movement"}
                icon="🔁"
                title="حركة الكروت"
                sub="IN / OUT + السجل"
                onClick={() => setTab("movement")}
              />
            </div>

            <button className="btn" onClick={loadData} disabled={loading} type="button">
              {loading ? "تحميل..." : "تحديث"}
            </button>
          </div>
        </div>

        {/* ===== TAB 1 ===== */}
        {tab === "balance" && (
          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div className="badge" style={{ fontSize: 13 }}>📦 رصيد الكروت</div>
              <div className="badge">{filteredBalances.length} نوع</div>
            </div>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="col">
                <label style={{ fontSize: 12, color: "var(--muted)" }}>بحث</label>
                <input
                  className="input"
                  placeholder="ابحث باسم الكرت..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>

            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr><th>#</th><th>الكرت</th><th>السعر</th><th>الرصيد</th><th>إجراءات</th></tr>
                </thead>
                <tbody>
                  {filteredBalances.map((b, i) => {
                    const th = Number(b.low_stock_threshold ?? b.alert_qty ?? lowStockThreshold ?? 0) || 0;
                    const qtyNow = Number(b.quantity || 0) || 0;
                    const isZero = qtyNow === 0;
                    const isLow = qtyNow > 0 && qtyNow <= th;

                    return (
                    <tr
  key={b.card_type_id}
  style={{
    background: isZero
      ? "#ffecec"       // 🔴 نفذ
      : isLow
      ? "#fff7e6"       // 🟠 قريب ينفذ
      : "transparent",
  }}
>
                      <td>{i + 1}</td>
                      <td>{b.name}</td>
                      <td>{Number(b.price || 0).toFixed(2)}</td>
                      <td>
                      <span className={isZero ? "badge danger" : isLow ? "badge warn" : "badge ok"}>
                        {b.quantity} {isZero ? "(نفذ)" : isLow ? "(قريب ينفذ)" : ""}
                      </span>
                      <div className="subhint">تنبيه عند: {Number(b.low_stock_threshold ?? lowStockThreshold ?? 0) || 0}</div>
                    </td>
                      <td>
                        <div className="row-actions">
                          {(perms?.all || perms?.stock) && (
                            <button className="btn small" onClick={() => openEditType(b)}>تعديل</button>
                          )}
                          {(perms?.all || perms?.stock_delete) && (
                            <button className="btn small danger" onClick={() => deleteType(b)}>حذف</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {!filteredBalances.length && (
                    <tr><td colSpan={5} style={{ color: "var(--muted)" }}>
                        لا توجد كروت — إذا أنت أضفتها في items لازم تنقلها لـ card_types (الـ SQL فوق يسويها)
                      </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== TAB 2 ===== */}
        {tab === "newType" && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="badge" style={{ marginBottom: 12, fontSize: 13 }}>➕ إضافة نوع كرت جديد</div>

            <div className="row">
              <div className="col">
                <label style={{ fontSize: 12, color: "var(--muted)" }}>اسم الكرت</label>
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div className="col" style={{ maxWidth: 280 }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>السعر</label>
                <input
                  className="input"
                  type="number"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <div className="col" style={{ maxWidth: 280 }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>تنبيه قرب النفاد (لكل كرت)</label>
                <input
                  className="input"
                  type="number"
                  value={newLow}
                  onChange={(e) => setNewLow(e.target.value)}
                  placeholder={`مثال: ${lowStockThreshold}`}
                />
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  إذا الرصيد ≤ هذا الرقم يظهر (قريب ينفذ)
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-primary" onClick={addCardType} disabled={addingType} type="button">
                {addingType ? "حفظ..." : "حفظ"}
              </button>
              <button className="btn" onClick={() => setTab("balance")} type="button">
                رجوع
              </button>
            </div>
          </div>
        )}

        {/* ===== TAB 3 ===== */}
        {tab === "movement" && (
          <>
            <div className="card" style={{ marginTop: 14 }}>
              <div className="badge" style={{ marginBottom: 12, fontSize: 13 }}>🔁 حركة الكروت</div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <button
                  className={`btn ${mode === "IN" ? "btn-primary" : ""}`}
                  onClick={() => setMode("IN")}
                  type="button"
                >
                  IN (طباعة/إضافة)
                </button>
                <button
                  className={`btn danger ${mode === "OUT" ? "btn-primary" : ""}`}
                  onClick={() => setMode("OUT")}
                  type="button"
                >
                  OUT (خصم/تلف/هدية)
                </button>
              </div>

              <div className="row">
                <div className="col">
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>نوع الكرت</label>
                  <select className="input" value={cardTypeId} onChange={(e) => setCardTypeId(e.target.value)}>
                    {balances.map((b) => (
                      <option key={b.card_type_id} value={String(b.card_type_id)}>
                        {b.name} ({Number(b.price || 0).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col" style={{ maxWidth: 280 }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>الكمية</label>
                  <input className="input" type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
              </div>

              <div className="row" style={{ alignItems: "flex-end" }}>
                <div className="col" style={{ maxWidth: 300 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={useCustomDate}
                      onChange={(e) => setUseCustomDate(e.target.checked)}
                    />
                    تسجيل بتاريخ محدد
                  </label>
                </div>

                {useCustomDate && (
                  <div className="col" style={{ maxWidth: 360 }}>
                    <label style={{ fontSize: 12, color: "var(--muted)" }}>التاريخ والوقت</label>
                    <input
                      className="input"
                      type="datetime-local"
                      value={movementDate}
                      onChange={(e) => setMovementDate(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>ملاحظات</label>
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={mode === "IN" ? "مثال: طباعة من الراوتر" : "مثال: تلف / هدية / خصم"}
                />
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button className="btn-primary" onClick={applyMovement} type="button">
                  تنفيذ
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setQty(1);
                    setNote("");
                    setUseCustomDate(false);
                    setMovementDate(dtLocalNow());
                  }}
                  type="button"
                >
                  تفريغ
                </button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="badge" style={{ fontSize: 13 }}>📜 سجل حركة الكروت</div>
                <div className="badge">{filteredMovements.length} حركة</div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {["ALL", "IN", "OUT", "DELETE"].map((f) => (
                  <button
                    key={f}
                    className={`btn ${logFilter === f ? "btn-primary" : ""}`}
                    onClick={() => setLogFilter(f)}
                    type="button"
                  >
                    {f === "ALL" ? "الكل" : f === "DELETE" ? "حذف/تصحيح" : f}
                  </button>
                ))}
              </div>

              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table className="table">
                  
<thead>
  <tr>
    <th style={{ width: 70 }}>#</th>
    <th>الكرت</th>
    <th style={{ width: 90 }}>الحركة</th>
    <th style={{ width: 110 }}>الكمية</th>
    <th style={{ width: 90 }}>قبل</th>
    <th style={{ width: 90 }}>بعد</th>
    <th>ملاحظات</th>
    <th style={{ width: 170 }}>التاريخ</th>
    <th style={{ width: 120 }}>نوع العملية</th>
    <th style={{ width: 150, textAlign: "center" }}>إجراءات</th>
  </tr>
</thead>

                  <tbody>
                    {filteredMovements.map((m, idx) => (
                      <tr key={m.id} style={{ background: rowBg(m.note) }}>
      <td>{idx + 1}</td>
      <td>{m.card_name || m.card || "-"}</td>
      <td style={{ fontWeight: 800 }}>{(m.movement_type || "").toUpperCase()}</td>
      <td style={{ fontWeight: 800 }}>
        {m.movement_type === "IN" ? "+" : "-"} {safeNum(m.qty)}
      </td>
      <td>{safeNum(m.before_balance ?? m.before_qty ?? m.before ?? m.balance_before ?? 0)}</td>
      <td>{safeNum(m.after_balance ?? m.after_qty ?? m.after ?? m.balance_after ?? 0)}</td>
      <td style={{ color: "#334155" }}>{m.note || m.notes || ""}</td>
      <td>{fmtDate(m.invoice_datetime || m.created_at || m.date || m.movement_date || "")}</td>
      <td>{m.op_type || m.operation_type || m.type || "عادية"}</td>
      <td style={{ textAlign: "center" }}>
        {/* Use the existing handlers implemented above */}
        <button className="btn btn-sm" onClick={() => openEdit(m)}>تعديل</button>
        <button className="btn btn-sm danger" onClick={() => reverseMovement(m)}>حذف</button>
      </td>
</tr>
                    ))}
                    {!filteredMovements.length && (
                      <tr><td colSpan={10} style={{ color: "var(--muted)" }}>
                          لا توجد حركات
                        </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
                الحذف = تسجيل حركة عكسية مع سبب الحذف (لا يوجد مسح للسجل).
              </div>
            </div>
          </>
        )}

        {/* EDIT MODAL */}
        
      {editTypeOpen && (
        <div className="modal-backdrop" onClick={() => setEditTypeOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">تعديل نوع الكرت</div>
              <button className="btn small" onClick={() => setEditTypeOpen(false)}>إغلاق</button>
            </div>

            <div className="grid2">
              <div className="field">
                <label>اسم الكرت</label>
                <input value={editTypeName} onChange={(e) => setEditTypeName(e.target.value)} placeholder="اسم الكرت" />
              </div>
              <div className="field">
                <label>السعر</label>
                <input type="number" value={editTypePrice} onChange={(e) => setEditTypePrice(e.target.value)} />
              </div>
              <div className="field">
                <label>تنبيه قرب النفاد</label>
                <input type="number" value={editTypeLow} onChange={(e) => setEditTypeLow(e.target.value)} placeholder="مثال: 10" />
                <div className="muted" style={{ marginTop: 6 }}>إذا كان الرصيد أقل أو يساوي هذا الرقم يظهر (قريب ينفذ)</div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={saveEditType}>حفظ</button>
              <button className="btn" onClick={() => setEditTypeOpen(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
{editOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: 16,
            }}
            onClick={() => setEditOpen(false)}
          >
            <div
              className="card"
              style={{ width: 640, maxWidth: "100%", borderRadius: 18 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="badge">تعديل/تصحيح حركة #{editRow?.id}</div>
                <button className="btn" onClick={() => setEditOpen(false)} type="button">
                  إغلاق
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="row">
                  <div className="col">
                    <label style={{ fontSize: 12, color: "var(--muted)" }}>الكمية الجديدة</label>
                    <input
                      className="input"
                      type="number"
                      value={editQty}
                      onChange={(e) => setEditQty(e.target.value)}
                    />
                  </div>
                </div>

                <div className="row" style={{ alignItems: "flex-end" }}>
                  <div className="col" style={{ maxWidth: 280 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={editUseDate}
                        onChange={(e) => setEditUseDate(e.target.checked)}
                      />
                      تاريخ التصحيح مخصص
                    </label>
                  </div>

                  {editUseDate && (
                    <div className="col">
                      <label style={{ fontSize: 12, color: "var(--muted)" }}>التاريخ والوقت</label>
                      <input
                        className="input"
                        type="datetime-local"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>ملاحظات</label>
                  <input className="input" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <button className="btn-primary" onClick={submitEdit} type="button">
                    حفظ التعديل
                  </button>
                  <button className="btn" onClick={() => setEditOpen(false)} type="button">
                    إلغاء
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
                  التعديل يتم كتسجيل “تصحيح” محاسبي (للحفاظ على الأثر).
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
