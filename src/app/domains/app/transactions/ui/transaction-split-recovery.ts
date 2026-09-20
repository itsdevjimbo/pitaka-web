import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { GoalContributionsService } from '@/app/domains/app/goals';
import { TransactionSplitPayload, TransactionSplitResult } from '../data/transaction-split';
import { TransactionsService } from '../data/transactions.service';
import { TransactionSplitContextStore } from './transaction-split-context';

export const TRANSACTION_SPLIT_IDEMPOTENCY_KEY = new InjectionToken<() => string>('TRANSACTION_SPLIT_IDEMPOTENCY_KEY', {
  factory: () => () => crypto.randomUUID(),
});

export const UNCERTAIN_SPLIT_MESSAGE =
  "We couldn't confirm whether the contribution was created. Retry safely to check.";
export const REFUSED_SPLIT_MESSAGE = "We couldn't save your contributions. Nothing was created.";

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

export type TransactionSplitFailure = Readonly<Record<string, unknown>> & {
  reason: TransactionSplitFailureReason;
  rowIndex?: number;
  goalId?: number;
};

export type TransactionSplitAttempt = {
  key: string;
  payload: TransactionSplitPayload;
};

export type TransactionSplitRecoveryState =
  | { status: 'idle' }
  | { status: 'pending'; attempt: TransactionSplitAttempt }
  | {
      status: 'validation-error';
      attempt: TransactionSplitAttempt;
      fieldErrors: ApiError['fieldErrors'];
    }
  | {
      status: 'refused';
      attempt: TransactionSplitAttempt;
      failures: TransactionSplitFailure[];
      invalidRowIndexes: number[];
      refresh: 'succeeded' | 'failed';
      message: typeof REFUSED_SPLIT_MESSAGE;
    }
  | {
      status: 'uncertain';
      attempt: TransactionSplitAttempt;
      message: typeof UNCERTAIN_SPLIT_MESSAGE;
    }
  | {
      status: 'idempotency-mismatch';
      attempt: TransactionSplitAttempt;
      message: string;
    }
  | {
      status: 'confirmed';
      attempt: TransactionSplitAttempt;
      historicalResult: TransactionSplitResult;
      refresh: 'succeeded' | 'failed';
    };

const DEFINITIVE_REASON_SET: ReadonlySet<string> = new Set(DEFINITIVE_REASONS);

/**
 * Owns one dialog's durable monetary-write attempt. It is intentionally
 * separate from the future form: edits cannot replace an unresolved payload,
 * and only an explicit recovery action can replay it.
 */
@Injectable()
export class TransactionSplitRecoveryStore {
  private readonly transactions = inject(TransactionsService);
  private readonly context = inject(TransactionSplitContextStore);
  private readonly goalContributions = inject(GoalContributionsService);
  private readonly createKey = inject(TRANSACTION_SPLIT_IDEMPOTENCY_KEY);
  private readonly current = signal<TransactionSplitRecoveryState>({ status: 'idle' });

  readonly state = this.current.asReadonly();

  /** Start a fresh operation unless an earlier operation is still unresolved. */
  async submit(payload: TransactionSplitPayload): Promise<boolean> {
    if (this.hasUnresolvedOperation()) return false;

    const attempt: TransactionSplitAttempt = {
      key: this.createKey(),
      payload: copyPayload(payload),
    };
    await this.run(attempt);
    return true;
  }

  /** Explicitly replay the retained operation; never called automatically. */
  async retryUncertain(): Promise<boolean> {
    const state = this.current();
    if (state.status !== 'uncertain') return false;
    await this.run(state.attempt);
    return true;
  }

  /**
   * Resolve a mismatch by replaying the key with the known original semantic
   * payload. The mismatched edited payload is never retried under a new key
   * until this request establishes the original operation's outcome.
   */
  async resolveMismatch(originalPayload: TransactionSplitPayload): Promise<boolean> {
    const state = this.current();
    if (state.status !== 'idempotency-mismatch') return false;
    await this.run({ key: state.attempt.key, payload: copyPayload(originalPayload) });
    return true;
  }

  private hasUnresolvedOperation(): boolean {
    const status = this.current().status;
    return status === 'pending' || status === 'uncertain' || status === 'idempotency-mismatch';
  }

  private async run(attempt: TransactionSplitAttempt): Promise<void> {
    this.current.set({ status: 'pending', attempt });
    try {
      const result = await firstValueFrom(this.transactions.splitLinkedContributions(attempt.payload, attempt.key));
      const refreshed = await this.refreshFacts(attempt);
      this.current.set({
        status: 'confirmed',
        attempt,
        historicalResult: result,
        refresh: refreshed ? 'succeeded' : 'failed',
      });
    } catch (error) {
      await this.handleFailure(attempt, error);
    }
  }

  private async handleFailure(attempt: TransactionSplitAttempt, error: unknown): Promise<void> {
    if (error instanceof ApiError && error.status === 400) {
      this.current.set({
        status: 'validation-error',
        attempt,
        fieldErrors: error.fieldErrors,
      });
      return;
    }

    if (isIdempotencyMismatch(error)) {
      this.current.set({
        status: 'idempotency-mismatch',
        attempt,
        message: 'This recovery key belongs to different contribution details. Resolve the original operation first.',
      });
      return;
    }

    const failures = definitiveFailures(error);
    if (failures !== null) {
      const refreshed = await this.refreshFacts(attempt);
      this.current.set({
        status: 'refused',
        attempt,
        failures,
        invalidRowIndexes: [
          ...new Set(
            failures.map((failure) => failure.rowIndex).filter((index): index is number => typeof index === 'number'),
          ),
        ],
        refresh: refreshed ? 'succeeded' : 'failed',
        message: REFUSED_SPLIT_MESSAGE,
      });
      return;
    }

    // No other failed write response proves rollback. This includes transport
    // failures, generic server failures, and operation_outcome_unknown.
    this.current.set({ status: 'uncertain', attempt, message: UNCERTAIN_SPLIT_MESSAGE });
  }

  private async refreshFacts(attempt: TransactionSplitAttempt): Promise<boolean> {
    try {
      const goalIds = [...new Set(attempt.payload.contributions.map((row) => row.goalId))];
      const [contextReady] = await Promise.all([
        this.context.refresh(),
        ...goalIds.map((goalId) => firstValueFrom(this.goalContributions.list(goalId))),
      ]);
      return contextReady;
    } catch {
      return false;
    }
  }
}

function copyPayload(payload: TransactionSplitPayload): TransactionSplitPayload {
  return {
    transactionId: payload.transactionId,
    contributionDate: payload.contributionDate,
    contributions: payload.contributions.map((row) => ({
      goalId: row.goalId,
      amount: row.amount,
      note: row.note,
      acknowledgeTargetOverrun: row.acknowledgeTargetOverrun,
    })),
  };
}

function isIdempotencyMismatch(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && error.details['reason'] === 'idempotency_mismatch';
}

function definitiveFailures(error: unknown): TransactionSplitFailure[] | null {
  if (!(error instanceof ApiError) || error.status !== 409 || error.details['created'] !== false) return null;

  const topLevelReason = error.details['reason'];
  const rawFailures = error.details['failures'];
  if (
    (topLevelReason !== 'split_rejected' && !isDefinitiveReason(topLevelReason)) ||
    !Array.isArray(rawFailures) ||
    !rawFailures.every(isTransactionSplitFailure)
  ) {
    return null;
  }
  return rawFailures;
}

function isTransactionSplitFailure(value: unknown): value is TransactionSplitFailure {
  return (
    value !== null && typeof value === 'object' && isDefinitiveReason((value as Record<string, unknown>)['reason'])
  );
}

function isDefinitiveReason(value: unknown): value is TransactionSplitFailureReason {
  return typeof value === 'string' && DEFINITIVE_REASON_SET.has(value);
}
