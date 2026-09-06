import { convertToParamMap } from '@angular/router';
import { withPinnedTimezone } from '@/testing/timezone';
import { TransactionCriteria } from './transaction';
import {
  criteriaFromQueryParams,
  criteriaToQueryParams,
  sameCriteria,
} from './transaction-criteria-params';

/** A calendar day at local midnight — what the range picker hands back. */
function day(year: number, month1: number, date: number): Date {
  return new Date(year, month1 - 1, date);
}

/** Parse a plain record of query parameters the way the router would hand them over. */
function parse(params: Record<string, string>): TransactionCriteria {
  return criteriaFromQueryParams(convertToParamMap(params));
}

/**
 * The URL round-trip #41 exists for: the person's criteria serialise to
 * readable query parameters and parse back, and the parse is **total** — any
 * value it cannot read is treated as absent, so no hand-edited URL can build a
 * criteria object that would earn a 400 from the search endpoint.
 *
 * Pinned to a **negative** UTC offset for the date cases: that is where a
 * `toISOString()` serialisation drops a day, so a spec written only in
 * Asia/Manila would pass against the broken version (ADR 0011).
 */
describe('transaction criteria <-> query params', () => {
  const pinTimezone = withPinnedTimezone();
  beforeEach(() => pinTimezone('America/Panama')); // fixed -05:00, no DST

  describe('criteriaToQueryParams', () => {
    it('serialises only the narrowed axes, readable names, no wire shaping', () => {
      expect(
        criteriaToQueryParams({
          direction: 'expense',
          accountId: 3,
          categoryId: 7,
          description: 'coffee',
          from: day(2026, 7, 1),
          to: day(2026, 7, 31),
        })
      ).toEqual({
        direction: 'expense',
        account: '3',
        category: '7',
        note: 'coffee',
        from: '2026-07-01',
        // The person's inclusive end day, not the wire's exclusive `endDay + 1`.
        to: '2026-07-31',
      });
    });

    it('serialises empty criteria to no parameters at all', () => {
      expect(criteriaToQueryParams({})).toEqual({});
    });

    it('omits the key for every unset axis', () => {
      expect(criteriaToQueryParams({ direction: 'income' })).toEqual({
        direction: 'income',
      });
    });

    it('writes a date as a bare local calendar day, never an ISO instant', () => {
      const params = criteriaToQueryParams({ from: day(2026, 7, 1) });

      // `2026-07-01`, not `2026-07-01T05:00:00.000Z`: no time, no `Z`, the
      // wall-clock day the person picked.
      expect(params['from']).toBe('2026-07-01');
      expect(params['from']).not.toContain('T');
      expect(params['from']).not.toContain('Z');
    });

    it('never emits a page parameter — it is not a filter axis', () => {
      const params = criteriaToQueryParams({
        direction: 'expense',
        accountId: 3,
      });

      expect(params).not.toHaveProperty('page');
    });

    it('serialises an inverted range to neither end, matching the parser', () => {
      expect(
        criteriaToQueryParams({ from: day(2026, 7, 31), to: day(2026, 7, 1) })
      ).toEqual({});
    });

    it('keeps a single end', () => {
      expect(criteriaToQueryParams({ from: day(2026, 7, 1) })).toEqual({
        from: '2026-07-01',
      });
      expect(criteriaToQueryParams({ to: day(2026, 7, 31) })).toEqual({
        to: '2026-07-31',
      });
    });

    it('drops what the parser would drop, so serialise-then-parse is the identity', () => {
      // A blank note and an unknown direction are not written — the same values
      // `criteriaFromQueryParams` treats as absent.
      expect(
        criteriaToQueryParams({
          description: '   ',
          direction: 'sideways' as never,
        })
      ).toEqual({});
      expect(criteriaToQueryParams({ description: '  coffee  ' })).toEqual({
        note: 'coffee',
      });
    });
  });

  describe('criteriaFromQueryParams', () => {
    it('round-trips a fully narrowed set', () => {
      const criteria: TransactionCriteria = {
        direction: 'expense',
        accountId: 3,
        categoryId: 7,
        description: 'coffee',
        from: day(2026, 7, 1),
        to: day(2026, 7, 31),
      };

      expect(parse(criteriaToQueryParams(criteria))).toEqual(criteria);
    });

    it('reads an absent parameter as an unfiltered axis', () => {
      expect(parse({})).toEqual({});
      expect(parse({ account: '3' })).toEqual({ accountId: 3 });
    });

    it('reads `to` as the inclusive calendar day the URL carries, at local midnight', () => {
      const { to } = parse({ to: '2026-07-31' });

      expect(to).toEqual(day(2026, 7, 31));
      // Not nudged to the wire's exclusive bound on the way in.
      expect(to).not.toEqual(day(2026, 8, 1));
    });

    describe('is total — a junk value on any axis widens rather than breaks', () => {
      it('drops an unknown direction', () => {
        expect(parse({ direction: 'banana' })).toEqual({});
        expect(parse({ direction: '' })).toEqual({});
        expect(parse({ direction: 'Expense' })).toEqual({});
      });

      it('drops a non-positive-integer account or category', () => {
        expect(parse({ account: 'abc' })).toEqual({});
        expect(parse({ account: '-1' })).toEqual({});
        expect(parse({ account: '0' })).toEqual({});
        expect(parse({ account: '1.5' })).toEqual({});
        expect(parse({ account: '1e3' })).toEqual({});
        expect(parse({ category: 'NaN' })).toEqual({});
        expect(parse({ category: '9007199254740993' })).toEqual({});
      });

      it('drops a blank or whitespace-only note', () => {
        expect(parse({ note: '' })).toEqual({});
        expect(parse({ note: '   ' })).toEqual({});
      });

      it('trims a note that has content', () => {
        expect(parse({ note: '  coffee  ' })).toEqual({ description: 'coffee' });
      });

      it('drops a date that is not a real calendar day', () => {
        expect(parse({ from: 'nope' })).toEqual({});
        expect(parse({ from: '2026-13-01' })).toEqual({});
        expect(parse({ from: '2026-02-30' })).toEqual({});
        expect(parse({ from: '2026-07-01T00:00:00Z' })).toEqual({});
        expect(parse({ from: '07/01/2026' })).toEqual({});
      });

      it('keeps the readable axes when another axis is junk', () => {
        expect(
          parse({ direction: 'banana', account: '3', from: 'nope' })
        ).toEqual({ accountId: 3 });
      });
    });

    describe('the date range', () => {
      it('drops both ends when the range is inverted, never just one', () => {
        expect(parse({ from: '2026-07-31', to: '2026-07-01' })).toEqual({});
      });

      it('keeps a valid single end', () => {
        expect(parse({ from: '2026-07-01' })).toEqual({ from: day(2026, 7, 1) });
        expect(parse({ to: '2026-07-31' })).toEqual({ to: day(2026, 7, 31) });
      });

      it('keeps the good end when the other end is junk', () => {
        expect(parse({ from: '2026-07-01', to: 'nope' })).toEqual({
          from: day(2026, 7, 1),
        });
      });

      it('keeps a same-day range', () => {
        expect(parse({ from: '2026-07-15', to: '2026-07-15' })).toEqual({
          from: day(2026, 7, 15),
          to: day(2026, 7, 15),
        });
      });
    });

    it('ignores a stray page parameter — it is not part of the criteria', () => {
      expect(parse({ account: '3', page: '4' })).toEqual({ accountId: 3 });
    });
  });

  describe('sameCriteria', () => {
    it('is true for two criteria that narrow the list identically', () => {
      expect(sameCriteria({}, {})).toBe(true);
      expect(
        sameCriteria(
          { direction: 'expense', accountId: 3 },
          { accountId: 3, direction: 'expense' }
        )
      ).toBe(true);
      // Same calendar day, different `Date` object.
      expect(
        sameCriteria({ from: day(2026, 7, 1) }, { from: day(2026, 7, 1) })
      ).toBe(true);
    });

    it('is false when any axis differs', () => {
      expect(sameCriteria({}, { direction: 'income' })).toBe(false);
      expect(
        sameCriteria({ accountId: 3 }, { accountId: 4 })
      ).toBe(false);
      expect(
        sameCriteria({ from: day(2026, 7, 1) }, { from: day(2026, 7, 2) })
      ).toBe(false);
    });
  });
});
