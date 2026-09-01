import { withPinnedTimezone } from '@/testing/timezone';
import {
  budgetPhase,
  startOfCurrentPeriod,
  toCalendarDate,
  toDateOnly,
} from './budget-calendar';

/**
 * The pure calendar arithmetic the Budgets slice owns: the `DateOnly` wire
 * string ↔ calendar `Date` conversion both ways, the start of the current
 * calendar Period (for the create form's self-filling start date), and whether a
 * Budget is live, not yet started, or finished (for the list's three groups).
 *
 * Every case pins a **negative UTC offset** with `withPinnedTimezone`. This is
 * the point of ADR 0011: `new Date("2026-08-01")` parses as UTC midnight, which
 * in any negative offset renders as 31 July, and a spec written only in
 * Asia/Manila (UTC+8) would pass against that broken implementation. Pinning
 * America/New_York makes the wrong-day bug reachable.
 */
describe('budget-calendar', () => {
  const pinTimezone = withPinnedTimezone();
  beforeEach(() => pinTimezone('America/New_York'));

  describe('toCalendarDate', () => {
    it('parses a DateOnly string at local midnight, not UTC midnight', () => {
      const date = toCalendarDate('2026-08-01');

      // The whole ADR: the calendar day is 1 August, in local time, midnight.
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(7); // August
      expect(date.getDate()).toBe(1);
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
    });

    it('does not roll back a day the way new Date(string) would', () => {
      // `new Date('2026-08-01')` is UTC midnight → 2026-07-31T20:00 in New York.
      expect(toCalendarDate('2026-08-01').getDate()).not.toBe(
        new Date('2026-08-01').getDate()
      );
      expect(toCalendarDate('2026-08-01').getDate()).toBe(1);
    });

    it('reads the middle of a month with no offset drift', () => {
      const date = toCalendarDate('2026-02-14');

      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(1);
      expect(date.getDate()).toBe(14);
    });
  });

  describe('toDateOnly', () => {
    it('assembles YYYY-MM-DD from local getters, zero-padded', () => {
      expect(toDateOnly(new Date(2026, 0, 5))).toBe('2026-01-05');
      expect(toDateOnly(new Date(2026, 11, 31))).toBe('2026-12-31');
    });

    it('keeps the local calendar day even close to midnight', () => {
      // 23:30 local on 1 March is already 2 March in UTC; the calendar day is
      // still 1 March and `toISOString()` would get this wrong.
      expect(toDateOnly(new Date(2026, 2, 1, 23, 30))).toBe('2026-03-01');
    });

    it('round-trips with toCalendarDate', () => {
      expect(toDateOnly(toCalendarDate('2026-08-01'))).toBe('2026-08-01');
    });
  });

  describe('startOfCurrentPeriod', () => {
    it('daily: the reference day at midnight', () => {
      expect(startOfCurrentPeriod('daily', new Date(2026, 7, 17, 14, 30))).toEqual(
        new Date(2026, 7, 17)
      );
    });

    it('weekly: back to Monday, with Monday as the week start', () => {
      // 2026-08-19 is a Wednesday → Monday is 2026-08-17.
      expect(
        startOfCurrentPeriod('weekly', new Date(2026, 7, 19, 9, 0))
      ).toEqual(new Date(2026, 7, 17));
    });

    it('weekly: a Sunday belongs to the week that began the previous Monday', () => {
      // 2026-08-23 is a Sunday → its Monday is 2026-08-17, not 2026-08-24.
      expect(startOfCurrentPeriod('weekly', new Date(2026, 7, 23))).toEqual(
        new Date(2026, 7, 17)
      );
    });

    it('weekly: a Monday is already the start', () => {
      expect(startOfCurrentPeriod('weekly', new Date(2026, 7, 17))).toEqual(
        new Date(2026, 7, 17)
      );
    });

    it('monthly: the first of the reference month', () => {
      expect(startOfCurrentPeriod('monthly', new Date(2026, 7, 31))).toEqual(
        new Date(2026, 7, 1)
      );
    });

    it('quarterly: the first day of the calendar quarter', () => {
      expect(startOfCurrentPeriod('quarterly', new Date(2026, 0, 15))).toEqual(
        new Date(2026, 0, 1)
      );
      expect(startOfCurrentPeriod('quarterly', new Date(2026, 4, 20))).toEqual(
        new Date(2026, 3, 1)
      );
      expect(startOfCurrentPeriod('quarterly', new Date(2026, 7, 9))).toEqual(
        new Date(2026, 6, 1)
      );
      expect(startOfCurrentPeriod('quarterly', new Date(2026, 11, 31))).toEqual(
        new Date(2026, 9, 1)
      );
    });

    it('yearly: the first of January', () => {
      expect(startOfCurrentPeriod('yearly', new Date(2026, 6, 4))).toEqual(
        new Date(2026, 0, 1)
      );
    });
  });

  describe('budgetPhase', () => {
    // Built inside each test, after `beforeEach` has pinned the zone — a `Date`
    // made in the describe body would carry the runner's own zone instead.
    const today = () => new Date(2026, 7, 15, 11, 0);

    it('is not-started when the start date is in the future', () => {
      expect(
        budgetPhase({ startDate: new Date(2026, 8, 1), endDate: null }, today())
      ).toBe('not-started');
    });

    it('is live when the start date has passed and there is no end', () => {
      expect(
        budgetPhase({ startDate: new Date(2026, 6, 1), endDate: null }, today())
      ).toBe('live');
    });

    it('is live on the start day itself', () => {
      expect(
        budgetPhase(
          { startDate: new Date(2026, 7, 15), endDate: null },
          today()
        )
      ).toBe('live');
    });

    it('is live while today is inside the window', () => {
      expect(
        budgetPhase(
          { startDate: new Date(2026, 6, 1), endDate: new Date(2026, 8, 30) },
          today()
        )
      ).toBe('live');
    });

    it('is live on the end day itself — the last day still counts', () => {
      expect(
        budgetPhase(
          { startDate: new Date(2026, 6, 1), endDate: new Date(2026, 7, 15) },
          today()
        )
      ).toBe('live');
    });

    it('is finished once the end date is past', () => {
      expect(
        budgetPhase(
          { startDate: new Date(2026, 6, 1), endDate: new Date(2026, 7, 14) },
          today()
        )
      ).toBe('finished');
    });

    it('compares on calendar days, ignoring the time of day on the reference', () => {
      const lateInDay = new Date(2026, 7, 15, 23, 59);
      expect(
        budgetPhase(
          { startDate: new Date(2026, 7, 15), endDate: new Date(2026, 7, 15) },
          lateInDay
        )
      ).toBe('live');
    });
  });
});
