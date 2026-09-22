import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PesoPipe } from '@/app/core/money';
import { Goal } from '../../data/goal';
import { toGoalDateOnly } from '../../data/goal-calendar';

/** The progress facts a Goal shows consistently in list rows and its detail. */
@Component({
  selector: 'goals-goal-progress',
  imports: [DatePipe, DecimalPipe, MatIconModule, PesoPipe],
  templateUrl: './goal-progress.html',
  styles: `
    :host {
      display: grid;
      min-width: 0;
      gap: 0.75rem;
    }

    @media (min-width: 48rem) {
      :host([data-wide='true']) {
        grid-template-columns: minmax(12rem, 0.8fr) minmax(18rem, 1.2fr);
        column-gap: 2rem;
        align-items: start;
      }
    }
  `,
  host: { '[attr.data-wide]': 'wide()' },
})
export class GoalProgress {
  readonly goal = input.required<Goal>();
  readonly wide = input(false);

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

  protected fundingLabel(): string {
    if (this.isOver()) {
      return 'Over target';
    }
    if (this.gap() === 0) {
      return 'Target reached';
    }
    return 'In progress';
  }

  protected progressPercent(): number {
    const { currentAmount, targetAmount } = this.goal();
    return (currentAmount / targetAmount) * 100;
  }
}
