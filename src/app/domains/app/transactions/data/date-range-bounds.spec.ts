import { withPinnedTimezone } from '@/testing/timezone';
import { toRequestDateBounds } from './date-range-bounds';

/** A calendar day at local midnight — what the range picker hands back. */
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

  describe('at a negative UTC offset (America/Panama, a fixed −05:00, no DST)', () => {
    beforeEach(() => pinTimezone('America/Panama'));

    it('sends each bound as local midnight carrying the local offset, never a bare date', () => {
      const bounds = toRequestDateBounds(day(2026, 9, 1), day(2026, 9, 30));

      // `from` is the picked start day at local midnight…
      expect(bounds.from).toBe('2026-09-01T00:00:00-05:00');
      // …and `to` is the day *after* the inclusive end day, because the API's
      // `to` is exclusive — the whole of 30 September must still be in range.
      expect(bounds.to).toBe('2026-10-01T00:00:00-05:00');
    });

    it('names the calendar day, not just the moment — a toISOString() range would not', () => {
      const bounds = toRequestDateBounds(day(2026, 9, 1), day(2026, 9, 1));

      // `2026-09-01T00:00:00-05:00`, not `2026-09-01T05:00:00Z`: same instant,
      // different wall-clock reading, and the API filters a generated frame
      // against the wall-clock. The offset must be a `±HH:MM`, never `Z`.
      expect(bounds.from).toMatch(/[+-]\d{2}:\d{2}$/);
      expect(bounds.from).not.toContain('Z');
      expect(bounds.from).toBe('2026-09-01T00:00:00-05:00');
      expect(bounds.to).toBe('2026-09-02T00:00:00-05:00');
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
      expect(toRequestDateBounds(day(2026, 9, 1), null)).toEqual({
        from: '2026-09-01T00:00:00-05:00',
      });
      expect(toRequestDateBounds(null, day(2026, 9, 30))).toEqual({
        to: '2026-10-01T00:00:00-05:00',
      });
      expect(toRequestDateBounds(null, null)).toEqual({});
    });

    it('carries the same offset on both ends', () => {
      const bounds = toRequestDateBounds(day(2026, 9, 1), day(2026, 9, 30));

      const offsetOf = (stamp: string) => stamp.slice(-6);
      expect(offsetOf(bounds.from!)).toBe(offsetOf(bounds.to!));
    });

    it('drops both ends when the range is inverted, so no 400 can reach the screen', () => {
      expect(toRequestDateBounds(day(2026, 9, 30), day(2026, 9, 1))).toEqual({});
    });

    it('keeps a single-day range where the two ends fall on the same day', () => {
      const bounds = toRequestDateBounds(day(2026, 9, 15), day(2026, 9, 15));

      expect(bounds.from).toBe('2026-09-15T00:00:00-05:00');
      expect(bounds.to).toBe('2026-09-16T00:00:00-05:00');
    });
  });

  it('still works at a positive offset, just where the toISOString() bug would hide', () => {
    pinTimezone('Asia/Manila'); // DST-free +08:00

    expect(toRequestDateBounds(day(2026, 9, 1), day(2026, 9, 30))).toEqual({
      from: '2026-09-01T00:00:00+08:00',
      to: '2026-10-01T00:00:00+08:00',
    });
  });
});
