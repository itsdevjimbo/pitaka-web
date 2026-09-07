import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Category } from '../data/category';
import { RenameCategoryForm } from './rename-category-form';

/**
 * The *Rename* dialog: the rename form inside the shared shell, seeded with the
 * Category whose row menu opened it. Its heading states the kind — "Rename
 * expense category" — because the form drops the kind control (a `PUT` will not
 * move it) and a row reached by scrolling may have its pane heading off screen.
 * A successful rename closes the dialog with the renamed Category; Cancel and
 * the close control close it with nothing, and the row stays as it was.
 */
@Component({
  selector: 'categories-rename-category-dialog',
  imports: [DialogShell, RenameCategoryForm],
  template: `
    <app-dialog-shell [heading]="heading">
      <categories-rename-category-form
        [category]="category"
        (renamed)="dialogRef.close($event)"
        (cancelled)="dialogRef.close()"
      />
    </app-dialog-shell>
  `,
})
export class RenameCategoryDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<RenameCategoryDialog, Category>>(MatDialogRef);

  /** The Category being renamed, handed in when the dialog was opened. */
  protected readonly category = inject<Category>(MAT_DIALOG_DATA);

  /** "Rename expense category" / "Rename income category". */
  protected readonly heading = `Rename ${this.category.kind} category`;
}
