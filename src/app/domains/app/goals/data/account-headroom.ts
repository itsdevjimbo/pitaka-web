import { sumPesos } from '@/app/core/money';

/** The Account fields needed to calculate how much remains available to earmark. */
type AccountBalance = { id: number; currentBalance: number };

/** The Contribution fields that claim an Account's balance toward any Goal. */
type AccountEarmark = { accountId: number; amount: number };

/** A fresh Account's usable balance after every Goal earmark has been counted. */
export type AccountHeadroom = {
  accountId: number;
  availableAmount: number;
};

/**
 * Project each Account's available amount from fresh Account and pooled
 * Contribution reads. An earmark remains in an Account's balance but cannot be
 * promised to a second Goal, and an Account already over-earmarked never shows
 * a misleading negative available amount.
 */
export function accountHeadroom(
  accounts: readonly AccountBalance[],
  contributions: readonly AccountEarmark[],
): AccountHeadroom[] {
  return signedAccountHeadroom(accounts, contributions).map((account) => ({
    ...account,
    availableAmount: Math.max(0, account.availableAmount),
  }));
}

/** Project each Account's actual signed headroom from fresh server facts. */
export function signedAccountHeadroom(
  accounts: readonly AccountBalance[],
  contributions: readonly AccountEarmark[],
): AccountHeadroom[] {
  const earmarksByAccount = new Map<number, number>();

  for (const contribution of contributions) {
    earmarksByAccount.set(
      contribution.accountId,
      sumPesos([earmarksByAccount.get(contribution.accountId) ?? 0, contribution.amount]),
    );
  }

  return accounts.map((account) => ({
    accountId: account.id,
    availableAmount: sumPesos([account.currentBalance, -(earmarksByAccount.get(account.id) ?? 0)]),
  }));
}
