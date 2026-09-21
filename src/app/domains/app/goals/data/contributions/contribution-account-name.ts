import { Account } from '@/app/domains/app/accounts';
import { Transaction } from '@/app/domains/app/transactions';
import { GoalContribution } from './goal-contribution';

export type GoalContributionSource =
  | { kind: 'ordinary' }
  | {
      kind: 'linked';
      transactionId: number;
      transaction: Pick<Transaction, 'date' | 'description'> | null;
    };

/** A Contribution ready for a Goal history row, with its fresh Account name. */
export type GoalContributionWithAccountName = GoalContribution & {
  accountName: string;
  source: GoalContributionSource;
};

/**
 * Join a Goal's freshly read Contribution history to freshly read Accounts.
 * Accounts that own an earmark cannot be deleted, so every returned
 * Contribution must resolve to an Account name.
 */
export function withAccountNames(
  contributions: readonly GoalContribution[],
  accounts: readonly Account[],
  transactions: readonly Transaction[] = [],
): GoalContributionWithAccountName[] {
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  const sources = new Map(transactions.map((transaction) => [transaction.id, transaction]));

  return contributions.map((contribution) => ({
    ...contribution,
    accountName: names.get(contribution.accountId) ?? '',
    source:
      contribution.transactionId === null
        ? { kind: 'ordinary' as const }
        : {
            kind: 'linked' as const,
            transactionId: contribution.transactionId,
            transaction: sources.get(contribution.transactionId) ?? null,
          },
  }));
}
