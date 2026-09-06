import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Budget } from '../data/budget';
import { AdjustBudgetForm } from './adjust-budget-form';

/**
 * The *Adjust budget* dialog: the adjust form inside the shared shell, seeded
 * with the Budget whose row menu opened it. A successful save closes the dialog
 * with the adjusted Budget; Cancel and the close control close it with nothing.
 * The row itself is untouched, so its figures stay legible underneath until the
 * list re-reads.
 */
@Component({
  selector: 'budgets-adjust-budget-dialog',
  imports: [DialogShell, AdjustBudgetForm],
  template: `
    <app-dialog-shell heading="Adjust budget">
      <budgets-adjust-budget-form
        [budget]="budget"
        (adjusted)="dialogRef.close($event)"
        (cancelled)="dialogRef.close()"
      />
    </app-dialog-shell>
  `,
})
export class AdjustBudgetDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<AdjustBudgetDialog, Budget>>(MatDialogRef);

  /** The Budget being adjusted, handed in when the dialog was opened. */
  protected readonly budget = inject<Budget>(MAT_DIALOG_DATA);
}
