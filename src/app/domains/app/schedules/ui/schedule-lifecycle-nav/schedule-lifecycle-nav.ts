import { Component, model } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

export type ScheduleView = 'upcoming' | 'paused' | 'past';

const VIEWS: readonly { id: ScheduleView; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'paused', label: 'Paused' },
  { id: 'past', label: 'Past' },
];

/** The controlled lifecycle chooser for a populated Schedule list. */
@Component({
  selector: 'schedules-lifecycle-nav',
  templateUrl: './schedule-lifecycle-nav.html',
  imports: [MatButtonModule],
})
export class ScheduleLifecycleNav {
  readonly view = model.required<ScheduleView>();

  protected readonly views = VIEWS;
}
