import { hasModifierKey } from '@angular/cdk/keycodes';
import { Component, inject, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

/**
 * The frame every app dialog renders inside. It supplies the chrome the dialogs
 * share — one heading, wired to the panel's `aria-labelledby`, and one close
 * control — and projects the dialog's own content (a form, usually) beneath it.
 *
 * It also puts Escape back. The app turns Material's close-on-Escape off
 * wholesale (`provideDialogDefaults`) because that is the only switch that also
 * makes a backdrop click inert, and a stray click must not discard a half-typed
 * form. Escape must still close the dialog — it is the exit keyboard and
 * screen-reader users rely on — so the shell listens for it on the dialog's own
 * key events. See ADR 0013.
 */
@Component({
  selector: 'app-dialog-shell',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="flex items-start justify-between gap-x-4 p-4 sm:p-6">
      <h2
        mat-dialog-title
        class="text-lg font-semibold tracking-tight"
      >
        {{ heading() }}
      </h2>
      <button
        matIconButton
        type="button"
        aria-label="Close"
        (click)="close()"
      >
        <mat-icon svgIcon="x" />
      </button>
    </div>

    <mat-dialog-content>
      <ng-content />
    </mat-dialog-content>
  `,
})
export class DialogShell {
  // Dependencies
  private dialogRef = inject<MatDialogRef<unknown>>(MatDialogRef);

  /** The dialog's title, announced with it and shown at the top of the panel. */
  readonly heading = input.required<string>();

  constructor() {
    this.dialogRef
      .keydownEvents()
      .pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event.key === 'Escape' && !hasModifierKey(event)) {
          event.preventDefault();
          this.close();
        }
      });
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
