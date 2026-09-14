import { Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { forkJoin, Observable } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { RowNotice } from '@/app/core/notices';
import { AccountsService } from '@/app/domains/app/accounts';
import {
  Goal,
  GoalContributionWithAccountName,
  GoalContributionsService,
  GoalsService,
  withAccountNames,
} from '../../index';
import { AddContributionDialog } from '../../ui/add-contribution-dialog';
import { ContributionHistoryRow } from '../../ui/contribution-history-row';
import { EditContributionDialog } from '../../ui/edit-contribution-dialog';
import { EditGoalDialog } from '../../ui/edit-goal-dialog';
import { GoalProgress } from '../../ui/goal-progress';

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
    RowNotice,
  ],
  host: { class: 'flex flex-auto flex-col' },
})
export default class GoalDetail implements OnInit {
  private goals = inject(GoalsService);
  private contributions = inject(GoalContributionsService);
  private accounts = inject(AccountsService);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  readonly id = input.required<string>();
  private readonly goalId = computed(() => Number(this.id()));

  protected readonly goal = signal<Goal | null>(null);
  protected readonly history = signal<readonly GoalContributionWithAccountName[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly notFound = signal(false);
  protected readonly isEmpty = computed(() => this.history()?.length === 0);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ message: string; retry?: () => void } | null>(null);
  protected readonly confirmingAbandon = signal(false);
  protected readonly confirmingDelete = signal<{ count: number } | null>(null);
  protected readonly confirmingContributionDelete = signal<GoalContributionWithAccountName | null>(null);

  ngOnInit(): void {
    this.load();
  }

  /** Read the Goal, its entire history, and the names that make it legible together. */
  protected load(): void {
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

    forkJoin({
      goal: this.goals.get(id),
      contributions: this.contributions.list(id),
      accounts: this.accounts.all(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ goal, contributions, accounts }) => {
          this.goal.set(goal);
          this.history.set(withAccountNames(contributions, accounts).sort(byNewestContribution));
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
        if (saved) this.load();
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
    if (!goal) return;
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
  }
  protected cancelContributionDelete(): void {
    this.confirmingContributionDelete.set(null);
  }
  protected confirmContributionDelete(): void {
    const contribution = this.confirmingContributionDelete();
    if (!contribution) return;
    this.confirmingContributionDelete.set(null);
    this.write(
      this.contributions.delete(contribution.id),
      () => this.refreshContributionFacts(),
      () => this.askContributionDelete(contribution),
    );
  }
  protected askAbandon(): void {
    this.notice.set(null);
    this.confirmingDelete.set(null);
    this.confirmingAbandon.set(true);
  }
  protected askDelete(): void {
    const goal = this.goal();
    if (!goal) return;
    this.notice.set(null);
    this.confirmingAbandon.set(false);
    this.contributions
      .list(goal.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => this.confirmingDelete.set({ count: items.length }),
        error: (error) => this.failed(error, () => this.askDelete()),
      });
  }
  protected cancelPrompt(): void {
    this.clearPrompts();
  }
  protected setStatus(status: Goal['status']): void {
    const goal = this.goal();
    if (!goal) return;
    this.clearPrompts();
    this.write(
      this.goals.setStatus(goal.id, status),
      () => this.load(),
      () => this.setStatus(status),
    );
  }
  protected confirmAbandon(): void {
    this.setStatus('Abandoned');
  }
  protected confirmDelete(): void {
    const goal = this.goal();
    if (!goal) return;
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
    this.confirmingAbandon.set(false);
    this.confirmingDelete.set(null);
    this.confirmingContributionDelete.set(null);
  }
  private afterContributionDialog(result: 'saved' | 'missing' | 'abandoned' | undefined): void {
    if (result === 'saved') {
      this.refreshContributionFacts();
      return;
    }
    if (result === 'abandoned') {
      this.notice.set({ message: 'This Goal no longer accepts Contributions. Mark it active to add another.' });
      this.load();
      return;
    }
    if (result === 'missing') this.load();
  }
  /** Reconcile every server-derived Goal fact after a Contribution write without hiding the last readable screen. */
  private refreshContributionFacts(): void {
    const goal = this.goal();
    if (!goal) {
      this.load();
      return;
    }
    forkJoin({
      goal: this.goals.get(goal.id),
      contributions: this.contributions.list(goal.id),
      accounts: this.accounts.all(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ goal: freshGoal, contributions, accounts }) => {
          this.goal.set(freshGoal);
          this.history.set(withAccountNames(contributions, accounts).sort(byNewestContribution));
        },
        error: () =>
          this.notice.set({
            message: 'The Contribution changed but the latest Goal details could not be loaded.',
            retry: () => this.refreshContributionFacts(),
          }),
      });
  }
}

function byNewestContribution(left: GoalContributionWithAccountName, right: GoalContributionWithAccountName): number {
  return right.contributionDate.getTime() - left.contributionDate.getTime() || right.id - left.id;
}
