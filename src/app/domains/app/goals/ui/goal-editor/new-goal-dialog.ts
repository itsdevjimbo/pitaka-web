import { Component, inject, signal, viewChild } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Goal } from '../../data/goal';
import { GoalForm } from './goal-form';
@Component({
  selector: 'goals-new-goal-dialog',
  imports: [DialogShell, GoalForm],
  template: `
    <app-dialog-shell
      heading="New goal"
      [dirty]="dirty()"
      [pending]="pending()"
    >
      <goals-goal-form
        (saved)="dialogRef.close($event)"
        (cancelled)="shell().requestClose()"
        (dirtyChange)="dirty.set($event)"
        (pendingChange)="pending.set($event)"
      />
    </app-dialog-shell>
  `,
})
export class NewGoalDialog {
  protected readonly dialogRef = inject<MatDialogRef<NewGoalDialog, Goal>>(MatDialogRef);
  protected readonly dirty = signal(false);
  protected readonly pending = signal(false);
  protected readonly shell = viewChild.required(DialogShell);
}
