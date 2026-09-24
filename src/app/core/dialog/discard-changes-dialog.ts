import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from './dialog-shell';

/** The shared safe choice shown before an inline editor discards its draft. */
@Component({
  selector: 'app-discard-changes-dialog',
  imports: [DialogShell, MatButtonModule],
  template: `
    <app-dialog-shell heading="Discard changes?">
      <p class="text-sm text-secondary">Your changes will not be saved.</p>
      <div class="mt-5 flex flex-wrap justify-end gap-2">
        <button
          matButton
          class="min-h-11"
          type="button"
          (click)="close(false)"
          data-dialog-initial-focus
        >
          Keep editing
        </button>
        <button
          matButton="filled"
          class="min-h-11"
          type="button"
          (click)="close(true)"
        >
          Discard changes
        </button>
      </div>
    </app-dialog-shell>
  `,
})
export class DiscardChangesDialog {
  private readonly dialogRef = inject<MatDialogRef<DiscardChangesDialog, boolean>>(MatDialogRef);

  protected close(discard: boolean): void {
    this.dialogRef.close(discard);
  }
}
