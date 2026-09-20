import { TransactionLinkedContributions } from './linked-contribution';

export type TransactionSplitUnavailableReason =
  'transaction-ineligible' | 'account-inactive' | 'transaction-capacity' | 'account-headroom' | 'no-active-goals';

export type TransactionSplitAvailability =
  | { available: true; reason: null; explanation: null }
  | {
      available: false;
      reason: TransactionSplitUnavailableReason;
      explanation: string;
    };

/** Decide whether current Account and Transaction money can fund a split. */
export function transactionSplitFinancialAvailability(
  snapshot: TransactionLinkedContributions,
): TransactionSplitAvailability {
  if (!snapshot.account.active) {
    return unavailableTransactionSplit(
      'account-inactive',
      "The Transaction's Account is retired and cannot fund a new Linked Contribution.",
    );
  }
  if (snapshot.remainingCapacity <= 0) {
    return unavailableTransactionSplit(
      'transaction-capacity',
      'This Transaction has no remaining capacity for a new Linked Contribution.',
    );
  }
  if (snapshot.account.availableHeadroom <= 0) {
    return unavailableTransactionSplit(
      'account-headroom',
      'This Account has no available headroom for a new Linked Contribution.',
    );
  }
  return { available: true, reason: null, explanation: null };
}

export function unavailableTransactionSplit(
  reason: TransactionSplitUnavailableReason,
  explanation: string,
): TransactionSplitAvailability {
  return { available: false, reason, explanation };
}
