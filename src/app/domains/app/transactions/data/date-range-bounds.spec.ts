import { withPinnedTimezone } from '@/testing/timezone';
import { toRequestDateBounds } from './date-range-bounds';

/** The first of a month at local midnight — what the range picker hands back. */
function day(year: number, month1: number, date: number): Date {
  return new Date(year, month1 - 1, date);
}

/**
 * The read-path conversion #65 exists for: the person picks inclusive calendar
 * days, and each bound leaves as an **offset-bearing** local-midnight timestamp,
 * with the inclusive end day turned into the API's exclusive `to` (endDay + 1).
 *
 * Pinned to a **negative** UTC offset for every case, because that is where a
 * `toISOString()` implementation fails: east of UTC the wall-clock and the
 * instant land on the same calendar day and the bug is invisible, so a spec
 * written only in Asia/Manila would pass against the broken version.
 */
describe('toRequestDateBounds', () => {
  const pinTimezone = withPinnedTimezone();

  describe('at a negative UTC offset (America/New_York, −05:00 in January)', () => {
    beforeEach(() => pinTimezone('America/New_York'));

    it('sends each bound as local midnight carrying the local offset, never a bare date', () => {
      const bounds = toRequestDateBounds(day(2026, 1, 1), day(2026, 1, 31));

      // `from` is the picked start day at local midnight…
      expect(bounds.from).toBe('2026-01-01T00:00:00-05:00');
      // …and `to` is the day *after* the inclusive end day, because the API's
      // `to` is exclusive — the whole of 31 January must still be in range.
      expect(bounds.to).toBe('2026-02-01T00:00:00-05:00');
    });

    it('names the calendar day, not just the moment — a toISOString() range would not', () => {
      const bounds = toRequestDateBounds(day(2026, 1, 1), day(2026, 1, 1));

      // `2026-01-01T00:00:00-05:00`, not `2026-01-01T05:00:00Z`: same instant,
      // different wall-clock reading, and the API filters a generated frame
      // against the wall-clock. The offset must be a `±HH:MM`, never `Z`.
      expect(bounds.from).toMatch(/[+-]\d{2}:\d{2}$/);
      expect(bounds.from).not.toContain('Z');
      expect(bounds.from).toBe('2026-01-01T00:00:00-05:00');
      expect(bounds.to).toBe('2026-01-02T00:00:00-05:00');
    });

    it('rolls the exclusive end across a month and a year boundary through local getters', () => {
      expect(toRequestDateBounds(null, day(2026, 1, 31)).to).toBe(
        '2026-02-01T00:00:00-05:00'
      );
      expect(toRequestDateBounds(null, day(2026, 12, 31)).to).toBe(
        '2027-01-01T00:00:00-05:00'
      );
    });

    it('keeps each end independently optional', () => {
      expect(toRequestDateBounds(day(2026, 1, 1), null)).toEqual({
        from: '2026-01-01T00:00:00-05:00',
      });
      expect(toRequestDateBounds(null, day(2026, 1, 31))).toEqual({
        to: '2026-02-01T00:00:00-05:00',
      });
      expect(toRequestDateBounds(null, null)).toEqual({});
    });

    it('drops both ends when the range is inverted, so no 400 can reach the screen', () => {
      expect(
        toRequestDateBounds(day(2026, 1, 31), day(2026, 1, 1))
      ).toEqual({});
    });

    it('keeps a single-day range where the two ends fall on the same day', () => {
      const bounds = toRequestDateBounds(day(2026, 1, 15), day(2026, 1, 15));

      expect(bounds.from).toBe('2026-01-15T00:00:00-05:00');
      expect(bounds.to).toBe('2026-01-16T00:00:00-05:00');
    });
  });

  it('carries one shared offset on both ends even when the range straddles a DST change', () => {
    // US DST ends 2026-11-01: −04:00 (EDT) before, −05:00 (EST) after. One
    // range, one zone — the API 400s a from/to offset mismatch — so both bounds
    // take the offset in force at the *start* of the range.
    pinTimezone('America/New_York');

    const bounds = toRequestDateBounds(day(2026, 10, 25), day(2026, 11, 5));

    expect(bounds.from).toBe('2026-10-25T00:00:00-04:00');
    expect(bounds.to).toBe('2026-11-06T00:00:00-04:00');
  });

  it('still works at a positive offset, just where the bug would hide', () => {
    pinTimezone('Asia/Manila'); // DST-free +08:00

    expect(
      toRequestDateBounds(day(2026, 1, 1), day(2026, 1, 31))
    ).toEqual({
      from: '2026-01-01T00:00:00+08:00',
      to: '2026-02-01T00:00:00+08:00',
    });
  });
});
