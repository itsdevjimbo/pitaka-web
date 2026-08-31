import { Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Budget } from '../data/budget';
import { NewBudgetForm } from './new-budget-form';

/**
 * The *New budget* dialog: the new-budget form inside the shared shell. It owns
 * nothing but the wiring — the form decides what a valid Budget is, the list
 * decides where the created one lands. A successful create closes the dialog
 * with the new Budget; Cancel and the close control close it with nothing.
 */
@Component({
  selector: 'budgets-new-budget-dialog',
  imports: [DialogShell, NewBudgetForm],
  template: `
    <app-dialog-shell heading="New budget">
      <budgets-new-budget-form
        (created)="dialogRef.close($event)"
        (cancelled)="dialogRef.close()"
      />
    </app-dialog-shell>
  `,
})
export class NewBudgetDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<NewBudgetDialog, Budget>>(MatDialogRef);
}
