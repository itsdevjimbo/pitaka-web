import { Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Schedule } from '../../data/schedule';
import { NewScheduleForm } from './new-schedule-form';

/** The shared create-Schedule form inside the application's accessible dialog shell. */
@Component({
  selector: 'schedules-new-schedule-dialog',
  imports: [DialogShell, NewScheduleForm],
  template: `
    <app-dialog-shell heading="Create Schedule">
      <schedules-new-schedule-form
        (created)="dialogRef.close($event)"
        (cancelled)="dialogRef.close()"
      />
    </app-dialog-shell>
  `,
})
export class NewScheduleDialog {
  protected readonly dialogRef = inject<MatDialogRef<NewScheduleDialog, Schedule>>(MatDialogRef);
}
