
// src/pages/OneNetAssistant.jsx

import React, { useState } from "react";
import { supabase } from "../lib/supabaseClient";

const FUNCTION_NAME = "onenet-assistant";

export default function OneNetAssistant() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState([]);

  const [cardSearch, setCardSearch] = useState("");
  const [cards, setCards] = useState([]);

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerInvoices, setCustomerInvoices] = useState([]);

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoice, setInvoice] = useState(null);

  const [invoiceForm, setInvoiceForm] = useState({
    customer_id: "",
    items: [],
    discount_percent: 15,
    paid_amount: 0,
    note: "",
  });

  const callAssistant = async (body) => {
    setLoading(true);
    setMessage("");

    try {
      const { data, error } = await supabase.functions.invoke(
        FUNCTION_NAME,
        {
          body,
        },
      );

      if (error) {
        throw new Error(error.message || "فشل الاتصال بالمساعد");
      }

      if (!data) {
        throw new Error("لم يرجع المساعد أي بيانات");
      }

      if (data.success === false) {
        throw new Error(data.error || "حدث خطأ في المساعد");
      }

      return data;
    } catch (error) {
      console.error("OneNet Assistant:", error);

      setMessage(
        error?.message ||
          "حدث خطأ غير معروف أثناء الاتصال بالمساعد",
      );

      return null;
    } finally {
      setLoading(false);
    }
  };

  // =========================================
  // SEARCH CUSTOMER
  // =========================================

  const searchCustomer = async () => {
    const search = customerSearch.trim();

    if (!search) {
      setMessage("اكتب اسم العميل أولاً");
      return;
    }

    const data = await callAssistant({
      action: "search_customer",
      search,
    });

    if (!data) return;

    setCustomers(data.customers || []);

    if (!(data.customers || []).length) {
      setMessage("لم يتم العثور على العميل");
    } else {
      setMessage(`تم العثور على ${data.customers.length} عميل`);
    }
  };

  // =========================================
  // SELECT CUSTOMER
  // =========================================

  const selectCustomer = async (customer) => {
    setSelectedCustomer(customer);

    setInvoiceForm((prev) => ({
      ...prev,
      customer_id: customer.id,
    }));

    setCustomerInvoices([]);

    const data = await callAssistant({
      action: "get_customer_invoices",
      customer_id: customer.id,
    });

    if (data) {
      setCustomerInvoices(data.invoices || []);
    }
  };

  // =========================================
  // SEARCH CARDS
  // =========================================

  const searchCards = async () => {
    const search = cardSearch.trim();

    if (!search) {
      setMessage("اكتب اسم الكرت أولاً");
      return;
    }

    const data = await callAssistant({
      action: "search_cards",
      search,
    });

    if (!data) return;

    setCards(data.cards || []);

    if (!(data.cards || []).length) {
      setMessage("لم يتم العثور على الكرت");
    } else {
      setMessage(`تم العثور على ${data.cards.length} كرت`);
    }
  };

  // =========================================
  // ADD ITEM TO INVOICE
  // =========================================

  const addCardToInvoice = (card) => {
    setInvoiceForm((prev) => {
      const existing = prev.items.find(
        (item) => Number(item.card_type_id) === Number(card.id),
      );

      if (existing) {
        return {
          ...prev,
          items: prev.items.map((item) =>
            Number(item.card_type_id) === Number(card.id)
              ? {
                  ...item,
                  qty: Number(item.qty) + 1,
                }
              : item,
          ),
        };
      }

      return {
        ...prev,
        items: [
          ...prev.items,
          {
            card_type_id: card.id,
            name: card.name,
            qty: 1,
            price: Number(card.selling_price ?? card.price ?? 0),
          },
        ],
      };
    });

    setMessage(`تمت إضافة ${card.name}`);
  };

  // =========================================
  // CHANGE ITEM QTY
  // =========================================

  const changeQty = (cardTypeId, qty) => {
    const value = Math.max(1, Number(qty) || 1);

    setInvoiceForm((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        Number(item.card_type_id) === Number(cardTypeId)
          ? {
              ...item,
              qty: value,
            }
          : item,
      ),
    }));
  };

  // =========================================
  // REMOVE ITEM
  // =========================================

  const removeItem = (cardTypeId) => {
    setInvoiceForm((prev) => ({
      ...prev,
      items: prev.items.filter(
        (item) =>
          Number(item.card_type_id) !== Number(cardTypeId),
      ),
    }));
  };

  // =========================================
  // CALCULATE TOTAL
  // =========================================

  const totalBeforeDiscount = invoiceForm.items.reduce(
    (sum, item) =>
      sum +
      Number(item.qty || 0) *
        Number(item.price || 0),
    0,
  );

  const discountPercent =
    Number(invoiceForm.discount_percent) || 0;

  const discountValue =
    totalBeforeDiscount *
    (discountPercent / 100);

  const totalAfterDiscount =
    totalBeforeDiscount - discountValue;

  const paidAmount =
    Number(invoiceForm.paid_amount) || 0;

  const remainingAmount = Math.max(
    totalAfterDiscount - paidAmount,
    0,
  );

  // =========================================
  // VALIDATE INVOICE
  // =========================================

  const validateInvoice = async () => {
    if (!selectedCustomer) {
      setMessage("اختر العميل أولاً");
      return;
    }

    if (!invoiceForm.items.length) {
      setMessage("أضف صنفًا واحدًا على الأقل");
      return;
    }

    const data = await callAssistant({
      action: "validate_invoice_request",
      customer_id: Number(selectedCustomer.id),
      items: invoiceForm.items.map((item) => ({
        card_type_id: Number(item.card_type_id),
        qty: Number(item.qty),
        price: Number(item.price),
      })),
      discount_percent: discountPercent,
      paid_amount: paidAmount,
    });

    if (!data) return;

    setMessage("الفاتورة سليمة وجاهزة للإنشاء");
  };

  // =========================================
  // CREATE INVOICE
  // =========================================

  const createInvoice = async () => {
    if (!selectedCustomer) {
      setMessage("اختر العميل أولاً");
      return;
    }

    if (!invoiceForm.items.length) {
      setMessage("أضف أصناف الفاتورة أولاً");
      return;
    }

    const confirmed = window.confirm(
      [
        "تأكيد إنشاء الفاتورة؟",
        "",
        `العميل: ${selectedCustomer.name}`,
        `الإجمالي: ${totalAfterDiscount.toFixed(2)}`,
        `المدفوع: ${paidAmount.toFixed(2)}`,
        `المتبقي: ${remainingAmount.toFixed(2)}`,
        "",
        "سيتم تسجيل العملية فعليًا في OneNet.",
      ].join("\n"),
    );

    if (!confirmed) return;

    const requestId = crypto.randomUUID();

    const data = await callAssistant({
      action: "create_invoice",
      request_id: requestId,
      customer_id: Number(selectedCustomer.id),
      items: invoiceForm.items.map((item) => ({
        card_type_id: Number(item.card_type_id),
        qty: Number(item.qty),
        price: Number(item.price),
      })),
      discount_percent: discountPercent,
      paid_amount: paidAmount,
      note: invoiceForm.note || null,
    });

    if (!data) return;

    const createdInvoice =
      data.invoice || data;

    setInvoice(createdInvoice);

    setMessage(
      `تم إنشاء الفاتورة بنجاح: ${
        createdInvoice.invoice_number ||
        createdInvoice.number ||
        ""
      }`,
    );

    // تحديث مخزون الكروت بعد الإنشاء
    if (cardSearch.trim()) {
      const cardsData = await callAssistant({
        action: "search_cards",
        search: cardSearch.trim(),
      });

      if (cardsData) {
        setCards(cardsData.cards || []);
      }
    }

    // إعادة جلب فواتير العميل
    if (selectedCustomer?.id) {
      const invoicesData = await callAssistant({
        action: "get_customer_invoices",
        customer_id: selectedCustomer.id,
      });

      if (invoicesData) {
        setCustomerInvoices(
          invoicesData.invoices || [],
        );
      }
    }

    setInvoiceForm((prev) => ({
      ...prev,
      items: [],
      paid_amount: 0,
      note: "",
    }));
  };

  // =========================================
  // GET INVOICE
  // =========================================

  const getInvoice = async () => {
    const search = invoiceNumber.trim();

    if (!search) {
      setMessage("اكتب رقم الفاتورة");
      return;
    }

    const data = await callAssistant({
      action: "get_invoice",
      invoice_number: search,
    });

    if (!data) return;

    setInvoice(data.invoice || null);

    if (!data.invoice) {
      setMessage("لم يتم العثور على الفاتورة");
    } else {
      setMessage("تم جلب الفاتورة");
    }
  };

  // =========================================
  // RESET
  // =========================================

  const resetAssistant = () => {
    setMessage("");
    setCustomers([]);
    setCards([]);
    setSelectedCustomer(null);
    setCustomerInvoices([]);
    setInvoice(null);

    setCustomerSearch("");
    setCardSearch("");
    setInvoiceNumber("");

    setInvoiceForm({
      customer_id: "",
      items: [],
      discount_percent: 15,
      paid_amount: 0,
      note: "",
    });
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100%",
        padding: 24,
        background: "#f5f7fb",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        {/* HEADER */}
        <div
          style={{
            background: "#111827",
            color: "#fff",
            borderRadius: 18,
            padding: 24,
            marginBottom: 20,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 28,
            }}
          >
            🤖 OneNet Assistant
          </h1>

          <p
            style={{
              margin: "8px 0 0",
              color: "#cbd5e1",
            }}
          >
            مساعد OneNet للبحث والعمل على العملاء والكروت
            والفواتير.
          </p>
        </div>

        {/* MESSAGE */}
        {message && (
          <div
            style={{
              background: "#fff",
              border: "1px solid #dbe3ef",
              borderRadius: 12,
              padding: 14,
              marginBottom: 20,
              color: "#334155",
            }}
          >
            {message}
          </div>
        )}

        {/* CUSTOMER + CARD SEARCH */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 20,
            marginBottom: 20,
          }}
        >
          {/* CUSTOMER */}
          <div style={boxStyle}>
            <h2 style={titleStyle}>
              👤 البحث عن عميل
            </h2>

            <div style={rowStyle}>
              <input
                value={customerSearch}
                onChange={(e) =>
                  setCustomerSearch(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    searchCustomer();
                  }
                }}
                placeholder="اسم العميل..."
                style={inputStyle}
              />

              <button
                onClick={searchCustomer}
                disabled={loading}
                style={buttonStyle}
              >
                بحث
              </button>
            </div>

            <div style={{ marginTop: 15 }}>
              {customers.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() =>
                    selectCustomer(customer)
                  }
                  style={{
                    ...listButtonStyle,
                    border:
                      selectedCustomer?.id ===
                      customer.id
                        ? "2px solid #10b981"
                        : "1px solid #e2e8f0",
                  }}
                >
                  <strong>{customer.name}</strong>

                  <span>
                    الرصيد:{" "}
                    {Number(
                      customer.credit_balance || 0,
                    ).toFixed(2)}
                  </span>
                </button>
              ))}
            </div>

            {selectedCustomer && (
              <div
                style={{
                  marginTop: 15,
                  padding: 15,
                  borderRadius: 12,
                  background: "#ecfdf5",
                  color: "#065f46",
                }}
              >
                <strong>
                  العميل المحدد:{" "}
                  {selectedCustomer.name}
                </strong>

                <div>
                  الرصيد:{" "}
                  {Number(
                    selectedCustomer.credit_balance ||
                      0,
                  ).toFixed(2)}
                </div>
              </div>
            )}
          </div>

          {/* CARDS */}
          <div style={boxStyle}>
            <h2 style={titleStyle}>
              💳 البحث عن الكروت
            </h2>

            <div style={rowStyle}>
              <input
                value={cardSearch}
                onChange={(e) =>
                  setCardSearch(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    searchCards();
                  }
                }}
                placeholder="اسم الكرت..."
                style={inputStyle}
              />

              <button
                onClick={searchCards}
                disabled={loading}
                style={buttonStyle}
              >
                بحث
              </button>
            </div>

            <div style={{ marginTop: 15 }}>
              {cards.map((card) => (
                <div
                  key={card.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div>
                    <strong>{card.name}</strong>

                    <div
                      style={{
                        color: "#64748b",
                        fontSize: 13,
                        marginTop: 4,
                      }}
                    >
                      السعر:{" "}
                      {Number(
                        card.selling_price ??
                          card.price ??
                          0,
                      ).toFixed(2)}
                    </div>

                    <div
                      style={{
                        color:
                          Number(
                            card.available_stock || 0,
                          ) > 0
                            ? "#059669"
                            : "#dc2626",
                        fontSize: 13,
                        marginTop: 4,
                      }}
                    >
                      المخزون:{" "}
                      {card.available_stock ?? 0}
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      addCardToInvoice(card)
                    }
                    style={{
                      ...buttonStyle,
                      background: "#0f766e",
                    }}
                  >
                    + إضافة
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* INVOICE BUILDER */}
        <div style={boxStyle}>
          <h2 style={titleStyle}>
            🧾 إنشاء فاتورة
          </h2>

          {!selectedCustomer && (
            <div
              style={{
                background: "#fff7ed",
                color: "#9a3412",
                padding: 12,
                borderRadius: 10,
                marginBottom: 15,
              }}
            >
              اختر العميل أولاً.
            </div>
          )}

          {invoiceForm.items.length > 0 ? (
            <div>
              {invoiceForm.items.map((item) => (
                <div
                  key={item.card_type_id}
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "2fr 100px 120px 100px",
                    gap: 10,
                    alignItems: "center",
                    borderBottom:
                      "1px solid #e2e8f0",
                    padding: "12px 0",
                  }}
                >
                  <div>
                    <strong>{item.name}</strong>
                    <div
                      style={{
                        color: "#64748b",
                        fontSize: 13,
                      }}
                    >
                      السعر: {item.price}
                    </div>
                  </div>

                  <input
                    type="number"
                    min="1"
                    value={item.qty}
                    onChange={(e) =>
                      changeQty(
                        item.card_type_id,
                        e.target.value,
                      )
                    }
                    style={inputStyle}
                  />

                  <strong>
                    {(
                      Number(item.qty) *
                      Number(item.price)
                    ).toFixed(2)}
                  </strong>

                  <button
                    onClick={() =>
                      removeItem(
                        item.card_type_id,
                      )
                    }
                    style={{
                      ...buttonStyle,
                      background: "#dc2626",
                    }}
                  >
                    حذف
                  </button>
                </div>
              ))}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                  marginTop: 20,
                }}
              >
                <div>
                  <label style={labelStyle}>
                    الخصم %
                  </label>

                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={
                      invoiceForm.discount_percent
                    }
                    onChange={(e) =>
                      setInvoiceForm((prev) => ({
                        ...prev,
                        discount_percent:
                          e.target.value,
                      }))
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>
                    المدفوع
                  </label>

                  <input
                    type="number"
                    min="0"
                    value={invoiceForm.paid_amount}
                    onChange={(e) =>
                      setInvoiceForm((prev) => ({
                        ...prev,
                        paid_amount:
                          e.target.value,
                      }))
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>
                    ملاحظة
                  </label>

                  <input
                    value={invoiceForm.note}
                    onChange={(e) =>
                      setInvoiceForm((prev) => ({
                        ...prev,
                        note: e.target.value,
                      }))
                    }
                    placeholder="ملاحظة..."
                    style={inputStyle}
                  />
                </div>
              </div>

              <div
                style={{
                  marginTop: 20,
                  background: "#f8fafc",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={summaryRow}>
                  <span>قبل الخصم</span>
                  <strong>
                    {totalBeforeDiscount.toFixed(2)}
                  </strong>
                </div>

                <div style={summaryRow}>
                  <span>
                    الخصم ({discountPercent}%)
                  </span>
                  <strong>
                    {discountValue.toFixed(2)}
                  </strong>
                </div>

                <div style={summaryRow}>
                  <span>الصافي</span>
                  <strong>
                    {totalAfterDiscount.toFixed(2)}
                  </strong>
                </div>

                <div style={summaryRow}>
                  <span>المدفوع</span>
                  <strong>
                    {paidAmount.toFixed(2)}
                  </strong>
                </div>

                <div
                  style={{
                    ...summaryRow,
                    fontSize: 18,
                    color:
                      remainingAmount > 0
                        ? "#dc2626"
                        : "#059669",
                  }}
                >
                  <span>المتبقي</span>
                  <strong>
                    {remainingAmount.toFixed(2)}
                  </strong>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  marginTop: 20,
                }}
              >
                <button
                  onClick={validateInvoice}
                  disabled={loading}
                  style={{
                    ...buttonStyle,
                    background: "#2563eb",
                  }}
                >
                  فحص الفاتورة
                </button>

                <button
                  onClick={createInvoice}
                  disabled={loading}
                  style={{
                    ...buttonStyle,
                    background: "#059669",
                  }}
                >
                  إنشاء الفاتورة
                </button>

                <button
                  onClick={resetAssistant}
                  style={{
                    ...buttonStyle,
                    background: "#64748b",
                  }}
                >
                  مسح
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                color: "#64748b",
                padding: 20,
                textAlign: "center",
              }}
            >
              لم تتم إضافة أي كروت للفاتورة.
            </div>
          )}
        </div>

        {/* CUSTOMER INVOICES */}
        {selectedCustomer && (
          <div
            style={{
              ...boxStyle,
              marginTop: 20,
            }}
          >
            <h2 style={titleStyle}>
              📋 فواتير {selectedCustomer.name}
            </h2>

            {customerInvoices.length === 0 ? (
              <div style={{ color: "#64748b" }}>
                لا توجد فواتير.
              </div>
            ) : (
              <div
                style={{
                  overflowX: "auto",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse:
                      "collapse",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: "#f8fafc",
                      }}
                    >
                      <th style={thStyle}>
                        الرقم
                      </th>
                      <th style={thStyle}>
                        التاريخ
                      </th>
                      <th style={thStyle}>
                        الإجمالي
                      </th>
                      <th style={thStyle}>
                        المدفوع
                      </th>
                      <th style={thStyle}>
                        المتبقي
                      </th>
                      <th style={thStyle}>
                        الحالة
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {customerInvoices.map(
                      (row) => (
                        <tr key={row.id}>
                          <td style={tdStyle}>
                            {row.number}
                          </td>

                          <td style={tdStyle}>
                            {row.invoice_date}
                          </td>

                          <td style={tdStyle}>
                            {Number(
                              row.total_after_discount ||
                                0,
                            ).toFixed(2)}
                          </td>

                          <td style={tdStyle}>
                            {Number(
                              row.paid_amount || 0,
                            ).toFixed(2)}
                          </td>

                          <td style={tdStyle}>
                            {Number(
                              row.remaining_amount ||
                                0,
                            ).toFixed(2)}
                          </td>

                          <td style={tdStyle}>
                            {row.status}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* GET INVOICE */}
        <div
          style={{
            ...boxStyle,
            marginTop: 20,
          }}
        >
          <h2 style={titleStyle}>
            🔎 البحث عن فاتورة
          </h2>

          <div style={rowStyle}>
            <input
              value={invoiceNumber}
              onChange={(e) =>
                setInvoiceNumber(e.target.value)
              }
              placeholder="INV-000531"
              style={inputStyle}
            />

            <button
              onClick={getInvoice}
              disabled={loading}
              style={buttonStyle}
            >
              جلب الفاتورة
            </button>
          </div>

          {invoice && (
            <div
              style={{
                marginTop: 20,
                background: "#f8fafc",
                borderRadius: 14,
                padding: 18,
              }}
            >
              <h3 style={{ marginTop: 0 }}>
                {invoice.number ||
                  invoice.invoice_number}
              </h3>

              <div>
                العميل:{" "}
                {invoice.customer?.name ||
                  invoice.customer_name ||
                  "-"}
              </div>

              <div>
                الإجمالي:{" "}
                {Number(
                  invoice.total_after_discount ||
                    0,
                ).toFixed(2)}
              </div>

              <div>
                المدفوع:{" "}
                {Number(
                  invoice.paid_amount || 0,
                ).toFixed(2)}
              </div>

              <div>
                المتبقي:{" "}
                {Number(
                  invoice.remaining_amount || 0,
                ).toFixed(2)}
              </div>

              <div>
                الحالة: {invoice.status || "-"}
              </div>

              {Array.isArray(invoice.items) && (
                <div style={{ marginTop: 15 }}>
                  <strong>الأصناف:</strong>

                  {invoice.items.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: 8,
                        borderBottom:
                          "1px solid #e2e8f0",
                      }}
                    >
                      {item.card_name ||
                        item.name ||
                        "-"}{" "}
                      × {item.qty} ={" "}
                      {Number(
                        item.line_total || 0,
                      ).toFixed(2)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================
// STYLES
// =========================================

const boxStyle = {
  background: "#ffffff",
  borderRadius: 18,
  padding: 20,
  boxShadow:
    "0 4px 20px rgba(15, 23, 42, 0.06)",
};

const titleStyle = {
  marginTop: 0,
  marginBottom: 18,
  fontSize: 20,
  color: "#0f172a",
};

const rowStyle = {
  display: "flex",
  gap: 10,
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "11px 12px",
  fontSize: 14,
  outline: "none",
  background: "#fff",
};

const buttonStyle = {
  border: 0,
  borderRadius: 10,
  padding: "10px 18px",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontWeight: 600,
};

const listButtonStyle = {
  width: "100%",
  background: "#fff",
  borderRadius: 10,
  padding: 12,
  marginBottom: 8,
  cursor: "pointer",
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  textAlign: "right",
};

const labelStyle = {
  display: "block",
  marginBottom: 6,
  color: "#475569",
  fontSize: 13,
};

const summaryRow = {
  display: "flex",
  justifyContent: "space-between",
  padding: "7px 0",
};

const thStyle = {
  padding: 10,
  borderBottom: "1px solid #e2e8f0",
  textAlign: "right",
};

const tdStyle = {
  padding: 10,
  borderBottom: "1px solid #e2e8f0",
};
