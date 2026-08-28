/**
 * Add peso amounts without floating-point drift. Every amount is a decimal with
 * at most two places (the API stores `decimal(14,2)`), but summing them with `+`
 * can still land on `10000.000000000002`. Round each to whole cents, add as
 * integers, scale back once.
 *
 * The headline total on the Accounts screen is not a place to trust IEEE 754:
 * ADR 0006 frames a wrong number there as trust-ending.
 */
export function sumPesos(amounts: Iterable<number>): number {
  let cents = 0;
  for (const amount of amounts) {
    cents += Math.round(amount * 100);
  }
  return cents / 100;
}
