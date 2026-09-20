import { Component, input, model } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';

export type ScheduleView = 'upcoming' | 'paused' | 'past';
export type ScheduleViewCounts = Readonly<Record<ScheduleView, number>>;

const VIEWS: readonly { id: ScheduleView; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'paused', label: 'Paused' },
  { id: 'past', label: 'Past' },
];

/** The controlled lifecycle chooser for a populated Schedule list. */
@Component({
  selector: 'schedules-lifecycle-nav',
  templateUrl: './schedule-lifecycle-nav.html',
  imports: [MatBadgeModule, MatButtonModule],
})
export class ScheduleLifecycleNav {
  readonly counts = input.required<ScheduleViewCounts>();
  readonly view = model.required<ScheduleView>();

  protected readonly views = VIEWS;
}
