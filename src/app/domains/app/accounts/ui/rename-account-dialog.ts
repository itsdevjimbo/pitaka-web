import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Account } from '../data/account';
import { RenameAccountForm } from './rename-account-form';

/**
 * The *Rename* dialog: the rename form inside the shared shell, seeded with the
 * Account whose row menu opened it. A successful rename closes the dialog with
 * the renamed Account; Cancel and the close control close it with nothing. The
 * row itself is untouched, so its name, type, balance and retired badge stay
 * legible underneath.
 */
@Component({
  selector: 'accounts-rename-account-dialog',
  imports: [DialogShell, RenameAccountForm],
  template: `
    <app-dialog-shell heading="Rename account">
      <accounts-rename-account-form
        [account]="account"
        (renamed)="dialogRef.close($event)"
        (cancelled)="dialogRef.close()"
      />
    </app-dialog-shell>
  `,
})
export class RenameAccountDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<RenameAccountDialog, Account>>(MatDialogRef);

  /** The Account being renamed, handed in when the dialog was opened. */
  protected readonly account = inject<Account>(MAT_DIALOG_DATA);
}
