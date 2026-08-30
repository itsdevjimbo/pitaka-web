/**
 * Format a moment as an ISO 8601 string that names its local UTC offset —
 * `2026-08-29T14:05:00-05:00`.
 *
 * The API's write endpoint rejects a naive `transactionDate` outright: the
 * `[RequiresUtcOffset]` attribute fails any timestamp whose `DateTimeKind` is
 * `Unspecified`, so a value must carry `Z` or a `±HH:MM`. `Date.toISOString()`
 * would satisfy that with `Z`, but by converting to UTC it discards the clock
 * time the person entered; this keeps their local wall-clock and appends the
 * offset that was in force *on that date*, so a DST change on either side of the
 * moment is reflected rather than assumed.
 */
export function toOffsetTimestamp(moment: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');

  // `getTimezoneOffset` counts minutes *behind* UTC — positive when west, the
  // opposite sign of an ISO offset — so flip it: `+` now means east of UTC.
  const offsetMinutes = -moment.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(offsetMinutes);

  const date =
    `${moment.getFullYear()}-` +
    `${pad(moment.getMonth() + 1)}-` +
    `${pad(moment.getDate())}`;
  const time =
    `${pad(moment.getHours())}:` +
    `${pad(moment.getMinutes())}:` +
    `${pad(moment.getSeconds())}`;
  const offset = `${sign}${pad(Math.trunc(magnitude / 60))}:${pad(magnitude % 60)}`;

  return `${date}T${time}${offset}`;
}
