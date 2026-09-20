import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { PesoPipe } from '@/app/core/money';
import { Schedule, SCHEDULE_FREQUENCIES } from '../../data/schedule';

/** The resolved filing information needed to render one Schedule in a list. */
export type ScheduleRowData = {
  schedule: Schedule;
  accountName: string;
  accountRetired: boolean;
  categoryName: string;
  categoryRetired: boolean;
};

/** One Schedule's lifecycle, filing, and surviving-history reading. */
@Component({
  selector: 'li[schedules-schedule-row]',
  templateUrl: './schedule-row.html',
  imports: [DatePipe, PesoPipe],
  host: {
    class:
      'relative mb-6 block rounded-2xl border border-neutral-200 bg-white p-4 shadow-xs last:mb-0 dark:border-neutral-800 dark:bg-neutral-950',
  },
})
export class ScheduleRow {
  readonly row = input.required<ScheduleRowData>();

  protected readonly frequencies = SCHEDULE_FREQUENCIES;

  protected historyLabel(): string {
    const count = this.row().schedule.generatedTransactionCount;
    return `${count} surviving generated ${count === 1 ? 'Transaction' : 'Transactions'}`;
  }
}
