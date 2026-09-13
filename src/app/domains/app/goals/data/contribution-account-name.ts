import { Account } from '@/app/domains/app/accounts';
import { GoalContribution } from './goal-contribution';

/** A Contribution ready for a Goal history row, with its fresh Account name. */
export type GoalContributionWithAccountName = GoalContribution & {
  accountName: string;
};

/**
 * Join a Goal's freshly read Contribution history to freshly read Accounts.
 * Accounts that own an earmark cannot be deleted, so every returned
 * Contribution must resolve to an Account name.
 */
export function withAccountNames(
  contributions: readonly GoalContribution[],
  accounts: readonly Account[]
): GoalContributionWithAccountName[] {
  const names = new Map(accounts.map((account) => [account.id, account.name]));

  return contributions.map((contribution) => ({
    ...contribution,
    accountName: names.get(contribution.accountId) ?? '',
  }));
}
