/**
 * The one place money becomes text. Pitaka is peso-only (ADR 0005): every amount
 * in the app is a bare decimal, and this function is the single token that turns
 * one into a display string. When Pitaka stops being single-currency, this is
 * the only place that changes.
 *
 * Amounts are rendered with the narrow `₱` symbol and two decimal places. A
 * negative figure — a credit card can owe money — keeps its sign.
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
