import { Component, inject, signal, viewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Schedule } from '../../data/schedule';
import { ScheduleRowData } from '../schedule-row/schedule-row';
import { EditScheduleForm } from './edit-schedule-form';

/** The editable Schedule details inside the application's accessible dialog shell. */
@Component({
  selector: 'schedules-edit-schedule-dialog',
  imports: [DialogShell, EditScheduleForm],
  template: `
    <app-dialog-shell
      heading="Edit Schedule"
      [dirty]="dirty()"
      [pending]="pending()"
    >
      <schedules-edit-schedule-form
        [row]="row"
        (saved)="dialogRef.close($event)"
        (cancelled)="shell().requestClose()"
        (dirtyChange)="dirty.set($event)"
        (pendingChange)="pending.set($event)"
      />
    </app-dialog-shell>
  `,
})
export class EditScheduleDialog {
  protected readonly dialogRef = inject<MatDialogRef<EditScheduleDialog, Schedule>>(MatDialogRef);
  protected readonly row = inject<ScheduleRowData>(MAT_DIALOG_DATA);
  protected readonly dirty = signal(false);
  protected readonly pending = signal(false);
  protected readonly shell = viewChild.required(DialogShell);
}
