import { Component, inject, signal, viewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Category, CategoryKind } from '../../data/category';
import { AddCategoryForm } from './add-category-form/add-category-form';

/**
 * The *New category* dialog: the add form inside the shared shell, opened from a
 * pane's *Add* button and handed that pane's kind. Its heading states the kind —
 * "New expense category" — because the form carries no kind control (a pane *is*
 * a kind) and a pane reached by scrolling may have its heading off screen. A
 * successful create closes the dialog with the created Category; Cancel and the
 * close control close it with nothing, and the pane is unchanged.
 */
@Component({
  selector: 'categories-add-category-dialog',
  imports: [DialogShell, AddCategoryForm],
  template: `
    <app-dialog-shell
      [heading]="heading"
      [dirty]="dirty()"
      [pending]="pending()"
    >
      <categories-add-category-form
        [kind]="kind"
        (created)="dialogRef.close($event)"
        (cancelled)="shell().requestClose()"
        (dirtyChange)="dirty.set($event)"
        (pendingChange)="pending.set($event)"
      />
    </app-dialog-shell>
  `,
})
export class AddCategoryDialog {
  protected readonly dialogRef = inject<MatDialogRef<AddCategoryDialog, Category>>(MatDialogRef);
  protected readonly dirty = signal(false);
  protected readonly pending = signal(false);
  protected readonly shell = viewChild.required(DialogShell);

  /** The kind of the pane whose *Add* button opened the dialog. */
  protected readonly kind = inject<CategoryKind>(MAT_DIALOG_DATA);

  /** "New expense category" / "New income category". */
  protected readonly heading = `New ${this.kind} category`;
}
