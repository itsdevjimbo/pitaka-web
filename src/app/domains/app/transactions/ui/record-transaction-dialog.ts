import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Transaction, TransferDestinationAccount } from '../data/transaction';
import { RecordTransactionForm } from './record-transaction-form';

/**
 * What the screen hands the dialog when it opens: the Account the money moves
 * from, and the Transfer destinations already narrowed to the valid ones.
 */
export type RecordTransactionDialogData = {
  fromAccountId: number;
  destinations: readonly TransferDestinationAccount[];
};

/**
 * The *Record a transaction* dialog: the record form inside the shared shell. It
 * owns nothing but the wiring — the form still decides what a valid Transaction
 * is, and the Account detail screen still decides what a successful record does
 * (close, then re-read the balance and list — ADR 0006). A successful record
 * closes the dialog with the recorded Transaction; Cancel and the close control
 * close it with nothing.
 */
@Component({
  selector: 'transactions-record-transaction-dialog',
  imports: [DialogShell, RecordTransactionForm],
  template: `
    <app-dialog-shell heading="Record a transaction">
      <transactions-record-transaction-form
        [fromAccountId]="fromAccountId"
        [destinations]="destinations"
        (recorded)="dialogRef.close($event)"
        (cancelled)="dialogRef.close()"
      />
    </app-dialog-shell>
  `,
})
export class RecordTransactionDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<RecordTransactionDialog, Transaction>>(MatDialogRef);

  private readonly data = inject<RecordTransactionDialogData>(MAT_DIALOG_DATA);

  /** The Account the money moves from, handed in when the dialog was opened. */
  protected readonly fromAccountId = this.data.fromAccountId;

  /** The valid Transfer destinations, already narrowed by the screen. */
  protected readonly destinations = this.data.destinations;
}
