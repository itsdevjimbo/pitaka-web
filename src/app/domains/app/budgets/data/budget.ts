/**
 * A recurring spending ceiling for one Cycle, optionally narrowed to a single
 * Category (see `CONTEXT.md`). The API's names pass through unchanged — ADR 0003
 * translates only three terms and this is none of them — so the hand-written
 * type's job is to pin what the OpenAPI document cannot: a closed `period`
 * union, `startDate` / `endDate` as calendar days rather than instants (ADR
 * 0011), and `description` dropped because nothing above the adapter reads it
 * (the same move `toAccount` makes for an Account's owner id).
 *
 * `GET /api/budgets` also carries the Spent figure and the server-computed
 * Cycle window (ADR 0012); those ride on {@link BudgetWithSpend}, not here,
 * because `POST /api/budgets` returns the bare Budget without them.
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
 * A Budget as `GET /api/budgets` sends it: the config above plus the figures
 * that make it readable as progress. The server resolves both — the client
 * never re-derives the Cycle (ADR 0012) — and the list is read fresh every time
 * rather than cached, the way a balance is (ADR 0006).
 */
export type BudgetWithSpend = Budget & {
  /**
   * What the current Cycle has spent against the ceiling: expenses inside the
   * Cycle that match the Budget's Category (see `CONTEXT.md`, *Spent*). Zero for
   * a Budget that has not started; the finished Budget's is its final Cycle's
   * total.
   */
  amountSpent: number;

  /**
   * The first and last day of the Cycle `amountSpent` covers — the exact window
   * the server summed over, so the figure and its label cannot disagree (ADR
   * 0012). Calendar days, parsed at local midnight like {@link Budget.startDate}
   * (ADR 0011).
   */
  cycleStart: Date;
  cycleEnd: Date;
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
 * What the person supplies to adjust an existing Budget. `PUT /api/budgets/{id}`
 * takes the same `BudgetRequest` as create and writes **every field from what it
 * receives — a full replacement, not a patch** (the hazard `RefileTransaction`
 * documents for a Transaction: an omitted key silently nulls the field it
 * names). So the mutable set travels whole every time: the
 * form offers the same five fields create does, and carries the Budget's current
 * `endDate` through untouched so correcting the ceiling cannot silently clear
 * the end. `description` is the one field that cannot round-trip — the adapter
 * drops it on the way in ({@link Budget} has no `description`) so the client
 * never holds it to send back — and a Budget written through this app has always
 * had it absent, so the `PUT` nulls it and nothing above notices.
 */
export type AdjustBudget = {
  name: string;
  amountLimit: number;
  period: Period;
  startDate: Date;

  /**
   * The Budget's current end, passed straight through from what the list read
   * returned. Not offered for editing (#46) — it rides along only so the
   * full-replacement `PUT` does not wipe it.
   */
  endDate: Date | null;

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
