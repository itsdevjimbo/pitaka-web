import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { PesoPipe } from '@/app/core/money';
import { Goal } from '../data/goal';
import { toGoalDateOnly } from '../data/goal-calendar';

/** A Goal's progress reading, shared by the list and its future detail screen. */
@Component({
  selector: 'goals-goal-row',
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    PesoPipe,
    RouterLink,
  ],
  template: `
    <a
      class="flex flex-col gap-y-2 rounded-xl border border-neutral-200 px-4 py-3 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
      [class.opacity-60]="goal().status === 'Abandoned'"
      [routerLink]="['/app/goals', goal().id]"
    >
      <div class="flex items-center gap-x-3">
        <span class="min-w-0 flex-auto truncate font-medium">{{ goal().name }}</span>
        <button
          matIconButton
          class="-mr-2 shrink-0"
          aria-label="Goal actions"
          [matMenuTriggerFor]="menu"
          (click)="$event.preventDefault(); $event.stopPropagation()"
        >
          <mat-icon svgIcon="ellipsis-vertical" />
        </button>
        <!-- Lifecycle actions arrive with the Goal write screen; this trigger is
             deliberately present now so the row never requires navigation first. -->
        <mat-menu #menu></mat-menu>
      </div>

      <div
        data-goal-progress
        class="flex h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
        role="img"
        [attr.aria-label]="progressLabel()"
      >
        <span class="h-full bg-income" [style.width.%]="filledWidth()"></span>
        @if (isOver()) {
          <span class="h-full bg-transfer" [style.width.%]="overflowWidth()"></span>
        }
      </div>

      <div class="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span class="tabular-nums text-neutral-600 dark:text-neutral-300">
          {{ goal().currentAmount | peso }} of {{ goal().targetAmount | peso }}
        </span>
        @if (isOver()) {
          <span class="font-medium text-neutral-700 dark:text-neutral-200">
            {{ gap() | peso }} over
          </span>
        } @else if (gap() === 0) {
          <span class="font-medium text-income">Target reached</span>
        } @else {
          <span class="text-neutral-500 dark:text-neutral-400">{{ gap() | peso }} to go</span>
        }
      </div>

      @if (goal().status === 'Active' && goal().targetDate) {
        <div class="flex flex-wrap items-center gap-x-2 text-sm text-neutral-500 dark:text-neutral-400">
          <span>By {{ goal().targetDate | date: 'd MMM y' }}</span>
          @if (isOverdue()) {
            <span aria-hidden="true">·</span>
            <span class="font-medium text-expense">Overdue</span>
          }
        </div>
      }
    </a>
  `,
})
export class GoalRow {
  readonly goal = input.required<Goal>();

  protected isOver(): boolean {
    return this.goal().currentAmount > this.goal().targetAmount;
  }

  protected gap(): number {
    return Math.abs(this.goal().targetAmount - this.goal().currentAmount);
  }

  /** Both segments together always occupy the full bar; overflow is visibly neutral. */
  protected overflowWidth(): number {
    const { currentAmount, targetAmount } = this.goal();
    return Math.min(((currentAmount - targetAmount) / currentAmount) * 100, 40);
  }

  protected filledWidth(): number {
    return this.isOver() ? 100 - this.overflowWidth() : this.progressPercent();
  }

  protected progressLabel(): string {
    return `${this.progressPercent().toFixed(0)}% of ${this.goal().name}`;
  }

  protected isOverdue(): boolean {
    const goal = this.goal();
    return (
      goal.status === 'Active' &&
      goal.targetDate !== null &&
      toGoalDateOnly(goal.targetDate) < toGoalDateOnly(new Date())
    );
  }

  private progressPercent(): number {
    const { currentAmount, targetAmount } = this.goal();
    return (currentAmount / targetAmount) * 100;
  }
}
