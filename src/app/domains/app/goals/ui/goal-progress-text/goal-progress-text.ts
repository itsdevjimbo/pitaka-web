import { DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { PesoPipe } from '@/app/core/money';
import { Goal } from '../../data/goal';

@Component({
  selector: 'goals-progress-text',
  imports: [PesoPipe, DecimalPipe],
  templateUrl: './goal-progress-text.html',
})
export class GoalProgressText {
  readonly goal = input.required<Goal>();

  protected isOver(): boolean {
    return this.goal().currentAmount > this.goal().targetAmount;
  }

  protected gap(): number {
    return Math.abs(this.goal().targetAmount - this.goal().currentAmount);
  }

  protected progressPercent(): number {
    const { currentAmount, targetAmount } = this.goal();
    return (currentAmount / targetAmount) * 100;
  }
}
