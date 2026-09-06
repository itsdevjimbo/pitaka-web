import { toOffsetTimestamp } from './offset-timestamp';

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
 * goes out as **local midnight on that day, stamped with its UTC offset** —
 * `2026-09-01T00:00:00-05:00`, never a bare `2026-09-01` (the API requires a
 * zone designator) and never `toISOString()` (`2026-09-01T05:00:00Z` names the
 * right *moment* and the wrong *day*, and the API reads a generated
 * transaction's bare wall-clock day against that day — silently dropping
 * rule-written rows west of UTC; ADR 0011, ADR 0007).
 *
 * Two conversions the person never sees:
 *
 * - **`to` is exclusive.** The inclusive end day the person picked goes out as
 *   `endDay + 1` at local midnight, so an evening purchase on the last day is
 *   still in range. The `+ 1` is day arithmetic through local getters —
 *   `new Date(y, m, d + 1)` rolls across a month or a year — never string
 *   surgery.
 * - **An inverted range** — start day after end day — drops **both** ends
 *   rather than one (#41): keeping `from` alone would silently widen the list
 *   to "everything after that month" when the person asked for a range. The
 *   client drops it here, before the wire, rather than letting the API's 400
 *   surface as an error screen.
 *
 * Both ends carry the same offset in every case the app can reach: one zone, and
 * two calendar days a day apart do not straddle a DST transition. A range that
 * did straddle one cannot be expressed as two same-offset midnights at all — its
 * true endpoints have different offsets — and the API rejects such a range; the
 * issue and the API's own filter-bounds ADR record that as latent (Manila, the
 * only zone in use, has no DST).
 */
export function toRequestDateBounds(
  from: Date | null,
  to: Date | null
): RequestDateBounds {
  if (from === null && to === null) {
    return {};
  }
  if (
    from !== null &&
    to !== null &&
    startOfDayMillis(from) > startOfDayMillis(to)
  ) {
    return {};
  }

  const bounds: RequestDateBounds = {};
  if (from !== null) {
    bounds.from = toOffsetTimestamp(atMidnight(from));
  }
  if (to !== null) {
    // endDay + 1: `to` is exclusive, so the whole inclusive end day is covered
    // by local midnight of the following day.
    bounds.to = toOffsetTimestamp(atMidnight(to, 1));
  }
  return bounds;
}

/** The `Date` at local midnight `dayOffset` days after `day`'s calendar day. */
function atMidnight(day: Date, dayOffset = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + dayOffset);
}

/** Local-midnight epoch millis, for comparing two picks by calendar day alone. */
function startOfDayMillis(day: Date): number {
  return atMidnight(day).getTime();
}
