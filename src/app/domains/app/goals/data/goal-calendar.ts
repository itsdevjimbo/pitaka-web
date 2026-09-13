/**
 * Goals and Contributions cross the wire as DateOnly strings. Read and write
 * them from local calendar fields so a time-zone conversion cannot shift the
 * person's chosen day (ADR 0011).
 */
export function toGoalCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Reassemble a DateOnly string from local calendar fields, never UTC. */
export function toGoalDateOnly(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}`
  );
}
