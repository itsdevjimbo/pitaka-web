import { ApiError } from '@/app/core/api';

/** One Linked Contribution that prevents its source Transaction's removal. */
export type BlockingLinkedContribution = Readonly<{
  contributionId: number;
  goalId: number;
  goalName: string;
}>;

/** A definitive refusal naming every Linked Contribution that must be deleted. */
export class TransactionHasLinkedContributionsError extends Error {
  constructor(
    readonly transactionId: number,
    readonly linkedContributions: readonly BlockingLinkedContribution[],
  ) {
    super('This Transaction has Linked Contributions.');
    this.name = 'TransactionHasLinkedContributionsError';
  }
}

/** Removal lost a state race and may be attempted again after review. */
export class TransactionRemovalConcurrentStateError extends Error {
  constructor() {
    super('The Transaction changed while removal was being checked.');
    this.name = 'TransactionRemovalConcurrentStateError';
  }
}

/** Translate the removal endpoint's stable ProblemDetails reasons into domain failures. */
export function toTransactionRemovalError(error: unknown, expectedTransactionId: number): unknown {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return error;
  }

  if (error.details['reason'] === 'concurrent_state_changed') {
    return new TransactionRemovalConcurrentStateError();
  }

  if (
    error.details['reason'] !== 'transaction_has_linked_contributions' ||
    error.details['transactionId'] !== expectedTransactionId
  ) {
    return error;
  }

  const linkedContributions = error.details['linkedContributions'];
  if (!Array.isArray(linkedContributions) || linkedContributions.length === 0) {
    return error;
  }

  const blockers: BlockingLinkedContribution[] = [];
  for (const value of linkedContributions) {
    if (!isBlockingLinkedContribution(value)) {
      return error;
    }
    blockers.push(value);
  }

  return new TransactionHasLinkedContributionsError(expectedTransactionId, blockers);
}

function isBlockingLinkedContribution(value: unknown): value is BlockingLinkedContribution {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row['contributionId'] === 'number' &&
    typeof row['goalId'] === 'number' &&
    typeof row['goalName'] === 'string'
  );
}
