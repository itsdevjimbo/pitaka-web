import { withPinnedTimezone } from '@/testing/timezone';
import { parseTransactionDate } from './parse-transaction-date';

/**
 * Reading the wire `transactionDate` back to an instant. The hard case is a
 * string with no zone designator: for a person-recorded Transaction it names a
 * UTC instant that lost its `Z` on the API's MySQL round-trip, for a generated
 * one it is a bare wall-clock day (ADR 0007). Pure, so the process timezone is
 * pinned per case and restored afterwards.
 */
describe('parseTransactionDate', () => {
  const pinTimezone = withPinnedTimezone();

  it('reads a naive person-recorded timestamp as UTC, converting to local time', () => {
    pinTimezone('Asia/Manila'); // fixed, DST-free +08:00

    const date = parseTransactionDate('2026-08-31T05:00:00', false);

    // 05:00 UTC is 13:00 in Manila — the 1 PM the person entered, not 5 AM.
    expect(date.getHours()).toBe(13);
    expect(date.getMinutes()).toBe(0);
    expect(date.getDate()).toBe(31);
  });

  it('honours an explicit Z designator as the instant it names', () => {
    pinTimezone('Asia/Manila');

    const date = parseTransactionDate('2026-08-31T05:00:00Z', false);

    expect(date.getHours()).toBe(13);
    expect(date.getDate()).toBe(31);
  });

  it('honours an explicit numeric offset', () => {
    pinTimezone('Asia/Manila');

    const date = parseTransactionDate('2026-08-31T13:00:00+05:30', false);

    // 13:00 at +05:30 is 15:30 in Manila.
    expect(date.getHours()).toBe(15);
    expect(date.getMinutes()).toBe(30);
  });

  it('reads a naive generated timestamp as a local wall-clock day', () => {
    pinTimezone('America/New_York'); // west of UTC — a UTC read would roll back a day

    const date = parseTransactionDate('2026-08-31T00:00:00', true);

    // The bare midnight day is kept as written, not pulled back to 30 Aug.
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7); // August
    expect(date.getDate()).toBe(31);
    expect(date.getHours()).toBe(0);
  });

  it('still honours a designator on a generated timestamp', () => {
    pinTimezone('America/New_York');

    const date = parseTransactionDate('2026-08-31T00:00:00Z', true);

    expect(date.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
});
