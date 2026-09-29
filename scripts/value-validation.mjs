export function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}
