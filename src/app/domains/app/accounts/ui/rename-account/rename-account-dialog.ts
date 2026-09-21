import { Component, inject, signal, viewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Account } from '../../data/account';
import { RenameAccountForm } from './rename-account-form';

@Component({
  selector: 'accounts-rename-account-dialog',
  imports: [DialogShell, RenameAccountForm],
  template: `
    <app-dialog-shell
      heading="Rename account"
      [dirty]="dirty()"
      [pending]="pending()"
    >
      <accounts-rename-account-form
        [account]="account"
        (renamed)="dialogRef.close($event)"
        (cancelled)="shell().requestClose()"
        (dirtyChange)="dirty.set($event)"
        (pendingChange)="pending.set($event)"
      />
    </app-dialog-shell>
  `,
})
export class RenameAccountDialog {
  protected readonly dialogRef = inject<MatDialogRef<RenameAccountDialog, Account>>(MatDialogRef);
  protected readonly account = inject<Account>(MAT_DIALOG_DATA);
  protected readonly dirty = signal(false);
  protected readonly pending = signal(false);
  protected readonly shell = viewChild.required(DialogShell);
}
