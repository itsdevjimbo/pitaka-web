import { FieldTree } from '@angular/forms/signals';
import { ApiError } from '@/app/core/api';

/** The form controls a screen can pin a server message onto, by field name. */
export type ServerErrorControls = Partial<Record<string, FieldTree<unknown>>>;

/** A server message bound onto the control for the field the server blamed. */
export type BoundServerError = {
  fieldTree: FieldTree<unknown>;
  kind: 'server';
  message: string;
};

/**
 * Split a rejected submit into the two things every signal-forms screen does
 * with one, identically:
 *
 * - messages the server pinned to a field this form has a control for are bound
 *   back onto that control, so they surface under the field;
 * - everything else — a message for a field this form has no control for, a
 *   non-field failure, or a throw that isn't an `ApiError` at all — folds into
 *   one banner line, `fallback` covering the last case.
 *
 * A field the server blamed with no control here would otherwise vanish, leaving
 * "correct the highlighted fields" pointing at nothing; its text goes to the
 * banner instead. `bannerMessage` is `null` only when every message found a
 * control. The adapter has already reduced every failure shape to one
 * display-ready `ApiError` (ADR 0002), so nothing here branches on transport
 * detail — a resource service that wants a status to land on a field attaches
 * the `fieldErrors` entry itself before it throws.
 */
export function partitionServerError(
  error: unknown,
  controls: ServerErrorControls,
  fallback: string
): { boundErrors: BoundServerError[]; bannerMessage: string | null } {
  if (!(error instanceof ApiError)) {
    return { boundErrors: [], bannerMessage: fallback };
  }

  const boundErrors: BoundServerError[] = [];
  const unattributed: string[] = [];
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const control = controls[field];
    if (control) {
      for (const message of messages) {
        boundErrors.push({ fieldTree: control, kind: 'server', message });
      }
    } else {
      unattributed.push(...messages);
    }
  }

  if (unattributed.length > 0) {
    return { boundErrors, bannerMessage: unattributed.join(' ') };
  }
  if (boundErrors.length === 0) {
    return { boundErrors, bannerMessage: error.message };
  }
  return { boundErrors, bannerMessage: null };
}
