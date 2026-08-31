import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  MAT_DIALOG_DEFAULT_OPTIONS,
  MatDialogConfig,
} from '@angular/material/dialog';

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
 * outside a half-typed form must not discard it. It also silences Escape, which
 * must keep working, so `DialogShell` re-enables Escape on the dialog's own key
 * events; every dialog picks that up by rendering the shell.
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
        panelClass: APP_DIALOG_PANEL_CLASS,
        width: '100%',
        maxWidth: '32rem',
        autoFocus: 'first-tabbable',
        restoreFocus: true,
      } satisfies Partial<MatDialogConfig>),
    },
  ]);
