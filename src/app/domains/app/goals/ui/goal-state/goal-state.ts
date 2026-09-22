import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PesoPipe } from '@/app/core/money';
import { Goal } from '../../data/goal';
import { toGoalDateOnly } from '../../data/goal-calendar';

@Component({
  selector: 'goals-state',
  imports: [MatIconModule, PesoPipe],
  templateUrl: './goal-state.html',
})
export class GoalState {
  readonly goal = input.required<Goal>();

  protected isOver(): boolean {
    return this.goal().currentAmount > this.goal().targetAmount;
  }

  protected gap(): number {
    return Math.abs(this.goal().targetAmount - this.goal().currentAmount);
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
}
