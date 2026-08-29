/**
 * A container of money the person owns (see `CONTEXT.md`). The API's names pass
 * through unchanged (ADR 0003 translates only three terms, and this is none of
 * them); the hand-written type's job is to pin the contract the OpenAPI document
 * cannot — a closed `type` union, and `userId` dropped because nothing above the
 * adapter needs to know an Account's owner.
 */
export type Account = {
  id: number;
  name: string;
  type: AccountType;

  /**
   * The server's freshly recomputed balance, guarded by an optimistic-
   * concurrency version. Read on every entry and never served from a cache
   * (ADR 0006). May be negative: a credit card owes money (ADR 0005).
   */
  currentBalance: number;

  /** `false` once the Account is retired. Retiring never erases it. */
  isActive: boolean;
};

/**
 * What the person supplies to open a new Account: a name, a type, and a starting
 * balance. `initialBalance` is always sent — the API defaults it to `0` when
 * omitted, but sending it keeps the field's meaning explicit at the seam. It is
 * an amount the person enters, so it is zero or more (ADR 0005): zero is valid
 * for an Account about to be funded, and a card's debt is recorded later as a
 * Transaction, not as a negative opening figure.
 */
export type NewAccount = {
  name: string;
  type: AccountType;
  initialBalance: number;
};

/**
 * The longest an Account name may be. Mirrors the API's `[MaxLength(255)]` on
 * both `CreateAccountRequest.Name` and `UpdateAccountRequest.Name`, so the
 * create and rename forms share one figure.
 */
export const ACCOUNT_NAME_MAX = 255;

/** The five kinds of Account, spelt as the API's `AccountType` enum serialises. */
export type AccountType =
  | 'Cash'
  | 'Bank'
  | 'CreditCard'
  | 'Wallet'
  | 'Investment';

/**
 * How each Account type presents in the list: the word the person reads (the
 * API's `CreditCard` is never shown as one token) and the lucide icon beside it.
 * One entry per type so the two cannot drift apart.
 */
export const ACCOUNT_TYPES: Record<
  AccountType,
  { label: string; icon: string }
> = {
  Cash: { label: 'Cash', icon: 'banknote' },
  Bank: { label: 'Bank', icon: 'landmark' },
  CreditCard: { label: 'Credit card', icon: 'credit-card' },
  Wallet: { label: 'Wallet', icon: 'wallet' },
  Investment: { label: 'Investment', icon: 'trending-up' },
};
