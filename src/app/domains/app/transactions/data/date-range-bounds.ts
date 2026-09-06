import { formatWithOffset } from './offset-timestamp';

/**
 * The `from`/`to` query parameters a criteria-narrowed search sends, already in
 * the API's shape: offset-bearing ISO timestamps, or absent. Both keys are
 * independently optional.
 */
export type RequestDateBounds = { from?: string; to?: string };

/**
 * Turn the date-range filter's **inclusive calendar days** into the bounds
 * `GET /api/transactions` expects. This is the piece #65 exists on this side to
 * get right, and ADR 0011's `toISOString()` warning applies to it exactly.
 *
 * The person picks a start day and an end day, each independently optional. Each
 * goes out as **local midnight on that day, stamped with a UTC offset** —
 * `2026-09-01T00:00:00-05:00`, never a bare `2026-09-01` (a 400: the API's
 * ADR 0005 requires a zone designator on both bounds) and never `toISOString()`
 * (`2026-09-01T05:00:00Z` names the right *moment* and the wrong *day*, and the
 * API filters a generated transaction's bare wall-clock day against that day —
 * silently dropping rule-written rows west of UTC).
 *
 * Two conversions the person never sees:
 *
 * - **`to` is exclusive.** The inclusive end day the person picked goes out as
 *   `endDay + 1` at local midnight, so an evening purchase on the last day is
 *   still in range. The `+ 1` is day arithmetic through local getters —
 *   `new Date(y, m, d + 1)` rolls across a month or a year — never string
 *   surgery.
 * - **One range, one zone.** The API 400s a `from`/`to` whose offsets differ, so
 *   both bounds take the offset in force at the *start* of the range (or the
 *   sole bound's own offset when only one end is set). Only observable from a
 *   DST zone across a transition; Manila has none, and the ADR records the
 *   capability as latent.
 *
 * An **inverted** range — start day after end day — drops **both** ends rather
 * than one (#41): keeping `from` alone would silently widen the list to
 * "everything after that month" when the person asked for a range. The client
 * drops it here, before the wire, rather than letting the API's 400 surface as
 * an error screen.
 */
export function toRequestDateBounds(
  from: Date | null,
  to: Date | null
): RequestDateBounds {
  if (from === null && to === null) {
    return {};
  }
  if (from !== null && to !== null && startOfDay(from) > startOfDay(to)) {
    return {};
  }

  // The offset both bounds carry: the range's start, or the only end there is.
  const anchor = from ?? (to as Date);
  const offsetMinutes = -anchor.getTimezoneOffset();

  const bounds: RequestDateBounds = {};
  if (from !== null) {
    bounds.from = formatWithOffset(startOfDayDate(from), offsetMinutes);
  }
  if (to !== null) {
    // endDay + 1: `to` is exclusive, so the whole inclusive end day is covered
    // by local midnight of the following day.
    bounds.to = formatWithOffset(
      new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1),
      offsetMinutes
    );
  }
  return bounds;
}

/** The `Date` at local midnight of `day`'s calendar day. */
function startOfDayDate(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

/** Local-midnight epoch millis, for comparing two picks by calendar day alone. */
function startOfDay(day: Date): number {
  return startOfDayDate(day).getTime();
}
