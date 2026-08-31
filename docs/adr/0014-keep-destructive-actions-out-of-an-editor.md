---
status: accepted
---

# Keep destructive actions out of an editor

Removing a Transaction no longer starts by opening the re-file form. A
Transaction row's actions sit behind an ellipsis menu — the same affordance an
Account row uses — holding *Re-file* and *Remove*. Choosing *Remove* asks for
confirmation on the row itself, with the amount and date about to be erased
still on screen, and a removal the server rejects pins a notice to that row with
a *Try again*.

## What this replaces

Story 32 shipped removal **inside** the re-file form: a red *Remove* button in
the form's footer, an inline confirmation, and a `removed` output. The rationale
was recorded in `refile-transaction-form.ts`'s class comment — removal would
inherit the form's "recorded against" placement for free, since the form only
ever opened where a Transaction could be corrected (ADR 0010), so a Transfer
could only be removed from its home Account without any extra rule.

That rationale is now rejected. It shipped deliberately and a future reader will
find it in the history — commit `b83c2c9`, "feat: remove a Transaction, behind
an inline confirmation (#32)". The placement argument still holds, but it does
not require the button to live in the editor: the row already knows whether a
Transaction can be acted on here, and both the menu and its entries hang off
that one condition.

## Why

Erasing is not editing. Opening the re-file form to remove a Transaction means
opening an editor for a record you did not want to edit, scrolling past every
field, and pressing a destructive control that sits directly beneath the inputs
someone was just typing into — one stray click from the *Save* they meant to
press. A destructive control should not share a footer with a form's submit.

The row is the right home. The Transaction is still fully visible behind the
confirmation, so the amount and date about to be erased inform the decision. The
menu matches what an Account row already does, so the two lists read the same
way.

## Consequences

- The re-file form has no *Remove* button, no removal confirmation, no removal
  error message, and no `removed` output. Its class comment no longer argues for
  removal living inside it.
- `TransactionRow` owns the removal: the ellipsis menu, the on-row confirmation
  (`role="alertdialog"`), the delete request, and — on success — a `removed`
  output the detail screen turns into a fresh read of the balance and list
  (ADR 0006, never patched locally). The rows stay on screen throughout rather
  than blanking to a spinner.
- Both menu entries and the menu itself hang off `TransactionRow`'s
  `canActOnHere` — `recordedAgainst === null` — so ADR 0010's placement rule
  (a Transfer is acted on only from the Account it left) lives in one place. A
  Transfer seen from where it landed offers no menu and still links to its home.
- The row-notice pattern — a message pinned to one row with a retry — moved out
  of the accounts list into `app-row-notice` (`src/app/core/notices/`) so the
  Transactions list reuses it. The accounts list renders the same markup it did
  before through the shared component.
- Nothing destructive is reachable from inside an editor anywhere in the app.
  ADR 0013 already recorded, as a consequence of moving Account create and
  rename into a dialog, that nothing destructive is reachable from inside that
  dialog — *Delete* keeps its on-row confirmation, *Retire* and *Reactivate*
  keep their row-menu place. This ADR is the general rule those were instances
  of: *Remove* on a Transaction now follows the same shape.
