import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { DialogShell } from '@/app/core/dialog';
/** The Account identity a recording entry point needs to offer a choice. */
export type RecordAccountOption = {
  id: number;
  name: string;
};

export type RecordAccountDialogData = {
  accounts: readonly RecordAccountOption[];
};

export type RecordAccountDialogResult = RecordAccountOption | 'new-account';

@Component({
  selector: 'accounts-record-account-dialog',
  templateUrl: './record-account.dialog.html',
  imports: [DialogShell, MatButtonModule, MatFormFieldModule, MatSelectModule],
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
