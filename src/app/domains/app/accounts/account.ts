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
   * concurrency version. Read on every entry and never served from a cache — a
   * stale figure in a money app is trust-ending (issue #6). May be negative: a
   * credit card can owe money.
   */
  currentBalance: number;

  /** `false` once the Account is retired. Retiring never erases it. */
  isActive: boolean;
};

/** The five kinds of Account, spelt as the API's `AccountType` enum serialises. */
export type AccountType =
  | 'Cash'
  | 'Bank'
  | 'CreditCard'
  | 'Wallet'
  | 'Investment';

/** How each Account type reads in the UI. */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  Cash: 'Cash',
  Bank: 'Bank',
  CreditCard: 'Credit card',
  Wallet: 'Wallet',
  Investment: 'Investment',
};

/** The lucide icon that stands in for each Account type in the list. */
export const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  Cash: 'banknote',
  Bank: 'landmark',
  CreditCard: 'credit-card',
  Wallet: 'wallet',
  Investment: 'trending-up',
};
