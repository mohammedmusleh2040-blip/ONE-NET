export function calcCustomerDebt(openingDebt, invoicesRemaining, unlinkedPayments) {
  let pay = Number(unlinkedPayments || 0);
  const opening = Number(openingDebt || 0);
  const invRem = Number(invoicesRemaining || 0);

  // 1️⃣ خصم السندات العامة من الدين الافتتاحي
  const openingAfter = Math.max(0, opening - pay);
  pay = Math.max(0, pay - opening);

  // 2️⃣ لو تبقى من السند شيء، يخصم من الفواتير
  const invoicesAfter = Math.max(0, invRem - pay);

  return openingAfter + invoicesAfter;
}
