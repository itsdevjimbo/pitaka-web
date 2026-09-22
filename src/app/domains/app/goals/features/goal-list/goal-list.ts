import { Component, computed, DestroyRef, ElementRef, inject, Injector, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Subject, takeUntil } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { RowNotice } from '@/app/core/notices';
import { ResourceState } from '@/app/core/notices';
import { GoalContributionsService } from '../../data/contributions/goal-contributions.service';
import { Goal, GoalStatus } from '../../data/goal';
import { GoalsService } from '../../data/goals.service';
import { EditGoalDialog } from '../../ui/goal-editor/edit-goal-dialog';
import { NewGoalDialog } from '../../ui/goal-editor/new-goal-dialog';
import { GoalRow } from '../../ui/goal-row/goal-row';

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
  imports: [MatButtonModule, MatIconModule, GoalRow, ResourceState, RowNotice, PesoPipe],
  host: { class: 'flex flex-auto flex-col' },
})
export default class GoalList {
  private service = inject(GoalsService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);
  private dialog = inject(MatDialog);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly goals = signal<readonly Goal[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshError = signal(false);
  protected readonly savedStale = signal(false);
  protected readonly stale = computed(() => this.refreshError());
  protected readonly busyId = signal<number | null>(null);
  protected readonly notice = signal<{ id: number; message: string; retry?: () => void } | null>(null);
  protected readonly confirmingAbandon = signal<Goal | null>(null);
  protected readonly confirmingDelete = signal<{ goal: Goal; count: number } | null>(null);
  private readonly readReset = new Subject<void>();

  /** All lifecycle sections stay visible after the first Goal exists. */
  protected readonly groups = computed<readonly GoalGroup[]>(() => {
    const goals = this.goals();
    if (!goals) {
      return [];
    }

    return GROUPS.map((group) => ({
      ...group,
      rows: goals
        .filter((goal) => goal.status === group.status)
        .sort(group.status === 'Active' ? byActiveOrder : byName),
    }));
  });

  protected readonly isEmpty = computed(() => this.goals()?.length === 0);

  constructor() {
    this.destroyRef.onDestroy(() => this.readReset.complete());
    this.load();
  }

  /** Read every Goal freshly: each row carries the server-computed progress total. */
  protected load(): void {
    if (this.goals() !== null) {
      this.readGoals();
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    this.refreshError.set(false);
    this.savedStale.set(false);
    this.readReset.next();
    this.service
      .list()
      .pipe(takeUntil(this.readReset), takeUntilDestroyed(this.destroyRef))
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

  protected openNew(): void {
    this.dialog
      .open<NewGoalDialog, undefined, Goal>(NewGoalDialog)
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((goal) => {
        if (goal) {
          this.readGoals('after-write');
        }
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
          this.readGoals('after-write');
        }
      });
  }

  protected askAbandon(goal: Goal): void {
    this.notice.set(null);
    this.confirmingDelete.set(null);
    this.confirmingAbandon.set(goal);
    this.focusSafeAction(`cancel-abandon-goal-${goal.id}`);
  }

  protected askDelete(goal: Goal): void {
    this.notice.set(null);
    this.confirmingAbandon.set(null);
    this.injector
      .get(GoalContributionsService)
      .list(goal.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.confirmingDelete.set({ goal, count: items.length });
          this.focusSafeAction(`cancel-delete-goal-${goal.id}`);
        },
        error: (error) => this.failed(goal.id, error, () => this.askDelete(goal)),
      });
  }

  protected cancelPrompt(): void {
    this.clearPrompts();
  }

  protected setStatus(goal: Goal, status: GoalStatus): void {
    if (this.busyId() !== null) {
      return;
    }
    this.clearPrompts();
    this.write(
      goal.id,
      this.service.setStatus(goal.id, status),
      () => this.readGoals('after-write'),
      () => this.setStatus(goal, status),
    );
  }

  protected confirmAbandon(goal: Goal): void {
    this.setStatus(goal, 'Abandoned');
  }

  protected confirmDelete(goal: Goal): void {
    this.clearPrompts();
    this.write(
      goal.id,
      this.service.delete(goal.id),
      () => this.readGoals('after-write'),
      () => this.confirmDelete(goal),
    );
  }

  private write(id: number, write$: import('rxjs').Observable<unknown>, success: () => void, retry: () => void): void {
    if (this.busyId() !== null) {
      return;
    }
    this.notice.set(null);
    this.busyId.set(id);
    write$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busyId.set(null);
        success();
      },
      error: (error) => {
        this.busyId.set(null);
        this.failed(id, error, retry);
      },
    });
  }

  private failed(id: number, error: unknown, retry: () => void): void {
    if (error instanceof ApiError && error.status === 404) {
      this.load();
      return;
    }

    if (error instanceof ApiError && error.status === 403) {
      this.notice.set({ id, message: 'You can no longer change this Goal.' });
      this.load();
      return;
    }

    this.notice.set({
      id,
      message: error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      retry,
    });
  }

  private clearPrompts(): void {
    this.confirmingAbandon.set(null);
    this.confirmingDelete.set(null);
  }

  /** Refresh without hiding settled funding figures; a failed reread explicitly gates writes. */
  private readGoals(reason: 'ordinary' | 'after-write' = 'ordinary'): void {
    this.readReset.next();
    this.refreshError.set(false);
    this.service
      .list()
      .pipe(takeUntil(this.readReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (goals) => {
          this.goals.set(goals);
          this.savedStale.set(false);
        },
        error: () => {
          this.refreshError.set(true);
          this.savedStale.set(reason === 'after-write');
        },
      });
  }

  private focusSafeAction(id: string): void {
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLButtonElement>(`#${id}`)?.focus());
  }
}

function byActiveOrder(left: Goal, right: Goal): number {
  if (left.targetDate === null && right.targetDate === null) {
    return byName(left, right);
  }
  if (left.targetDate === null) {
    return 1;
  }
  if (right.targetDate === null) {
    return -1;
  }
  return left.targetDate.getTime() - right.targetDate.getTime() || byName(left, right);
}

function byName(left: Goal, right: Goal): number {
  return left.name.localeCompare(right.name);
}
