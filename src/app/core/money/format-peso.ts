/**
 * The one place money becomes text. Pitaka is peso-only (ADR 0005): every amount
 * in the app is a bare decimal, and this function is the single token that turns
 * one into a display string. When Pitaka stops being single-currency, this is
 * the only place that changes.
 *
 * Amounts render with the narrow `₱` symbol and two decimal places. A derived
 * figure can be negative — an Account's balance owes money when a card is in
 * debt (ADR 0005) — so the minus sign is kept, not rejected.
 */
const PESO = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  currencyDisplay: 'narrowSymbol',
});

/** Format a bare decimal amount as pesos, e.g. `1234.5` → `₱1,234.50`. */
export function formatPeso(amount: number): string {
  return PESO.format(amount);
}
