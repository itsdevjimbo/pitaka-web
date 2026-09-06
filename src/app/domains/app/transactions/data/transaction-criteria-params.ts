import { ParamMap } from '@angular/router';
import {
  TransactionCriteria,
  TransactionDirection,
  TRANSACTION_DIRECTIONS,
} from './transaction';

/**
 * The query-string round-trip for the Transactions filter (#41). The URL is the
 * source of truth for {@link TransactionCriteria}: a view worth finding is a
 * view worth keeping, so it survives a refresh, bookmarks, and travels in a
 * link.
 *
 * Two rules shape what the parameters look like and how far they can be
 * trusted:
 *
 * - **They are the person's criteria, not the wire's.** `account`/`category`
 *   rather than `accountId`/`categoryId`; a bare `YYYY-MM-DD` calendar day
 *   rather than the offset-bearing timestamp the API takes; `to` as the
 *   **inclusive** end day the person picked, not the exclusive `endDay + 1` the
 *   adapter sends (`date-range-bounds.ts`). A shared link reads as "groceries on
 *   the credit card in July", not as a wire payload.
 * - **`page` is never carried.** It is a position in a result set, not
 *   something the person filtered by, and a page number over someone else's
 *   matches means nothing to whoever receives the link.
 *
 * {@link criteriaFromQueryParams} is **total**: every value it cannot read — a
 * misspelt direction, a non-numeric id, a date that is not a real calendar day,
 * an inverted range — is treated as absent. The search endpoint 400s on an
 * unparseable `type`, a non-positive id, and `from >= to`; a hand-edited URL
 * must widen the list, never produce a criteria object that provokes that.
 */

const DIRECTION_PARAM = 'direction';
const ACCOUNT_PARAM = 'account';
const CATEGORY_PARAM = 'category';
const NOTE_PARAM = 'note';
const FROM_PARAM = 'from';
const TO_PARAM = 'to';

/**
 * Serialise filter criteria to query parameters — the readable form that goes
 * in the URL. Only a narrowed axis gets a key, so empty criteria serialise to
 * `{}` and clearing a filter drops its parameter. Dates go out as bare local
 * calendar days assembled from local getters (never `toISOString()`, which
 * would shift the day west of UTC — ADR 0011), `to` as the inclusive day the
 * person picked. An inverted range serialises to neither end, the same rule the
 * parser applies.
 *
 * It is the exact inverse of {@link criteriaFromQueryParams} on any value that
 * function would keep: a value it would drop (an unknown direction, a note that
 * is blank once trimmed) is not written here either, so serialise-then-parse is
 * the identity and every serialised URL round-trips.
 */
export function criteriaToQueryParams(
  criteria: TransactionCriteria
): Record<string, string> {
  const params: Record<string, string> = {};

  if (criteria.direction !== undefined && isDirection(criteria.direction)) {
    params[DIRECTION_PARAM] = criteria.direction;
  }
  if (criteria.accountId !== undefined) {
    params[ACCOUNT_PARAM] = String(criteria.accountId);
  }
  if (criteria.categoryId !== undefined) {
    params[CATEGORY_PARAM] = String(criteria.categoryId);
  }
  const note = (criteria.description ?? '').trim();
  if (note !== '') {
    params[NOTE_PARAM] = note;
  }

  const range = orderedRange(criteria.from ?? null, criteria.to ?? null);
  if (range.from) {
    params[FROM_PARAM] = toCalendarDay(range.from);
  }
  if (range.to) {
    params[TO_PARAM] = toCalendarDay(range.to);
  }

  return params;
}

/**
 * Parse filter criteria out of query parameters. Total by construction: an
 * unreadable or unknown value on any axis is dropped, and an absent parameter
 * means that axis is unfiltered. No input can produce a criteria object the
 * search endpoint would reject.
 */
export function criteriaFromQueryParams(
  params: ParamMap
): TransactionCriteria {
  const criteria: TransactionCriteria = {};

  const direction = params.get(DIRECTION_PARAM);
  if (direction !== null && isDirection(direction)) {
    criteria.direction = direction;
  }

  const accountId = toPositiveInt(params.get(ACCOUNT_PARAM));
  if (accountId !== null) {
    criteria.accountId = accountId;
  }

  const categoryId = toPositiveInt(params.get(CATEGORY_PARAM));
  if (categoryId !== null) {
    criteria.categoryId = categoryId;
  }

  const note = (params.get(NOTE_PARAM) ?? '').trim();
  if (note !== '') {
    criteria.description = note;
  }

  const range = orderedRange(
    toCalendarDate(params.get(FROM_PARAM)),
    toCalendarDate(params.get(TO_PARAM))
  );
  if (range.from) {
    criteria.from = range.from;
  }
  if (range.to) {
    criteria.to = range.to;
  }

  return criteria;
}

/**
 * Whether two criteria narrow the list identically — compared through their
 * serialised form, so a `Date` difference that leaves the calendar day
 * unchanged does not count and the check cannot drift from what the URL
 * actually carries.
 */
export function sameCriteria(
  a: TransactionCriteria,
  b: TransactionCriteria
): boolean {
  const left = criteriaToQueryParams(a);
  const right = criteriaToQueryParams(b);
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}

/** Whether a raw string is one of the three directions the search accepts. */
function isDirection(value: string): value is TransactionDirection {
  return Object.prototype.hasOwnProperty.call(TRANSACTION_DIRECTIONS, value);
}

/**
 * A string as a positive integer id, or `null` when it is anything else —
 * empty, non-numeric, zero, negative, fractional, in exponent form, or beyond
 * the safe-integer range. The search endpoint 400s on a non-positive
 * `accountId`/`categoryId`, so a URL carrying one must read as unfiltered.
 */
function toPositiveInt(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * A `YYYY-MM-DD` string as a `Date` at **local midnight** — matching what the
 * range picker yields and what `date-range-bounds.ts` expects downstream — or
 * `null` when the text is not a real calendar day (`2026-13-01`, `2026-02-30`,
 * `garbage`, an ISO instant with a time part). Built from local getters and
 * verified by round-trip, so a rolled-over value like 30 February is rejected
 * rather than silently shifted to 2 March.
 */
function toCalendarDate(raw: string | null): Date | null {
  if (raw === null) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month1 = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(year, month1 - 1, date);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month1 - 1 &&
    parsed.getDate() === date
    ? parsed
    : null;
}

/** Local-midnight `YYYY-MM-DD` for a `Date`, via local getters — never `toISOString()` (ADR 0011). */
function toCalendarDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The two ends of a date range, or `{}` when they are inverted — the same "drop
 * both, not one" rule `toRequestDateBounds` enforces at the wire, applied here
 * so it holds in the URL too (#41). Keeping `from` alone would silently widen
 * the list to "everything after that month" when the person asked for a range.
 * A single end, or a correctly ordered pair, passes through.
 */
function orderedRange(
  from: Date | null,
  to: Date | null
): { from?: Date; to?: Date } {
  if (from !== null && to !== null && from.getTime() > to.getTime()) {
    return {};
  }
  return {
    ...(from !== null ? { from } : {}),
    ...(to !== null ? { to } : {}),
  };
}
