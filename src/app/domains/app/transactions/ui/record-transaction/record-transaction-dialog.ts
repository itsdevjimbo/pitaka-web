import { Component, inject, signal, viewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Transaction, TransferDestinationAccount } from '../../data/transaction';
import { RecordTransactionForm } from './record-transaction-form';

/**
 * What the screen hands the dialog when it opens: the Account the money moves
 * from, and the Transfer destinations already narrowed to the valid ones.
 */
export type RecordTransactionDialogData = {
  fromAccountId: number;
  destinations: readonly TransferDestinationAccount[];
};

@Component({
  selector: 'transactions-record-transaction-dialog',
  imports: [DialogShell, RecordTransactionForm],
  template: `
    <app-dialog-shell
      heading="Record a transaction"
      [dirty]="dirty()"
      [pending]="pending()"
    >
      <transactions-record-transaction-form
        [fromAccountId]="fromAccountId"
        [destinations]="destinations"
        (recorded)="dialogRef.close($event)"
        (cancelled)="shell().requestClose()"
        (dirtyChange)="dirty.set($event)"
        (pendingChange)="pending.set($event)"
      />
    </app-dialog-shell>
  `,
})
export class RecordTransactionDialog {
  protected readonly dialogRef = inject<MatDialogRef<RecordTransactionDialog, Transaction>>(MatDialogRef);

  private readonly data = inject<RecordTransactionDialogData>(MAT_DIALOG_DATA);

  /** The Account the money moves from, handed in when the dialog was opened. */
  protected readonly fromAccountId = this.data.fromAccountId;

  /** The valid Transfer destinations, already narrowed by the screen. */
  protected readonly destinations = this.data.destinations;
  protected readonly dirty = signal(false);
  protected readonly pending = signal(false);
  protected readonly shell = viewChild.required(DialogShell);
}
