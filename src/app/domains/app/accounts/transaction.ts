/**
 * A single recorded movement of money against an Account (see `CONTEXT.md`):
 * income received, an expense paid, or a Transfer between two Accounts the same
 * person owns. This screen is read-only — amount and direction were settled when
 * the Transaction was recorded and are shown, never changed.
 *
 * The hand-written type pins what the OpenAPI document leaves loose and drops
 * what nothing above the adapter reads (`userId`, `accountId`, the raw
 * `isRecurring` flag, `transferToAccountId`).
 */
export type Transaction = {
  id: number;

  /** The API's positive magnitude. The sign a row shows comes from its `direction`. */
  amount: number;

  direction: TransactionDirection;

  /**
   * When the movement is dated, as a `Date` to render in the person's own
   * timezone and never as UTC (ADR 0007). The API sends a real instant with a
   * zone designator and a person-entered wall-clock without one; `new Date()`
   * honours that distinction, and local formatting preserves the calendar day.
   */
  date: Date;

  /**
   * The Category this is filed under, or `null` when it is uncategorised or a
   * Transfer. The name is resolved through the shared reference cache, not
   * carried here — one lookup per list, not one request per row.
   */
  categoryId: number | null;

  /**
   * `true` when a Schedule created this rather than the person — a *generated
   * transaction*. Surfaced because "did I record this, or did the app?" is a
   * real question.
   */
  generated: boolean;

  /** The person's free-text note, or the API's stock line for a generated one. */
  description: string | null;

  /** Free-form labels the person attached, cutting across Categories. */
  tags: readonly Tag[];
};

/** A free-form label on a Transaction (see `CONTEXT.md`). */
export type Tag = {
  id: number;
  name: string;
};

/**
 * Which of the three kinds a Transaction reads as. A view concept, not a rename
 * of the API's `TransactionType` (ADR 0003) — the glossary has no single word
 * for "income vs expense vs transfer", and the spec asks a row to show "the
 * direction". `transfer` is deliberately neither income nor expense: moving
 * money between the person's own Accounts changes where it sits, not how much
 * there is.
 */
export type TransactionDirection = 'income' | 'expense' | 'transfer';

/**
 * How each direction presents on a row: the word the person reads, the lucide
 * icon beside it, and the Tailwind `accent` classes that colour the icon chip
 * (`chip`) and the amount (`amount`) — so income and expense differ by more
 * than a label. The colours come from the semantic money tokens defined once
 * in `styles/base/semantic.css` and are scheme-aware there (ADR 0008). One
 * entry per direction so these cannot drift apart. The sign on the amount is
 * the template's, since it depends on rendering `-amount`.
 */
export const TRANSACTION_DIRECTIONS: Record<
  TransactionDirection,
  { label: string; icon: string; accent: { chip: string; amount: string } }
> = {
  income: {
    label: 'Income',
    icon: 'arrow-down-left',
    accent: {
      chip: 'bg-income/10 text-income',
      amount: 'text-income',
    },
  },
  expense: {
    label: 'Expense',
    icon: 'arrow-up-right',
    accent: {
      chip: 'bg-expense/10 text-expense',
      amount: 'text-expense',
    },
  },
  transfer: {
    label: 'Transfer',
    icon: 'arrow-left-right',
    accent: {
      chip: 'bg-transfer/10 text-transfer',
      amount: 'text-transfer',
    },
  },
};
