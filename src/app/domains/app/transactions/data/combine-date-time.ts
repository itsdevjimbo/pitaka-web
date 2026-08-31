/**
 * Fold a day picker and a time picker back into one moment: the calendar day
 * from `date`, the wall-clock from `time`. Seconds and milliseconds are dropped
 * — the person set minutes, and a list of `…:00` rows is false precision (ADR
 * 0007).
 *
 * Both the record form and the refile form hold the day and the time apart as
 * their own required controls — an omitted time is not allowed to mean midnight
 * — and recombine here on submit. The result is naive; the adapter stamps it
 * with its UTC offset on the way out (`toOffsetTimestamp`).
 */
export function combineDateTime(date: Date, time: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.getHours(),
    time.getMinutes(),
    0,
    0
  );
}
