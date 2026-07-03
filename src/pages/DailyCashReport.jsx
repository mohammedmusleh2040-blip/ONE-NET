// تأكد من تحديث دالة loadReport بهذا الشكل:
async function loadReport() {
  try {
    // جلب السندات
    const { data: payRows, error: payError } = await supabase
      .from("payments")
      .select("id, amount, invoice_id, note, pay_date, method, is_refund")
      .gte("pay_date", fromDate)
      .lte("pay_date", toDate)
      .neq("method", "from_balance")
      .neq("is_refund", true)
      .order("pay_date", { ascending: false });

    if (payError) console.error("Payment Error:", payError);
    
    // تأكد دائماً أن payRows مصفوفة، استخدم || []
    const safePayRows = payRows || [];

    const invoiceIds = [...new Set(safePayRows.map((p) => p.invoice_id).filter(Boolean))];
    let invoiceMap = {};
    
    if (invoiceIds.length > 0) {
      const { data: invRows } = await supabase.from("invoices").select("id, number").in("id", invoiceIds);
      if (invRows) {
        invoiceMap = Object.fromEntries(invRows.map((i) => [i.id, i.number]));
      }
    }

    const finalPayments = safePayRows.map((p) => ({
      ...p,
      invoice_number: invoiceMap[p.invoice_id] || "-"
    }));

    // جلب المصروفات
    const { data: expRows, error: expError } = await supabase
      .from("expenses")
      .select("*")
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("expense_date", { ascending: false });

    if (expError) console.error("Expense Error:", expError);
    
    const safeExpRows = expRows || [];

    setPayments(finalPayments);
    setExpenses(safeExpRows);
    
    setTotalPayments(finalPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    setTotalExpenses(safeExpRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    
  } catch (err) {
    console.error("Unexpected error:", err);
  }
}
