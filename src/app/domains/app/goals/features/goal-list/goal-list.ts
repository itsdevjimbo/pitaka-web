import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '@/app/core/api';
import { Goal, GoalStatus } from '../../data/goal';
import { GoalsService } from '../../data/goals.service';
import { GoalRow } from '../../ui/goal-row';

const LOAD_FAILED = 'Something went wrong loading your goals. Please try again.';

type GoalGroup = {
  status: GoalStatus;
  label: string;
  emptyLabel: string;
  rows: readonly Goal[];
};

const GROUPS: readonly Omit<GoalGroup, 'rows'>[] = [
  { status: 'Active', label: 'Active', emptyLabel: 'No active Goals.' },
  { status: 'Completed', label: 'Completed', emptyLabel: 'No completed Goals yet.' },
  { status: 'Abandoned', label: 'Abandoned', emptyLabel: 'No abandoned Goals.' },
];

/** The Goals overview: progress grouped by its deliberate lifecycle state. */
@Component({
  selector: 'goals-list',
  templateUrl: './goal-list.html',
  imports: [MatButtonModule, MatIconModule, GoalRow],
  host: { class: 'flex flex-auto flex-col' },
})
export default class GoalList {
  private service = inject(GoalsService);
  private destroyRef = inject(DestroyRef);

  protected readonly goals = signal<readonly Goal[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  /** All lifecycle sections stay visible after the first Goal exists. */
  protected readonly groups = computed<readonly GoalGroup[]>(() => {
    const goals = this.goals();
    if (!goals) return [];

    return GROUPS.map((group) => ({
      ...group,
      rows: goals
        .filter((goal) => goal.status === group.status)
        .sort(group.status === 'Active' ? byActiveOrder : byName),
    }));
  });

  protected readonly isEmpty = computed(() => this.goals()?.length === 0);

  constructor() {
    this.load();
  }

  /** Read every Goal freshly: each row carries the server-computed progress total. */
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.service
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (goals) => {
          this.goals.set(goals);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.errorMessage.set(error instanceof ApiError ? error.message : LOAD_FAILED);
          this.loading.set(false);
        },
      });
  }
}

function byActiveOrder(left: Goal, right: Goal): number {
  if (left.targetDate === null && right.targetDate === null) return byName(left, right);
  if (left.targetDate === null) return 1;
  if (right.targetDate === null) return -1;
  return left.targetDate.getTime() - right.targetDate.getTime() || byName(left, right);
}

function byName(left: Goal, right: Goal): number {
  return left.name.localeCompare(right.name);
}
