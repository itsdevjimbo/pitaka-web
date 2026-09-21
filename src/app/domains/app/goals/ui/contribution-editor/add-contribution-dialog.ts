import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Goal } from '../../data/goal';
import { ContributionForm } from './contribution-form';
@Component({
  selector: 'goals-add-contribution-dialog',
  imports: [DialogShell, ContributionForm],
  template: `
    <app-dialog-shell heading="Add contribution">
      <goals-contribution-form
        [goal]="goal"
        (saved)="dialogRef.close('saved')"
        (cancelled)="dialogRef.close()"
        (unavailable)="dialogRef.close($event)"
      />
    </app-dialog-shell>
  `,
})
export class AddContributionDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<AddContributionDialog, 'saved' | 'missing' | 'abandoned'>>(MatDialogRef);
  protected readonly goal = inject<Goal>(MAT_DIALOG_DATA);
}
