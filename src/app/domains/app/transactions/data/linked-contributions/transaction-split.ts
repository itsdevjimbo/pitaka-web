import { ApiError } from '@/app/core/api';
import { LinkedContributionAccount } from './linked-contribution';

const DEFINITIVE_REASONS = [
  'goal_inactive',
  'account_inactive',
  'transaction_ineligible',
  'transaction_missing',
  'transaction_capacity_exceeded',
  'account_headroom_exceeded',
  'concurrent_state_changed',
  'target_overrun_acknowledgement_required',
] as const;

export type TransactionSplitFailureReason = (typeof DEFINITIVE_REASONS)[number];

export type TransactionSplitFailure =
  | {
      reason: 'goal_inactive';
      rowIndex: number;
      goalId: number;
      goalName: string;
    }
  | {
      reason: 'target_overrun_acknowledgement_required';
      rowIndex: number;
      goalId: number;
      currentProgress: number;
      target: number;
      proposedProgress: number;
    }
  | {
      reason: Exclude<TransactionSplitFailureReason, 'goal_inactive' | 'target_overrun_acknowledgement_required'>;
      rowIndex?: undefined;
      goalId?: undefined;
    };

/** Field-level rejection of a split request, normalized at the HTTP boundary. */
export class TransactionSplitValidationError extends Error {
  constructor(readonly fieldErrors: Readonly<Record<string, readonly string[]>>) {
    super('Correct the highlighted contribution details.');
    this.name = 'TransactionSplitValidationError';
  }
}

/** The supplied idempotency key already identifies different semantic input. */
export class TransactionSplitIdempotencyMismatchError extends Error {
  constructor() {
    super('The idempotency key belongs to different contribution details.');
    this.name = 'TransactionSplitIdempotencyMismatchError';
  }
}

/** A definitive atomic refusal: the server established that it created no rows. */
export class TransactionSplitRefusalError extends Error {
  constructor(readonly failures: readonly TransactionSplitFailure[]) {
    super("We couldn't save your contributions. Nothing was created.");
    this.name = 'TransactionSplitRefusalError';
  }
}

/** One ordered Goal row in an atomic Transaction split. */
export type TransactionSplitRow = {
  goalId: number;
  amount: number;
  note: string | null;
  acknowledgeTargetOverrun: boolean;
};

/** The complete semantic payload retained for idempotent recovery. */
export type TransactionSplitPayload = {
  transactionId: number;
  contributionDate: string;
  contributions: readonly TransactionSplitRow[];
};

/** One newly created row returned by a successful split or matching replay. */
export type CreatedTransactionSplitContribution = {
  id: number;
  goalId: number;
  accountId: number;
  transactionId: number;
  amount: number;
  contributionDate: Date;
  note: string | null;
};

/** Historical result saved for the operation, not a current-state promise. */
export type TransactionSplitResult = {
  transactionId: number;
  transactionAmount: number;
  linkedTotal: number;
  remainingCapacity: number;
  account: LinkedContributionAccount;
  contributions: CreatedTransactionSplitContribution[];
};

/** Translate the split endpoint's wire failure shapes into domain failures. */
export function toTransactionSplitError(error: unknown): unknown {
  if (!(error instanceof ApiError)) {
    return error;
  }

  if (error.status === 400) {
    return new TransactionSplitValidationError(error.fieldErrors);
  }
  if (error.status !== 409) {
    return error;
  }
  if (error.details['reason'] === 'idempotency_mismatch') {
    return new TransactionSplitIdempotencyMismatchError();
  }

  const topLevelReason = error.details['reason'];
  const rawFailures = error.details['failures'];
  if (
    error.details['created'] !== false ||
    (topLevelReason !== 'split_rejected' && !isDefinitiveReason(topLevelReason)) ||
    !Array.isArray(rawFailures)
  ) {
    return error;
  }
  const failures = rawFailures.map(toTransactionSplitFailure);
  return failures.every((failure) => failure !== null) ? new TransactionSplitRefusalError(failures) : error;
}

const DEFINITIVE_REASON_SET: ReadonlySet<string> = new Set(DEFINITIVE_REASONS);

function toTransactionSplitFailure(value: unknown): TransactionSplitFailure | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const failure = value as Record<string, unknown>;
  const reason = failure['reason'];
  if (!isDefinitiveReason(reason)) {
    return null;
  }

  if (reason === 'goal_inactive') {
    return typeof failure['rowIndex'] === 'number' &&
      typeof failure['goalId'] === 'number' &&
      typeof failure['goalName'] === 'string'
      ? {
          reason,
          rowIndex: failure['rowIndex'],
          goalId: failure['goalId'],
          goalName: failure['goalName'],
        }
      : null;
  }
  if (reason === 'target_overrun_acknowledgement_required') {
    return typeof failure['rowIndex'] === 'number' &&
      typeof failure['goalId'] === 'number' &&
      typeof failure['currentProgress'] === 'number' &&
      typeof failure['target'] === 'number' &&
      typeof failure['proposedProgress'] === 'number'
      ? {
          reason,
          rowIndex: failure['rowIndex'],
          goalId: failure['goalId'],
          currentProgress: failure['currentProgress'],
          target: failure['target'],
          proposedProgress: failure['proposedProgress'],
        }
      : null;
  }
  return {
    reason: reason as Exclude<
      TransactionSplitFailureReason,
      'goal_inactive' | 'target_overrun_acknowledgement_required'
    >,
  };
}

function isDefinitiveReason(value: unknown): value is TransactionSplitFailureReason {
  return typeof value === 'string' && DEFINITIVE_REASON_SET.has(value);
}
