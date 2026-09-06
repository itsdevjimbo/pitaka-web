import { sumPesos } from '@/app/core/money';
import { Period } from './budget';

/**
 * The calendar arithmetic the Budgets slice owns, kept pure and in one place —
 * the position `offset-timestamp.ts` occupies for Transactions (ADR 0011).
 *
 * A Budget's `startDate` and `endDate` are calendar days, not instants: the day
 * a Budget begins and the day it stops, as written on a calendar. They cross the
 * wire as `DateOnly` strings (`"2026-08-30"`) and must be parsed at **local
 * midnight**, never by handing the string to `new Date()` — which reads a
 * date-only string as UTC midnight and, in any negative UTC offset, renders the
 * day before. ADR 0011 has the full reasoning and why this deliberately departs
 * from ADR 0007's rule for date-*times*.
 */

/** Which of the list's three groups a Budget falls in, from its dates alone. */
export type BudgetPhase = 'live' | 'not-started' | 'finished';

/**
 * Parse a `DateOnly` wire string to a `Date` at local midnight, built from the
 * string's own year, month and day. `"2026-08-01"` becomes the first of August
 * in local time — never 31 July, which `new Date("2026-08-01")` would give west
 * of UTC.
 */
export function toCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Reassemble a `"YYYY-MM-DD"` `DateOnly` string from a `Date`'s local getters,
 * the reverse of {@link toCalendarDate}. Never `toISOString()`, which converts
 * to UTC first and reintroduces the same off-by-a-day in the other direction.
 */
export function toDateOnly(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}`
  );
}

/**
 * The first day of the calendar Period `reference` falls in, at local midnight —
 * what the create form seeds its start date with once a Period is chosen (ADR
 * 0012: Cycles follow the calendar, not the start day). Weekly runs Monday to
 * Sunday, so a Sunday belongs to the week that began the previous Monday.
 */
export function startOfCurrentPeriod(period: Period, reference: Date): Date {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const day = reference.getDate();

  switch (period) {
    case 'daily':
      return new Date(year, month, day);
    case 'weekly': {
      // `getDay()` is 0 (Sunday) … 6 (Saturday); shift so Monday is 0, then
      // step back that many days — arithmetic `Date` normalises across months.
      const fromMonday = (new Date(year, month, day).getDay() + 6) % 7;
      return new Date(year, month, day - fromMonday);
    }
    case 'monthly':
      return new Date(year, month, 1);
    case 'quarterly':
      return new Date(year, month - (month % 3), 1);
    case 'yearly':
      return new Date(year, 0, 1);
  }
}

/**
 * Whether a Budget is live, not yet started, or finished, relative to `today`.
 * The comparison is by calendar day — the time of day on `today` is dropped — so
 * the start day and the end day both read as live. A Budget with no `endDate`
 * never finishes.
 */
export function budgetPhase(
  budget: { startDate: Date; endDate: Date | null },
  today: Date
): BudgetPhase {
  const midnight = startOfDay(today).getTime();

  if (startOfDay(budget.startDate).getTime() > midnight) {
    return 'not-started';
  }
  if (
    budget.endDate !== null &&
    startOfDay(budget.endDate).getTime() < midnight
  ) {
    return 'finished';
  }
  return 'live';
}

/** Strip the time of day, keeping the local calendar day. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** What is left of a Budget's ceiling once the Cycle's Spent figure is taken off. */
export type BudgetRemaining = {
  /**
   * The ceiling minus what the Cycle has spent. Negative when the Budget is
   * overspent — never clamped to zero, so the row can say how far over (ADR
   * 0006: a balance-class figure the person acts on; a Spent figure that
   * disagreed with its ceiling would be worse than none).
   */
  left: number;

  /** `true` once the Cycle's spending has passed the ceiling. */
  overspent: boolean;

  /**
   * How far past the ceiling the Cycle has spent, as a positive figure — `0`
   * unless `overspent`. The row shows this rather than negating `left` itself,
   * so the overspent edge stays in one place.
   */
  overspentBy: number;
};

/**
 * Read a Budget's Spent figure against its ceiling: what is left (negative when
 * overspent), whether it is overspent, and by how much. A few subtractions
 * today, but they live here beside the rest of the slice's arithmetic rather
 * than in the template, so the overspent edge has one home and a test (the
 * ticket's steer once this grows past a line or two).
 *
 * `left` is summed through {@link sumPesos}, not a bare `-`: this is a
 * balance-class figure the person acts on (ADR 0006), and it must not land on
 * `-199.99999999999998` for a ceiling and Spent that both have two decimals.
 */
export function budgetRemaining(budget: {
  amountLimit: number;
  amountSpent: number;
}): BudgetRemaining {
  const left = sumPesos([budget.amountLimit, -budget.amountSpent]);

  return {
    left,
    overspent: left < 0,
    overspentBy: left < 0 ? -left : 0,
  };
}
