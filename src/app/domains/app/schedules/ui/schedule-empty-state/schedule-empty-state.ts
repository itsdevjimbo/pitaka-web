import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ScheduleView } from '../schedule-lifecycle-nav/schedule-lifecycle-nav';

/** Empty-state policy for either the whole collection or one lifecycle view. */
@Component({
  selector: 'schedules-empty-state',
  templateUrl: './schedule-empty-state.html',
  imports: [MatButtonModule, MatIconModule],
})
export class ScheduleEmptyState {
  readonly scope = input.required<'all' | ScheduleView>();
  readonly createDisabled = input(false);
  readonly create = output<void>();

  protected viewMessage(): string {
    switch (this.scope()) {
      case 'upcoming':
        return 'No upcoming Schedules';
      case 'paused':
        return 'No paused Schedules';
      case 'past':
        return 'No past Schedules';
      case 'all':
        return '';
    }
  }
}
