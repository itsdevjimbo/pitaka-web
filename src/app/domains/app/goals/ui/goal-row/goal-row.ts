import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { Goal } from '../../data/goal';
import { GoalProgress } from '../goal-progress/goal-progress';

/** A Goal's progress reading, shared by the list and its future detail screen. */
@Component({
  selector: 'goals-goal-row',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, RouterLink, GoalProgress],
  templateUrl: './goal-row.html',
})
export class GoalRow {
  readonly goal = input.required<Goal>();
  readonly unavailable = input(false);
  readonly pending = input(false);
  readonly edit = output<Goal>();
  readonly status = output<{ goal: Goal; status: Goal['status'] }>();
  readonly abandon = output<Goal>();
  readonly remove = output<Goal>();
}
