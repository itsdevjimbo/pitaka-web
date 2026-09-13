import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { AccountsService } from '@/app/domains/app/accounts';
import {
  Goal,
  GoalContributionWithAccountName,
  GoalContributionsService,
  GoalsService,
  withAccountNames,
} from '../../index';
import { GoalProgress } from '../../ui/goal-progress';

const LOAD_FAILED =
  'Something went wrong loading this Goal. Please try again.';

/** A Goal's current facts and its complete, account-named Contribution history. */
@Component({
  selector: 'goal-detail',
  templateUrl: './goal-detail.html',
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    RouterLink,
    PesoPipe,
    GoalProgress,
  ],
  host: { class: 'flex flex-auto flex-col' },
})
export default class GoalDetail implements OnInit {
  private goals = inject(GoalsService);
  private contributions = inject(GoalContributionsService);
  private accounts = inject(AccountsService);
  private destroyRef = inject(DestroyRef);

  readonly id = input.required<string>();
  private readonly goalId = computed(() => Number(this.id()));

  protected readonly goal = signal<Goal | null>(null);
  protected readonly history = signal<readonly GoalContributionWithAccountName[] | null>(
    null
  );
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly notFound = signal(false);
  protected readonly isEmpty = computed(() => this.history()?.length === 0);

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
      accounts: this.accounts.list(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ goal, contributions, accounts }) => {
          this.goal.set(goal);
          this.history.set(
            withAccountNames(contributions, accounts).sort(byNewestContribution)
          );
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
}

function byNewestContribution(
  left: GoalContributionWithAccountName,
  right: GoalContributionWithAccountName
): number {
  return (
    right.contributionDate.getTime() - left.contributionDate.getTime() ||
    right.id - left.id
  );
}
