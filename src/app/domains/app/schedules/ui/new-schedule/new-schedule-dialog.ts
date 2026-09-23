import { Component, inject, signal, viewChild } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Schedule } from '../../data/schedule';
import { NewScheduleForm } from './new-schedule-form';

/** The shared create-Schedule form inside the application's accessible dialog shell. */
@Component({
  selector: 'schedules-new-schedule-dialog',
  imports: [DialogShell, NewScheduleForm],
  template: `
    <app-dialog-shell
      heading="Create Schedule"
      [dirty]="dirty()"
      [pending]="pending()"
    >
      <schedules-new-schedule-form
        (created)="dialogRef.close($event)"
        (cancelled)="shell().requestClose()"
        (dirtyChange)="dirty.set($event)"
        (pendingChange)="pending.set($event)"
      />
    </app-dialog-shell>
  `,
})
export class NewScheduleDialog {
  protected readonly dialogRef = inject<MatDialogRef<NewScheduleDialog, Schedule>>(MatDialogRef);
  protected readonly dirty = signal(false);
  protected readonly pending = signal(false);
  protected readonly shell = viewChild.required(DialogShell);
}
