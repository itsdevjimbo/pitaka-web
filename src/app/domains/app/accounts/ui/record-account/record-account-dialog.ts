import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { DialogShell } from '@/app/core/dialog';
import type { Account } from '../../data/account';

export type RecordAccountDialogData = {
  accounts: readonly Account[];
};

export type RecordAccountDialogResult = Account | 'new-account';

@Component({
  selector: 'accounts-record-account-dialog',
  imports: [DialogShell, MatButtonModule, MatFormFieldModule, MatSelectModule],
  template: `
    <app-dialog-shell heading="Record a transaction">
      @if (data.accounts.length === 0) {
        <div class="grid gap-4">
          <div>
            <h3 class="font-display text-xl">An active Account is needed</h3>
            <p class="mt-2 text-secondary">You need an active Account before you can record a Transaction.</p>
          </div>
          <div class="flex flex-wrap justify-end gap-3">
            <button
              matButton
              type="button"
              (click)="dialogRef.close()"
            >
              Cancel
            </button>
            <button
              matButton="filled"
              type="button"
              (click)="dialogRef.close('new-account')"
            >
              New account
            </button>
          </div>
        </div>
      } @else {
        <div class="grid gap-5">
          <div>
            <h3 class="font-display text-xl">Choose an account</h3>
            <p class="mt-2 text-secondary">The Transaction will be recorded against this Account.</p>
          </div>
          <mat-form-field class="w-full">
            <mat-label>Account</mat-label>
            <mat-select
              [value]="selectedId()"
              (selectionChange)="selectedId.set($event.value)"
            >
              @for (account of data.accounts; track account.id) {
                <mat-option [value]="account.id">{{ account.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <div class="flex justify-end gap-3">
            <button
              matButton
              type="button"
              (click)="dialogRef.close()"
            >
              Cancel
            </button>
            <button
              matButton="filled"
              type="button"
              [disabled]="selectedId() === null"
              (click)="continue()"
            >
              Continue
            </button>
          </div>
        </div>
      }
    </app-dialog-shell>
  `,
})
export class RecordAccountDialog {
  protected readonly dialogRef = inject<MatDialogRef<RecordAccountDialog, RecordAccountDialogResult>>(MatDialogRef);
  protected readonly data = inject<RecordAccountDialogData>(MAT_DIALOG_DATA);
  protected readonly selectedId = signal<number | null>(null);

  protected continue(): void {
    const selected = this.data.accounts.find((account) => account.id === this.selectedId());
    if (selected) {
      this.dialogRef.close(selected);
    }
  }
}
