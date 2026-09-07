import { FieldTree } from '@angular/forms/signals';
import { ApiError } from '@/app/core/api';
import { BoundServerError } from '@/app/core/forms';

/**
 * The one wording for a duplicate Category name, shared by the inline add field
 * and the rename dialog. It names the cross-kind rule on purpose (#107): the
 * API's uniqueness check spans both kinds and ignores Pitaka-supplied names, so
 * a generic "that name is taken" sends a person hunting through the Expense pane
 * for a name that is really sitting in Income.
 */
export function duplicateCategoryNameMessage(name: string): string {
  return `You already have a category called “${name}”. A name can only be used once, whether it files income or expenses.`;
}

/**
 * The add field and the rename form re-file the same failure the same way: the
 * only `409` these endpoints raise is a duplicate name, worded across kinds and
 * bound under the name control. This is that shared branch — it returns the
 * binding to hand back from a `submit()` action, or `null` when the error is
 * something else the caller must still handle its own way.
 */
export function duplicateNameBinding(
  error: unknown,
  nameControl: FieldTree<string>,
  typedName: string
): BoundServerError[] | null {
  if (error instanceof ApiError && error.status === 409) {
    return [
      {
        fieldTree: nameControl,
        kind: 'server',
        message: duplicateCategoryNameMessage(typedName),
      },
    ];
  }
  return null;
}
