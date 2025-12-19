import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function dtLocalNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function Stock() {
  // حد تنبيه المخزون: من الإعدادات (إن وجد) وإلا من localStorage وإلا 10
  const [lowStockThreshold, setLowStockThreshold] = useState(
    Number(localStorage.getItem("low_stock_threshold") || 10)
  );
  const [tab, setTab] = useState("balance"); // balance | newType | movement
  const [loading, setLoading] = useState(false);

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
  const [addingType, setAddingType] = useState(false);

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
        .from("v_card_balances")
        .select("*")
        .order("card_type_id", { ascending: true });
      if (eb) throw eb;
      setBalances(b || []);

      const { data: m, error: em } = await supabase
        .from("v_card_movements")
        .select("*")
        .order("id", { ascending: false })
        .limit(500);
      if (em) throw em;
      setMovements(m || []);

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
      });
      if (error) throw error;

      setNewName("");
      setNewPrice(0);

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

  // ====== Apply Movement
  async function applyMovement() {
    if (!cardTypeId) return alert("اختر نوع الكرت");
    if (!qty || Number(qty) <= 0) return alert("الكمية يجب أن تكون أكبر من صفر");

    const createdAt = useCustomDate ? new Date(movementDate).toISOString() : null;

    const { error } = await supabase.rpc("apply_card_movement", {
      p_card_type_id: Number(cardTypeId),
      p_movement_type: mode,
      p_qty: Number(qty),
      p_note: note || null,
      p_created_at: createdAt,
    });

    if (error) {
      console.error(error);
      return alert("فشل الحركة (تأكد من الدالة + الرصيد)");
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
      alert("فشل الحذف/الإلغاء");
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
                  <tr>
                    <th>#</th>
                    <th>الكرت</th>
                    <th>السعر</th>
                    <th>الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBalances.map((b, i) => (
                    <tr key={b.card_type_id} style={{ background: Number(b.quantity || 0) <= lowStockThreshold ? 'rgba(220,38,38,0.08)' : 'transparent' }}>
                      <td>{i + 1}</td>
                      <td>{b.name}</td>
                      <td>{Number(b.price || 0).toFixed(2)}</td>
                      <td style={{ fontWeight: 800, color: Number(b.quantity || 0) <= lowStockThreshold ? 'var(--danger)' : 'var(--text)' }}>
                        {Number(b.quantity || 0)}
                        {Number(b.quantity || 0) <= lowStockThreshold && (
                          <span style={{ fontSize: 10, marginInlineStart: 8, color: 'var(--danger)' }}>(ينفد قريباً)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filteredBalances.length && (
                    <tr>
                      <td colSpan={4} style={{ color: "var(--muted)" }}>
                        لا توجد كروت — إذا أنت أضفتها في items لازم تنقلها لـ card_types (الـ SQL فوق يسويها)
                      </td>
                    </tr>
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
                      <th>#</th>
                      <th>الكروت</th>
                      <th>الحركة</th>
                      <th>الكمية</th>
                      <th>قبل</th>
                      <th>بعد</th>
                      <th>ملاحظات</th>
                      <th>التاريخ</th>
                      <th>نوع العملية</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMovements.map((m) => (
                      <tr key={m.id} style={{ background: rowBg(m.note) }}>
                        <td>{m.id}</td>
                        <td>{m.card_name}</td>
                        <td>{m.movement_type}</td>
                        <td>{Number(m.qty || 0)}</td>
                        <td>{Number(m.before || 0)}</td>
                        <td>{Number(m.after || 0)}</td>
                        <td>{m.note || "-"}</td>
                        <td>{fmtDate(m.created_at)}</td>
                        <td>{opType(m.note)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn" onClick={() => openEdit(m)} type="button">
                            تعديل
                          </button>{" "}
                          <button className="btn danger" onClick={() => reverseMovement(m)} type="button">
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!filteredMovements.length && (
                      <tr>
                        <td colSpan={10} style={{ color: "var(--muted)" }}>
                          لا توجد حركات
                        </td>
                      </tr>
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
