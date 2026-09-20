import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { PesoPipe } from '@/app/core/money';
import { scheduleHistoryQueryParams } from '@/app/domains/app/transactions';
import { Schedule, SCHEDULE_FREQUENCIES } from '../../data/schedule';
import { toScheduleLifecycleFailure } from '../../data/schedule-lifecycle-coordinator';
import { SchedulesService } from '../../data/schedules.service';
import { ScheduleLifecycleAction } from '../schedule-lifecycle-dialog/schedule-lifecycle-dialog';

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
  imports: [DatePipe, MatButtonModule, PesoPipe, RouterLink],
  host: {
    class:
      'relative mb-6 block rounded-2xl border border-neutral-200 bg-white p-4 shadow-xs last:mb-0 dark:border-neutral-800 dark:bg-neutral-950',
  },
})
export class ScheduleRow {
  private readonly schedulesService = inject(SchedulesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly row = input.required<ScheduleRowData>();
  readonly writeDisabled = input(false);
  readonly edit = output<ScheduleRowData>();
  readonly extend = output<ScheduleRowData>();
  readonly deleted = output<void>();
  readonly deleteConflict = output<{ scheduleId: number; message: string }>();
  readonly lifecycle = output<{ row: ScheduleRowData; action: ScheduleLifecycleAction }>();

  protected readonly frequencies = SCHEDULE_FREQUENCIES;
  protected readonly historyQueryParams = scheduleHistoryQueryParams;
  protected readonly confirmingDelete = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal<string | null>(null);
  private readonly deleteTrigger = viewChild<HTMLButtonElement>('deleteTrigger');
  private readonly deleteCancel = viewChild<HTMLButtonElement>('deleteCancel');

  protected historyLabel(): string {
    const count = this.row().schedule.generatedTransactionCount;
    return `${count} surviving generated ${count === 1 ? 'Transaction' : 'Transactions'}`;
  }

  protected request(action: ScheduleLifecycleAction): void {
    this.lifecycle.emit({ row: this.row(), action });
  }

  protected askDelete(): void {
    if (this.writeDisabled() || !this.row().schedule.canDelete) return;
    this.deleteError.set(null);
    this.confirmingDelete.set(true);
    queueMicrotask(() => this.deleteCancel()?.focus());
  }

  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.confirmingDelete.set(false);
    this.deleteError.set(null);
    queueMicrotask(() => this.deleteTrigger()?.focus());
  }

  protected confirmDelete(): void {
    if (this.deleting() || this.writeDisabled() || !this.row().schedule.canDelete) return;
    const scheduleId = this.row().schedule.id;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.schedulesService
      .delete(scheduleId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deleting.set(false);
          this.confirmingDelete.set(false);
          this.deleted.emit();
        },
        error: (error: unknown) => {
          this.deleting.set(false);
          const failure = toScheduleLifecycleFailure(error);
          if (failure.kind === 'conflict') {
            this.confirmingDelete.set(false);
            this.deleteConflict.emit({ scheduleId, message: failure.message });
          } else this.deleteError.set(failure.message);
        },
      });
  }
}
