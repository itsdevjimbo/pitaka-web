import { Component, inject, signal, viewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Goal } from '../../data/goal';
import { GoalForm } from './goal-form';
@Component({
  selector: 'goals-edit-goal-dialog',
  imports: [DialogShell, GoalForm],
  template: `
    <app-dialog-shell
      heading="Edit goal"
      [dirty]="dirty()"
      [pending]="pending()"
    >
      <goals-goal-form
        [goal]="goal"
        (saved)="dialogRef.close($event)"
        (cancelled)="shell().requestClose()"
        (dirtyChange)="dirty.set($event)"
        (pendingChange)="pending.set($event)"
      />
    </app-dialog-shell>
  `,
})
export class EditGoalDialog {
  protected readonly dialogRef = inject<MatDialogRef<EditGoalDialog, Goal>>(MatDialogRef);
  protected readonly goal = inject<Goal>(MAT_DIALOG_DATA);
  protected readonly dirty = signal(false);
  protected readonly pending = signal(false);
  protected readonly shell = viewChild.required(DialogShell);
}
