import { combineDateTime } from './combine-date-time';

/**
 * The pure fold of a day picker and a time picker into one naive moment. The
 * calendar day comes from the first argument, the wall-clock from the second,
 * and nothing finer than a minute survives.
 */
describe('combineDateTime', () => {
  it('takes the calendar day from the date and the wall-clock from the time', () => {
    const day = new Date(2026, 7, 29, 3, 15, 45);
    const time = new Date(2000, 0, 1, 14, 5, 30);

    expect(combineDateTime(day, time)).toEqual(new Date(2026, 7, 29, 14, 5, 0, 0));
  });

  it('drops seconds and milliseconds — the person set minutes', () => {
    const result = combineDateTime(
      new Date(2026, 0, 2),
      new Date(2026, 0, 2, 9, 30, 59, 999)
    );

    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it('keeps midnight as midnight rather than rolling the day', () => {
    const result = combineDateTime(
      new Date(2026, 11, 31),
      new Date(2000, 0, 1, 0, 0)
    );

    expect(result).toEqual(new Date(2026, 11, 31, 0, 0, 0, 0));
  });
});
