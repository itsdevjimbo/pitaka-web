/**
 * Read the wire `transactionDate` back to the instant it names.
 *
 * The API stores every person-recorded Transaction as UTC (`.ToUniversalTime()`
 * on write), but it persists to MySQL, whose `datetime` carries no zone — so a
 * re-read value comes off the wire **without** a `Z`: `"2026-08-31T05:00:00"`
 * still names 05:00 UTC. `new Date` would read that naive string as *local*
 * time, landing a person who set 1 PM in Manila back on 5 AM. The fix is to put
 * the `Z` back before parsing.
 *
 * A generated transaction is the exception: it is a bare wall-clock day, stamped
 * at midnight from a `DateOnly` with no instant behind it, and must be read as
 * that calendar day in local time or a western viewer rolls back to the day
 * before (ADR 0007). `generated` is the reliable signal for "no instant here".
 *
 * A string that already carries a designator — `Z` or `±HH:MM` — is honoured as
 * written on either path: nothing is appended and nothing is stripped.
 */
export function parseTransactionDate(
  wireValue: string,
  generated: boolean
): Date {
  const hasZoneDesignator = /(?:Z|[+-]\d{2}:?\d{2})$/.test(wireValue);

  if (hasZoneDesignator || generated) {
    return new Date(wireValue);
  }

  return new Date(`${wireValue}Z`);
}
