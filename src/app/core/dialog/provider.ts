import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';

/**
 * The class every app dialog's overlay panel carries. `material.css` keys the
 * responsive treatment off it — a centred card above the phone breakpoint, the
 * full screen below it.
 */
export const APP_DIALOG_PANEL_CLASS = 'app-dialog-panel';

/**
 * The application-wide `MatDialog` configuration, so a call site opens a dialog
 * by naming a component (and at most passing it data) and never configures how
 * the dialog behaves. See ADR 0013.
 *
 * `disableClose` is on because the backdrop must be inert — a stray click
 * outside a half-typed form must not discard it. Material navigation closing is
 * also disabled so `DialogShell` can distinguish untouched, dirty, and pending
 * editors before allowing the destination. `disableClose` also silences Escape,
 * which the shell re-enables on the dialog's own key events. Initial focus skips
 * shell controls and lands on the first editable field.
 */
export const provideDialogDefaults = (): EnvironmentProviders =>
  makeEnvironmentProviders([
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      // `MatDialog` merges this over a bare `MatDialogConfig` per call, so start
      // from the real defaults and override only what the app decides — miss
      // `new MatDialogConfig()` here and fields like `role` fall to `undefined`.
      useValue: Object.assign(new MatDialogConfig(), {
        disableClose: true,
        closeOnNavigation: false,
        panelClass: APP_DIALOG_PANEL_CLASS,
        width: '100%',
        maxWidth: '32rem',
        autoFocus:
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="combobox"], [contenteditable="true"]',
        restoreFocus: true,
      } satisfies Partial<MatDialogConfig>),
    },
  ]);
