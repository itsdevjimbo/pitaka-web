import { Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Account } from '../data/account';
import { NewAccountForm } from './new-account-form';

/**
 * The *Add account* dialog: the new-account form inside the shared shell. It
 * owns nothing but the wiring — the form still decides what a valid Account is,
 * and the list still decides where the created one lands. A successful create
 * closes the dialog with the new Account; Cancel and the close control close it
 * with nothing.
 */
@Component({
  selector: 'accounts-new-account-dialog',
  imports: [DialogShell, NewAccountForm],
  template: `
    <app-dialog-shell heading="New account">
      <accounts-new-account-form
        (created)="dialogRef.close($event)"
        (cancelled)="dialogRef.close()"
      />
    </app-dialog-shell>
  `,
})
export class NewAccountDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<NewAccountDialog, Account>>(MatDialogRef);
}
