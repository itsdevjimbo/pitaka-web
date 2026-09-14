import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { GoalContributionWithAccountName } from '../data/contribution-account-name';
import { Goal } from '../data/goal';
import { ContributionForm } from './contribution-form';
type Data = { goal: Goal; contribution: GoalContributionWithAccountName };
@Component({
  selector: 'goals-edit-contribution-dialog',
  imports: [DialogShell, ContributionForm],
  template: `
    <app-dialog-shell heading="Edit contribution">
      <goals-contribution-form
        [goal]="data.goal"
        [contribution]="data.contribution"
        (saved)="dialogRef.close('saved')"
        (cancelled)="dialogRef.close()"
        (unavailable)="dialogRef.close($event)"
      />
    </app-dialog-shell>
  `,
})
export class EditContributionDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<EditContributionDialog, 'saved' | 'missing' | 'abandoned'>>(MatDialogRef);
  protected readonly data = inject<Data>(MAT_DIALOG_DATA);
}
