import { Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Goal } from '../../data/goal';
import { GoalForm } from './goal-form';
@Component({
  selector: 'goals-new-goal-dialog',
  imports: [DialogShell, GoalForm],
  template: `
    <app-dialog-shell heading="New goal">
      <goals-goal-form
        (saved)="dialogRef.close($event)"
        (cancelled)="dialogRef.close()"
      />
    </app-dialog-shell>
  `,
})
export class NewGoalDialog {
  protected readonly dialogRef = inject<MatDialogRef<NewGoalDialog, Goal>>(MatDialogRef);
}
