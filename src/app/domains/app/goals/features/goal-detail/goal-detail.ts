import { Component, computed, DestroyRef, ElementRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { forkJoin, map, Observable, of, Subject, switchMap, takeUntil } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { ResourceState, RowNotice } from '@/app/core/notices';
import { AccountsService } from '@/app/domains/app/accounts';
import { Transaction, TransactionLinkedContributions, TransactionsService } from '@/app/domains/app/transactions';
import {
  ContributionDeletionCoordinator,
  Goal,
  GoalContributionWithAccountName,
  GoalContributionsService,
  GoalsService,
  signedAccountHeadroom,
  withAccountNames,
} from '../../index';
import { AddContributionDialog } from '../../ui/contribution-editor/add-contribution-dialog';
import { EditContributionDialog } from '../../ui/contribution-editor/edit-contribution-dialog';
import { ContributionHistoryRow } from '../../ui/contribution-history-row/contribution-history-row';
import { EditGoalDialog } from '../../ui/goal-editor/edit-goal-dialog';
import { GoalProgress } from '../../ui/goal-progress/goal-progress';

const LOAD_FAILED = 'Something went wrong loading this Goal. Please try again.';

/** A Goal's current facts and its complete, account-named Contribution history. */
@Component({
  selector: 'goal-detail',
  templateUrl: './goal-detail.html',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    RouterLink,
    GoalProgress,
    ContributionHistoryRow,
    PesoPipe,
    ResourceState,
    RowNotice,
  ],
  providers: [ContributionDeletionCoordinator],
  host: { class: 'flex flex-auto flex-col' },
})
export default class GoalDetail implements OnInit {
  private goals = inject(GoalsService);
  private contributions = inject(GoalContributionsService);
  private accounts = inject(AccountsService);
  private transactions = inject(TransactionsService);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private contributionDeletion = inject(ContributionDeletionCoordinator);
  private readonly readReset = new Subject<void>();
  private readonly deletePreflightReset = new Subject<void>();

  readonly id = input.required<string>();
  private readonly goalId = computed(() => Number(this.id()));

  protected readonly goal = signal<Goal | null>(null);
  protected readonly history = signal<readonly GoalContributionWithAccountName[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshError = signal(false);
  protected readonly savedStale = signal(false);
  protected readonly stale = computed(() => this.refreshError());
  protected readonly notFound = signal(false);
  protected readonly isEmpty = computed(() => this.history()?.length === 0);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ message: string; retry?: () => void } | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly confirmingAbandon = signal(false);
  protected readonly confirmingDelete = signal<{ count: number } | null>(null);
  protected readonly confirmingContributionDelete = signal<GoalContributionWithAccountName | null>(null);
  protected readonly deletingContributionId = signal<number | null>(null);
  protected readonly linkedSourceSnapshot = signal<TransactionLinkedContributions | null>(null);
  protected readonly ordinaryAccountHeadroom = signal<{ accountName: string; availableAmount: number } | null>(null);
  private successTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.readReset.complete();
      this.deletePreflightReset.complete();
      if (this.successTimer) {
        clearTimeout(this.successTimer);
      }
    });
    this.load();
  }

  /** Read the Goal, its entire history, and the names that make it legible together. */
  protected load(): void {
    if (this.goal() !== null) {
      this.refresh();
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    this.notFound.set(false);

    const id = this.goalId();
    if (!Number.isInteger(id) || id <= 0) {
      this.notFound.set(true);
      this.errorMessage.set('This Goal could not be found.');
      this.loading.set(false);
      return;
    }

    this.readContributionFacts(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ goal, contributions, accounts, sourceTransactions }) => {
          this.goal.set(goal);
          this.history.set(withAccountNames(contributions, accounts, sourceTransactions).sort(byNewestContribution));
          this.loading.set(false);
        },
        error: (error: unknown) => {
          const apiError = error instanceof ApiError ? error : null;
          this.errorMessage.set(apiError ? apiError.message : LOAD_FAILED);
          this.notFound.set(apiError?.status === 404);
          this.loading.set(false);
        },
      });
  }

  protected openEdit(goal: Goal): void {
    this.clearPrompts();
    this.dialog
      .open<EditGoalDialog, Goal, Goal>(EditGoalDialog, { data: goal })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((saved) => {
        if (saved) {
          this.refresh('after-write', () => this.announceSuccess('Goal updated.'));
        }
      });
  }
  protected openAdd(goal: Goal): void {
    this.clearPrompts();
    this.dialog
      .open<AddContributionDialog, Goal, 'saved' | 'missing' | 'abandoned'>(AddContributionDialog, { data: goal })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.afterContributionDialog(result));
  }
  protected openContributionEdit(contribution: GoalContributionWithAccountName): void {
    const goal = this.goal();
    if (!goal) {
      return;
    }
    this.clearPrompts();
    this.dialog
      .open<
        EditContributionDialog,
        { goal: Goal; contribution: GoalContributionWithAccountName },
        'saved' | 'missing' | 'abandoned'
      >(EditContributionDialog, { data: { goal, contribution } })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.afterContributionDialog(result));
  }
  protected askContributionDelete(contribution: GoalContributionWithAccountName): void {
    this.notice.set(null);
    this.confirmingContributionDelete.set(contribution);
    this.focusSafeAction(`cancel-delete-contribution-${contribution.id}`);
  }
  protected cancelContributionDelete(): void {
    const contributionId = this.confirmingContributionDelete()?.id;
    this.confirmingContributionDelete.set(null);
    if (contributionId !== undefined) {
      queueMicrotask(() =>
        this.host.nativeElement.querySelector<HTMLButtonElement>(`[data-contribution-id="${contributionId}"]`)?.focus(),
      );
    }
  }
  protected confirmContributionDelete(): void {
    const contribution = this.confirmingContributionDelete();
    if (!contribution || this.deletingContributionId() !== null) {
      return;
    }
    this.notice.set(null);
    this.deletingContributionId.set(contribution.id);
    this.contributionDeletion
      .attempt(contribution.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deletingContributionId.set(null);
          this.confirmingContributionDelete.set(null);
          this.refreshContributionFacts(contribution, true);
        },
        error: (error) => {
          this.deletingContributionId.set(null);
          this.confirmingContributionDelete.set(null);
          this.notice.set({
            message:
              error instanceof ApiError
                ? error.message
                : 'We could not confirm whether this Contribution was deleted. Refresh safely to check.',
            retry: () => this.refreshContributionFacts(contribution, true),
          });
        },
      });
  }
  protected askAbandon(): void {
    this.notice.set(null);
    this.confirmingDelete.set(null);
    this.confirmingAbandon.set(true);
    this.focusSafeAction('cancel-abandon-goal');
  }
  protected askDelete(): void {
    const goal = this.goal();
    if (!goal) {
      return;
    }
    this.deletePreflightReset.next();
    this.notice.set(null);
    this.confirmingAbandon.set(false);
    this.contributions
      .list(goal.id)
      .pipe(takeUntil(this.deletePreflightReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.confirmingDelete.set({ count: items.length });
          this.focusSafeAction('cancel-delete-goal');
        },
        error: (error) => this.failed(error, () => this.askDelete()),
      });
  }
  protected cancelPrompt(): void {
    this.clearPrompts();
    queueMicrotask(() =>
      this.host.nativeElement.querySelector<HTMLButtonElement>('[aria-label="Goal actions"]')?.focus(),
    );
  }
  protected setStatus(status: Goal['status']): void {
    const goal = this.goal();
    if (!goal || this.busy()) {
      return;
    }
    this.clearPrompts();
    this.write(
      this.goals.setStatus(goal.id, status),
      () => this.refresh('after-write', () => this.announceSuccess(`Goal marked ${status.toLowerCase()}.`)),
      () => this.setStatus(status),
    );
  }
  protected confirmAbandon(): void {
    this.setStatus('Abandoned');
  }
  protected confirmDelete(): void {
    const goal = this.goal();
    if (!goal) {
      return;
    }
    this.clearPrompts();
    this.write(
      this.goals.delete(goal.id),
      () => this.router.navigate(['/app/goals']),
      () => this.confirmDelete(),
    );
  }
  private write(write$: Observable<unknown>, success: () => void, retry: () => void): void {
    this.notice.set(null);
    this.busy.set(true);
    write$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        success();
      },
      error: (error) => {
        this.busy.set(false);
        this.failed(error, retry);
      },
    });
  }
  private failed(error: unknown, retry: () => void): void {
    if (error instanceof ApiError && error.status === 404) {
      this.load();
      return;
    }
    if (error instanceof ApiError && error.status === 403) {
      this.notice.set({ message: 'You can no longer change this Goal.' });
      this.load();
      return;
    }
    this.notice.set({
      message: error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      retry,
    });
  }
  private clearPrompts(): void {
    this.deletePreflightReset.next();
    this.confirmingAbandon.set(false);
    this.confirmingDelete.set(null);
    this.confirmingContributionDelete.set(null);
  }
  private afterContributionDialog(result: 'saved' | 'missing' | 'abandoned' | undefined): void {
    if (result === 'saved') {
      this.refreshContributionFacts(null, false, () => this.announceSuccess('Contribution saved.'));
      return;
    }
    if (result === 'abandoned') {
      this.notice.set({ message: 'This Goal no longer accepts Contributions. Mark it active to add another.' });
      this.load();
      return;
    }
    if (result === 'missing') {
      this.load();
    }
  }

  /** Keep the last complete Goal reading visible while a later read resolves. */
  private refresh(reason: 'ordinary' | 'after-write' = 'ordinary', afterRead?: () => void): void {
    const goal = this.goal();
    if (!goal) {
      this.load();
      return;
    }
    this.readReset.next();
    this.refreshError.set(false);
    this.readContributionFacts(goal.id)
      .pipe(takeUntil(this.readReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ goal: freshGoal, contributions, accounts, sourceTransactions }) => {
          this.goal.set(freshGoal);
          this.history.set(withAccountNames(contributions, accounts, sourceTransactions).sort(byNewestContribution));
          this.savedStale.set(false);
          afterRead?.();
        },
        error: () => {
          this.refreshError.set(true);
          this.savedStale.set(reason === 'after-write');
        },
      });
  }
  /** Reconcile every server-derived Goal fact after a Contribution write without hiding the last readable screen. */
  private refreshContributionFacts(
    deleted: GoalContributionWithAccountName | null = null,
    focusAfterDelete = false,
    afterRead?: () => void,
  ): void {
    const goal = this.goal();
    if (!goal) {
      this.load();
      return;
    }
    this.readReset.next();
    forkJoin({
      facts: this.readContributionFacts(goal.id),
      transaction:
        deleted?.transactionId == null ? of(null) : this.transactions.linkedContributions(deleted.transactionId),
      pooledContributions: deleted && deleted.transactionId === null ? this.contributions.all() : of(null),
    })
      .pipe(takeUntil(this.readReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({
          facts: { goal: freshGoal, contributions, accounts, sourceTransactions },
          transaction,
          pooledContributions,
        }) => {
          const deletedIndex = deleted
            ? Math.max(this.history()?.findIndex((item) => item.id === deleted.id) ?? 0, 0)
            : 0;
          this.notice.set(null);
          this.goal.set(freshGoal);
          this.refreshError.set(false);
          this.savedStale.set(false);
          this.linkedSourceSnapshot.set(transaction);
          this.ordinaryAccountHeadroom.set(
            deleted && pooledContributions
              ? ordinaryDeletionHeadroom(deleted.accountId, accounts, pooledContributions)
              : null,
          );
          this.history.set(withAccountNames(contributions, accounts, sourceTransactions).sort(byNewestContribution));
          if (deleted && focusAfterDelete) {
            this.focusAfterContributionDelete(deletedIndex);
            this.announceSuccess('Contribution deleted.');
          }
          afterRead?.();
        },
        error: () => {
          this.refreshError.set(true);
          this.savedStale.set(true);
          this.notice.set({
            message: 'The Contribution changed but the latest Goal details could not be loaded.',
            retry: () => this.refreshContributionFacts(deleted, focusAfterDelete, afterRead),
          });
        },
      });
  }

  private readContributionFacts(goalId: number) {
    return forkJoin({
      goal: this.goals.get(goalId),
      contributions: this.contributions.list(goalId),
      accounts: this.accounts.all(),
    }).pipe(
      switchMap((facts) => {
        const accountIds = [
          ...new Set(
            facts.contributions
              .filter((contribution) => contribution.transactionId !== null)
              .map((contribution) => contribution.accountId),
          ),
        ];
        const sourceReads = accountIds.map((accountId) => this.transactions.list(accountId));
        return (sourceReads.length ? forkJoin(sourceReads) : of([] as Transaction[][])).pipe(
          map((groups) => ({ ...facts, sourceTransactions: groups.flat() })),
        );
      }),
    );
  }

  private focusSafeAction(id: string): void {
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLButtonElement>(`#${id}`)?.focus());
  }

  private focusAfterContributionDelete(previousIndex: number): void {
    queueMicrotask(() => {
      const actions = this.host.nativeElement.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Contribution actions"]',
      );
      actions[Math.min(previousIndex, actions.length - 1)]?.focus();
      if (actions.length === 0) {
        this.host.nativeElement.querySelector<HTMLElement>('#contributions-heading')?.focus();
      }
    });
  }

  private announceSuccess(message: string): void {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
    }
    this.successMessage.set(message);
    this.successTimer = setTimeout(() => {
      this.successMessage.set(null);
      this.successTimer = null;
    }, 5_000);
  }
}

function ordinaryDeletionHeadroom(
  accountId: number,
  accounts: readonly { id: number; name: string; currentBalance: number }[],
  contributions: readonly { accountId: number; amount: number }[],
): { accountName: string; availableAmount: number } | null {
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    return null;
  }
  const headroom = signedAccountHeadroom(accounts, contributions).find(
    (candidate) => candidate.accountId === accountId,
  );
  return headroom ? { accountName: account.name, availableAmount: headroom.availableAmount } : null;
}

function byNewestContribution(left: GoalContributionWithAccountName, right: GoalContributionWithAccountName): number {
  return right.contributionDate.getTime() - left.contributionDate.getTime() || right.id - left.id;
}
