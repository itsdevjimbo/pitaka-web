import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GoalContributionsService } from '@/app/domains/app/goals';
import {
  TransactionSplitFailure,
  TransactionSplitIdempotencyMismatchError,
  TransactionSplitPayload,
  TransactionSplitRefusalError,
  TransactionSplitResult,
  TransactionSplitValidationError,
} from '../data/transaction-split';
import { TransactionsService } from '../data/transactions.service';
import { TransactionSplitContextStore } from './transaction-split-context';

export const TRANSACTION_SPLIT_IDEMPOTENCY_KEY = new InjectionToken<() => string>('TRANSACTION_SPLIT_IDEMPOTENCY_KEY', {
  factory: () => () => crypto.randomUUID(),
});

export const UNCERTAIN_SPLIT_MESSAGE =
  "We couldn't confirm whether the contribution was created. Retry safely to check.";
export const REFUSED_SPLIT_MESSAGE = "We couldn't save your contributions. Nothing was created.";

export type TransactionSplitAttempt = {
  key: string;
  payload: TransactionSplitPayload;
};

type SplitKeyProvenance = 'fresh' | 'replay';

export type TransactionSplitRecoveryState =
  | { status: 'idle' }
  | { status: 'pending'; attempt: TransactionSplitAttempt }
  | {
      status: 'validation-error';
      attempt: TransactionSplitAttempt;
      error: TransactionSplitValidationError;
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
      freshKeyCollision: boolean;
      message: string;
    }
  | {
      status: 'confirmed';
      attempt: TransactionSplitAttempt;
      historicalResult: TransactionSplitResult;
      refresh: 'succeeded' | 'failed';
    };

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
  readonly unresolved = computed(() => {
    const status = this.current().status;
    return status === 'pending' || status === 'uncertain' || status === 'idempotency-mismatch';
  });

  /** Start a new dialog session only after any earlier operation has a definitive outcome. */
  prepareForDialog(): boolean {
    if (this.unresolved()) return false;
    this.current.set({ status: 'idle' });
    return true;
  }

  /** Start a fresh operation unless an earlier operation is still unresolved. */
  async submit(payload: TransactionSplitPayload): Promise<boolean> {
    if (this.unresolved()) return false;

    const attempt: TransactionSplitAttempt = {
      key: this.createKey(),
      payload: copyPayload(payload),
    };
    await this.run(attempt, 'fresh');
    return true;
  }

  /** Explicitly replay the retained operation; never called automatically. */
  async retryUncertain(): Promise<boolean> {
    const state = this.current();
    if (state.status !== 'uncertain') return false;
    await this.run(state.attempt, 'replay');
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
    await this.run({ key: state.attempt.key, payload: copyPayload(originalPayload) }, 'replay');
    return true;
  }

  /** Replace a freshly generated key that the server reports already belongs to another payload. */
  async retryFreshKeyCollision(): Promise<boolean> {
    const state = this.current();
    if (state.status !== 'idempotency-mismatch' || !state.freshKeyCollision) return false;
    await this.run({ key: this.createKey(), payload: copyPayload(state.attempt.payload) }, 'fresh');
    return true;
  }

  private async run(attempt: TransactionSplitAttempt, keyProvenance: SplitKeyProvenance): Promise<void> {
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
      await this.handleFailure(attempt, error, keyProvenance);
    }
  }

  private async handleFailure(
    attempt: TransactionSplitAttempt,
    error: unknown,
    keyProvenance: SplitKeyProvenance,
  ): Promise<void> {
    if (error instanceof TransactionSplitValidationError) {
      this.current.set({
        status: 'validation-error',
        attempt,
        error,
      });
      return;
    }

    if (error instanceof TransactionSplitIdempotencyMismatchError) {
      const freshKeyCollision = keyProvenance === 'fresh';
      this.current.set({
        status: 'idempotency-mismatch',
        attempt,
        freshKeyCollision,
        message: freshKeyCollision
          ? 'This new recovery key was already used for different contribution details. Try again with a new key.'
          : 'This recovery key belongs to different contribution details. Resolve the original operation first.',
      });
      return;
    }

    if (error instanceof TransactionSplitRefusalError) {
      const failures = [...error.failures];
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
