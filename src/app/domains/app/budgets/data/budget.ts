/**
 * A recurring spending ceiling for one Cycle, optionally narrowed to a single
 * Category (see `CONTEXT.md`). The API's names pass through unchanged — ADR 0003
 * translates only three terms and this is none of them — so the hand-written
 * type's job is to pin what the OpenAPI document cannot: a closed `period`
 * union, `startDate` / `endDate` as calendar days rather than instants (ADR
 * 0011), and `description` dropped because nothing above the adapter reads it
 * (the same move `toAccount` makes for an Account's owner id).
 *
 * `GET /api/budgets` also carries `amountSpent`, `cycleStart` and `cycleEnd` —
 * the Spent figure and the server-computed Cycle window (ADR 0012). This slice
 * renders none of them and the service is cold (ADR 0006), so they stay out of
 * the type until the ticket that shows progress needs them.
 */
export type Budget = {
  id: number;
  name: string;

  /** The ceiling, in pesos. What the person entered; always positive (ADR 0005). */
  amountLimit: number;

  period: Period;

  /**
   * The day the Budget begins, as written on a calendar — parsed at local
   * midnight from a `DateOnly` wire string, never handed to `new Date()` (ADR
   * 0011). It has no instant behind it.
   */
  startDate: Date;

  /**
   * The day the Budget stops, same calendar-day treatment as `startDate`.
   * `null` when the API sends no end — such a Budget never reads as finished.
   */
  endDate: Date | null;

  /** The Category the Budget watches, or `null` for a Budget over all spending. */
  categoryId: number | null;
};

/**
 * What the person supplies to create a Budget: the five fields the form offers.
 * `endDate` and `description` are not among them — the API defaults both to
 * absent — and `categoryId` is `null` for a Budget over all spending, a real
 * choice rather than an unfilled one.
 */
export type NewBudget = {
  name: string;
  amountLimit: number;
  period: Period;
  startDate: Date;
  categoryId: number | null;
};

/**
 * How often a Budget renews (see `CONTEXT.md`). `Period` is the API's own word
 * and is not translated (ADR 0003); the members are lowered to match — the way
 * `CategoryKind` lowers `CategoryType` — so the API's `BudgetPeriod` enum
 * (`Daily`, `Weekly`, …) rides the wire and this spelling is used everywhere
 * above the adapter.
 */
export type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * The five Periods in renewal order, each with the word the person reads in the
 * picker. One entry per member so the label and the value cannot drift apart,
 * and `Object.keys` yields them daily-through-yearly for the options list.
 */
export const PERIODS: Record<Period, { label: string }> = {
  daily: { label: 'Daily' },
  weekly: { label: 'Weekly' },
  monthly: { label: 'Monthly' },
  quarterly: { label: 'Quarterly' },
  yearly: { label: 'Yearly' },
};

/**
 * The longest a Budget name may be. Mirrors the API's `[MaxLength(255)]` on
 * `BudgetRequest.Name`.
 */
export const BUDGET_NAME_MAX = 255;

/**
 * The smallest ceiling the API accepts — its `[Range("0.01", …)]` on
 * `BudgetRequest.AmountLimit`. A Budget of zero would forbid all spending, which
 * is not what a ceiling is for.
 */
export const BUDGET_AMOUNT_MIN = 0.01;
