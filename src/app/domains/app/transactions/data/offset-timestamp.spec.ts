import { withPinnedTimezone } from '@/testing/timezone';
import { toOffsetTimestamp } from './offset-timestamp';

/**
 * The one date function the record-a-Transaction slice needs: a `Date` becomes
 * an ISO 8601 string that names its UTC offset, because the API rejects a
 * `transactionDate` without one (`[RequiresUtcOffset]`). Pure, so it is tested
 * with the process timezone pinned per case and restored afterwards.
 */
describe('toOffsetTimestamp', () => {
  const pinTimezone = withPinnedTimezone();

  it('keeps the local wall-clock and appends a negative offset west of UTC', () => {
    pinTimezone('America/New_York');

    expect(toOffsetTimestamp(new Date(2026, 0, 15, 9, 5, 3))).toBe(
      '2026-01-15T09:05:03-05:00'
    );
  });

  it('appends a positive, half-hour offset east of UTC', () => {
    pinTimezone('Asia/Kolkata');

    expect(toOffsetTimestamp(new Date(2026, 0, 15, 9, 5, 0))).toBe(
      '2026-01-15T09:05:00+05:30'
    );
  });

  it('stays on the calendar day just before midnight', () => {
    pinTimezone('America/New_York');

    expect(toOffsetTimestamp(new Date(2026, 2, 1, 23, 30, 0))).toBe(
      '2026-03-01T23:30:00-05:00'
    );
  });

  it('stays on the calendar day just after midnight', () => {
    pinTimezone('America/New_York');

    expect(toOffsetTimestamp(new Date(2026, 2, 2, 0, 30, 0))).toBe(
      '2026-03-02T00:30:00-05:00'
    );
  });

  it('reflects the offset in force on each side of a DST boundary', () => {
    // US DST begins 2026-03-08: -05:00 before the change, -04:00 after it.
    pinTimezone('America/New_York');

    expect(toOffsetTimestamp(new Date(2026, 2, 8, 1, 0, 0))).toBe(
      '2026-03-08T01:00:00-05:00'
    );
    expect(toOffsetTimestamp(new Date(2026, 2, 8, 3, 0, 0))).toBe(
      '2026-03-08T03:00:00-04:00'
    );
  });

  it('pads every field to a fixed width', () => {
    pinTimezone('Asia/Kolkata');

    expect(toOffsetTimestamp(new Date(2026, 6, 4, 7, 8, 9))).toBe(
      '2026-07-04T07:08:09+05:30'
    );
  });
});
