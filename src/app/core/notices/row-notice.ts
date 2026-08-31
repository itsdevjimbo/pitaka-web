import { Component, input } from '@angular/core';

/**
 * A message pinned to a single list row after an action on that row failed —
 * a delete the server refused, a write that lost a concurrency race, a removal
 * that could not be sent. The row itself stays on screen: this box sits inside
 * it, red and carrying `role="alert"`, so the screen never lies about what
 * exists. The caller projects whatever way-forward the failure warrants — a
 * "Try again", a "Retire instead" — into the `row-notice-actions` slot; project
 * nothing and the notice is the message alone.
 *
 * Lifted out of the accounts list (story 54): the Transactions list pins the
 * same kind of message to a Transaction row after a failed removal, and the two
 * screens share this rather than a copy of its markup.
 */
@Component({
  selector: 'app-row-notice',
  template: `
    <div
      class="flex flex-col gap-y-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      <span class="font-medium">{{ message() }}</span>
      <ng-content select="[row-notice-actions]" />
    </div>
  `,
})
export class RowNotice {
  /** The line the person reads: what failed, and the way forward in words. */
  readonly message = input.required<string>();
}
