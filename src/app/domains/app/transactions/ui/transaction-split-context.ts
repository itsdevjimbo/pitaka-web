import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import { Goal, GoalsService } from '@/app/domains/app/goals';
import { TransactionLinkedContributions } from '../data/linked-contribution';
import { Transaction } from '../data/transaction';
import { TransactionsService } from '../data/transactions.service';

export type TransactionSplitUnavailableReason =
  'transaction-ineligible' | 'account-inactive' | 'transaction-capacity' | 'account-headroom' | 'no-active-goals';

export type TransactionSplitAvailability =
  | { available: true; reason: null; explanation: null }
  | {
      available: false;
      reason: TransactionSplitUnavailableReason;
      explanation: string;
    };

/** The fixed source facts and choices a future Transaction-first dialog renders. */
export type TransactionSplitContext = {
  source: Transaction;
  snapshot: TransactionLinkedContributions;
  goals: Goal[];
  availability: TransactionSplitAvailability;
};

/**
 * Non-financial context that may remain visible while a refresh is pending or
 * failed. It excludes balances and capacities so ADR 0006 cannot be violated.
 */
export type TransactionSplitHistoryContext = {
  source: Transaction;
  account: { id: number; name: string };
  linkedContributions: TransactionLinkedContributions['linkedContributions'];
};

/**
 * Read states for the Transaction-first dialog foundation. A refresh failure
 * retains readable history, but not remembered balances or capacities, and is
 * deliberately not `ready`: stale facts must never authorize confirmation.
 */
export type TransactionSplitContextState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'initial-error' }
  | { status: 'ready'; context: TransactionSplitContext }
  | { status: 'refreshing'; history: TransactionSplitHistoryContext }
  | { status: 'refresh-failed'; history: TransactionSplitHistoryContext };

/**
 * Per-dialog state for authoritative Transaction capacity and Active Goal
 * choices. Provide it at the dialog boundary so separate dialogs never share
 * a source Transaction or recovery state.
 */
@Injectable()
export class TransactionSplitContextStore {
  private readonly transactions = inject(TransactionsService);
  private readonly goals = inject(GoalsService);
  private readonly current = signal<TransactionSplitContextState>({
    status: 'idle',
  });
  private source: Transaction | null = null;
  private lastHistory: TransactionSplitHistoryContext | null = null;

  readonly state = this.current.asReadonly();
  readonly canCreate = computed(() => {
    const state = this.current();
    return state.status === 'ready' && state.context.availability.available;
  });

  /** Start or restart the initial read for one fixed source Transaction. */
  load(source: Transaction): Promise<boolean> {
    this.source = source;
    this.lastHistory = null;
    this.current.set({ status: 'loading' });
    return this.read(false);
  }

  /** Retry an initial failure without changing the fixed source Transaction. */
  retry(): Promise<boolean> {
    if (this.source === null) return Promise.resolve(false);
    this.current.set({ status: 'loading' });
    return this.read(false);
  }

  /**
   * Re-read both authoritative capacity and Goal progress. The last context
   * stays visible while refreshing and after failure, but creation remains
   * unavailable until both reads succeed together.
   */
  refresh(): Promise<boolean> {
    const history = this.lastHistory;
    if (this.source === null || history === null) return Promise.resolve(false);
    this.current.set({ status: 'refreshing', history });
    return this.read(true);
  }

  private async read(refresh: boolean): Promise<boolean> {
    const source = this.source;
    if (source === null) return false;

    try {
      const result = await firstValueFrom(
        forkJoin({
          snapshot: this.transactions.linkedContributions(source.id),
          goals: this.goals.list(),
        }),
      );
      const activeGoals = result.goals.filter((goal) => goal.status === 'Active');
      const context: TransactionSplitContext = {
        source,
        snapshot: result.snapshot,
        goals: activeGoals,
        availability: availabilityFor(source, result.snapshot, activeGoals),
      };
      this.lastHistory = historyFrom(context);
      this.current.set({
        status: 'ready',
        context,
      });
      return true;
    } catch {
      const history = this.lastHistory;
      this.current.set(
        refresh && history !== null ? { status: 'refresh-failed', history } : { status: 'initial-error' },
      );
      return false;
    }
  }
}

function historyFrom(context: TransactionSplitContext): TransactionSplitHistoryContext {
  return {
    source: context.source,
    account: {
      id: context.snapshot.account.id,
      name: context.snapshot.account.name,
    },
    linkedContributions: context.snapshot.linkedContributions,
  };
}

function availabilityFor(
  source: Transaction,
  snapshot: TransactionLinkedContributions,
  activeGoals: readonly Goal[],
): TransactionSplitAvailability {
  if (source.direction !== 'income') {
    return unavailable('transaction-ineligible', 'Only income Transactions can fund Linked Contributions.');
  }
  if (!snapshot.account.active) {
    return unavailable(
      'account-inactive',
      "The Transaction's Account is retired and cannot fund a new Linked Contribution.",
    );
  }
  if (snapshot.remainingCapacity <= 0) {
    return unavailable(
      'transaction-capacity',
      'This Transaction has no remaining capacity for a new Linked Contribution.',
    );
  }
  if (snapshot.account.availableHeadroom <= 0) {
    return unavailable('account-headroom', 'This Account has no available headroom for a new Linked Contribution.');
  }
  if (activeGoals.length === 0) {
    return unavailable('no-active-goals', 'There are no Active Goals available for a new Linked Contribution.');
  }
  return { available: true, reason: null, explanation: null };
}

function unavailable(reason: TransactionSplitUnavailableReason, explanation: string): TransactionSplitAvailability {
  return { available: false, reason, explanation };
}
