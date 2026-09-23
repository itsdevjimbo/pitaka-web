import { afterNextRender, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Schedule } from '../../data/schedule';
import { ScheduleLifecycleCoordinator, toScheduleLifecycleFailure } from '../../data/schedule-lifecycle-coordinator';

export type ScheduleLifecycleAction = 'pause' | 'resume';

export type ScheduleLifecycleDialogData = {
  schedule: Schedule;
  action: ScheduleLifecycleAction;
};

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
  protected readonly dialogRef = inject<MatDialogRef<ScheduleLifecycleDialog>>(MatDialogRef);
  protected readonly data = inject<ScheduleLifecycleDialogData>(MAT_DIALOG_DATA);
  protected readonly action = ACTION[this.data.action];

  protected readonly submitting = signal(false);
  protected readonly outcomeUncertain = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  private readonly cancelButton = viewChild('cancelButton', { read: ElementRef<HTMLButtonElement> });

  constructor() {
    afterNextRender(() => this.cancelButton()?.nativeElement.focus());
  }

  protected get heading(): string {
    return `${this.action.verb} ‘${this.data.schedule.name}’?`;
  }

  protected confirm(): void {
    if (this.submitting() || this.outcomeUncertain()) {
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.coordinator.setStatus(this.data.schedule.id, this.action.status).subscribe({
      next: () => this.dialogRef.close(),
      error: (error: unknown) => {
        this.submitting.set(false);
        const failure = toScheduleLifecycleFailure(error);
        if (failure.kind === 'conflict') {
          this.dialogRef.close();
          return;
        }
        this.outcomeUncertain.set(failure.kind === 'uncertain');
        this.errorMessage.set(failure.message);
      },
    });
  }
}
