/**
 * A single recorded movement of money against an Account (see `CONTEXT.md`):
 * income received, an expense paid, or a Transfer between two Accounts the same
 * person owns. This screen is read-only — amount and direction were settled when
 * the Transaction was recorded and are shown, never changed.
 *
 * The hand-written type pins what the OpenAPI document leaves loose and drops
 * what nothing above the adapter reads (`userId`, the raw `isRecurring` flag).
 * The two Account ids are kept: a Transfer is signed against a single Account
 * (see `CONTEXT.md`), and which way it reads depends on whether the Account
 * being viewed is the side it leaves or the side it lands in.
 */
export type Transaction = {
  id: number;

  /** The API's positive magnitude. The sign a row shows comes from its `direction`. */
  amount: number;

  direction: TransactionDirection;

  /**
   * The Account this movement was recorded against — for a Transfer, the side
   * the money leaves. Compared with the Account on screen to sign a Transfer
   * row: a match here means outgoing.
   */
  accountId: number;

  /**
   * The Account a Transfer lands in, or `null` when this is not a Transfer. A
   * match against the Account on screen means the Transfer reads as incoming.
   */
  transferToAccountId: number | null;

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
 * The little an Account brings to recording a Transfer: an id to send and to
 * link to, a name to show in the picker, and whether it is still active. The
 * record form takes a list of these — every Account the person owns — and does
 * the excluding itself (the source, and every retired one), so that safety
 * argument is visible and testable at the form seam rather than upstream.
 *
 * A hand-rolled subset, not an `Account` import: the Transactions domain does
 * not depend on Accounts (ADR 0009), the dependency runs the other way.
 */
export type TransferDestinationAccount = {
  id: number;
  name: string;
  isActive: boolean;
};

/**
 * What a person supplies to record a Transaction: which Account it is against,
 * its direction, a positive amount (the direction carries the sign), the moment
 * it is dated, and then one of the two things the direction decides — a Category
 * for an income or an expense, or a destination Account for a Transfer, never
 * both (ADR 0010).
 *
 * The adapter lowers `direction` to the API's `TransactionType` and stamps
 * `date` with its UTC offset on the way out; the write endpoint is not
 * Account-scoped even though the list is, and carries `accountId` in the body
 * (ADR 0009).
 */
export type NewTransaction = {
  accountId: number;

  direction: TransactionDirection;

  /** A positive magnitude — zero is not a movement. The sign is the direction's. */
  amount: number;

  /** When the movement is dated. Sent carrying its UTC offset, never naive. */
  date: Date;

  /**
   * The Category an income or expense is filed under, or `null` for a Transfer —
   * every Category is a kind of income or expense, so none can classify one
   * (ADR 0010).
   */
  categoryId: number | null;

  /** The Account a Transfer lands in, or `null` when this is not a Transfer. */
  transferToAccountId: number | null;
};

/**
 * What a person may correct about a Transaction that is already recorded: when
 * it is dated, the Category it is filed under, its note, and its Tags. The
 * amount and the direction are settled at recording and are not here — this is
 * re-filing, not editing (see `CONTEXT.md`, ADR 0009).
 *
 * Every field is a full replacement, never a patch. The API's update endpoint
 * writes the Category and the note unconditionally from what it receives, so an
 * omitted key silently nulls them; it leaves Tags alone only when the key is
 * absent and clears them when it is an empty list. The adapter therefore sends
 * the whole set every time, so correcting one field cannot erase another. A
 * caller with no Tag editing surface (this slice has none) passes the
 * Transaction's current `tagIds` straight through, and they survive untouched.
 */
export type RefileTransaction = {
  /** When the movement is dated. Sent carrying its UTC offset, never naive. */
  date: Date;

  /**
   * The Category an income or expense is filed under, or `null` to leave it
   * uncategorised. Always `null` for a Transfer — no Category classifies one
   * (ADR 0010) — and the adapter holds that line on the wire.
   */
  categoryId: number | null;

  /** The person's free-text note, or `null` to clear it. */
  description: string | null;

  /**
   * The ids of every Tag the Transaction should carry afterwards — the full
   * set, not a delta. Sent every time so the list is a replacement; passing the
   * Transaction's existing ids keeps its Tags exactly as they were.
   */
  tagIds: readonly number[];
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
