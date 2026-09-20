import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ApiError } from '@/app/core/api';
import { DialogShell } from '@/app/core/dialog';
import { Schedule } from '../../data/schedule';
import { ScheduleLifecycleCoordinator } from '../../data/schedule-lifecycle-coordinator';

export type ScheduleLifecycleAction = 'pause' | 'resume';

export type ScheduleLifecycleDialogData = {
  schedule: Schedule;
  action: ScheduleLifecycleAction;
};

export type ScheduleLifecycleDialogResult =
  { kind: 'updated'; schedule: Schedule } | { kind: 'conflict'; scheduleId: number; message: string };

const ACTION: Record<
  ScheduleLifecycleAction,
  { verb: string; explanation: string; status: 'active' | 'paused'; pendingLabel: string }
> = {
  pause: {
    verb: 'Pause',
    explanation: 'No Transactions will be generated while paused. You can resume later.',
    status: 'paused',
    pendingLabel: 'Pausing…',
  },
  resume: {
    verb: 'Resume',
    explanation: 'Generation resumes on the original cadence. Missed occurrences won’t be generated.',
    status: 'active',
    pendingLabel: 'Resuming…',
  },
};

/** Confirms and submits one reversible Schedule lifecycle change. */
@Component({
  selector: 'schedules-lifecycle-dialog',
  imports: [DialogShell, MatButtonModule],
  templateUrl: './schedule-lifecycle-dialog.html',
})
export class ScheduleLifecycleDialog {
  private readonly coordinator = inject(ScheduleLifecycleCoordinator);
  protected readonly dialogRef =
    inject<MatDialogRef<ScheduleLifecycleDialog, ScheduleLifecycleDialogResult>>(MatDialogRef);
  protected readonly data = inject<ScheduleLifecycleDialogData>(MAT_DIALOG_DATA);
  protected readonly action = ACTION[this.data.action];

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected get heading(): string {
    return `${this.action.verb} ‘${this.data.schedule.name}’?`;
  }

  protected confirm(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.coordinator.setStatus(this.data.schedule.id, this.action.status).subscribe({
      next: (schedule) => this.dialogRef.close({ kind: 'updated', schedule }),
      error: (error: unknown) => {
        this.submitting.set(false);
        const message = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
        if (error instanceof ApiError && error.status === 409) {
          this.dialogRef.close({ kind: 'conflict', scheduleId: this.data.schedule.id, message });
          return;
        }
        this.errorMessage.set(message);
      },
    });
  }
}
