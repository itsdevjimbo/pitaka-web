import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Transaction } from '../data/transaction';
import { RefileTransactionForm } from './refile-transaction-form';

/** What the screen hands the dialog when it opens: the Transaction to correct. */
export type RefileTransactionDialogData = {
  transaction: Transaction;
};

/**
 * The *Refile transaction* dialog: the refile form inside the shared shell. It
 * owns nothing but the wiring — the form still decides what a valid correction
 * is, and the Account detail screen still decides what a successful refile does
 * (close, then re-read the balance and list — ADR 0006). A successful refile
 * closes the dialog with the corrected Transaction; Cancel and the close control
 * close it with nothing.
 */
@Component({
  selector: 'transactions-refile-transaction-dialog',
  imports: [DialogShell, RefileTransactionForm],
  template: `
    <app-dialog-shell heading="Refile transaction">
      <transactions-refile-transaction-form
        [transaction]="transaction"
        (refiled)="dialogRef.close($event)"
        (cancelled)="dialogRef.close()"
      />
    </app-dialog-shell>
  `,
})
export class RefileTransactionDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<RefileTransactionDialog, Transaction>>(MatDialogRef);

  private readonly data = inject<RefileTransactionDialogData>(MAT_DIALOG_DATA);

  /** The Transaction being corrected, handed in when the dialog was opened. */
  protected readonly transaction = this.data.transaction;
}
