/**
 * Pin the process timezone for the enclosing `describe`, restoring whatever it
 * was after each test. For pure units that read the process zone — a `Date`'s
 * local getters, `getTimezoneOffset()` — so a spec asserts an exact wall-clock
 * and offset instead of whatever zone the runner happens to sit in.
 *
 * Returns a setter: call it inside a test (or a `beforeEach`) with an IANA zone.
 * V8 re-reads `process.env.TZ` on the next `Date`, so a spec can cross zones
 * case by case within one file.
 */
export function withPinnedTimezone(): (zone: string) => void {
  const original = process.env['TZ'];

  afterEach(() => {
    if (original === undefined) {
      delete process.env['TZ'];
    } else {
      process.env['TZ'] = original;
    }
  });

  return (zone: string) => {
    process.env['TZ'] = zone;
  };
}
