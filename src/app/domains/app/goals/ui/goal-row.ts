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
  templateUrl: './goal-row.html',
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
