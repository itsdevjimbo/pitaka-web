import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { map, Observable } from 'rxjs';
import { DiscardChangesDialog } from './discard-changes-dialog';

/** Reuses the app's safe discard prompt for editors that render inline. */
@Injectable({ providedIn: 'root' })
export class EditorDismissal {
  private readonly dialog = inject(MatDialog);

  confirmDiscard(): Observable<boolean> {
    return this.dialog
      .open<DiscardChangesDialog, void, boolean>(DiscardChangesDialog, { role: 'alertdialog' })
      .afterClosed()
      .pipe(map((discard) => discard === true));
  }
}
