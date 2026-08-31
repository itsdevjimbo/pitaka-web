---
status: accepted
---

# Move Account create and rename into a dialog

Adding an Account and renaming one used to happen in place: the new-account form
pushed the list and its total down the page, and choosing *Rename* turned the
row into a form so the Account's type, balance and retired badge vanished while
the person decided what to call it. Both now open in a modal dialog over the
Accounts list, and the list underneath does not move.

This is the app's first dialog, so it also fixes the shape every later one
follows.

## Material's dialog, not a hand-rolled overlay or a route

`@angular/cdk` and `@angular/material` are already dependencies, and the CDK
overlay powers the menus this screen already uses. `MatDialog` brings the parts
that are tedious and easy to get wrong by hand — a focus trap, `role="dialog"`
with `aria-modal`, `aria-labelledby` wired to the panel's heading, scroll
blocking, and focus returned to the opener on close — and it is configurable
application-wide through `MAT_DIALOG_DEFAULT_OPTIONS`.

A routed dialog (`/app/accounts/new`) was the alternative. It was rejected here:
creating or renaming an Account is a small side task on the list, not a place
worth a URL, a browser-history entry, or a deep link that has to rebuild the
list behind it. The dialog is a transient panel over a screen that stays live.

## Backdrop-close is off; Escape is on

A dialog closes on Escape, on Cancel, on its close control, and on a successful
save. It does **not** close on a backdrop click: a stray click outside a
half-typed form must not discard it. Escape stays — it is the exit keyboard and
screen-reader users rely on, and losing an unsaved draft to a deliberate
keypress is a fair trade where losing it to a mis-aimed click is not.

Material's `disableClose` is all-or-nothing: setting it silences the backdrop
**and** Escape. So the app sets `disableClose: true` in the global options and
`DialogShell` puts Escape back, subscribing to the dialog's own key events.
Every dialog gets that behaviour by rendering the shell, and no call site
configures close behaviour itself.

## Consequences

- `provideDialogDefaults()` registers the application-wide `MatDialog` config:
  `disableClose: true`, the shared `app-dialog-panel` class, and a bounded
  width. A call site opens a dialog by naming a component and, at most, passing
  it data.
- `DialogShell` (`app-dialog-shell`) supplies the chrome every dialog shares —
  one heading and one close control — and re-enables Escape. The two account
  forms keep their fields, validation and server-error attribution untouched;
  the new-account form drops the header it used to draw for itself now that the
  shell draws it.
- The responsive treatment lives in `material.css`, keyed off `app-dialog-panel`
  and the same 640px phone/desktop boundary the form-field and select
  adjustments already use: a centred, dimmed card above it, the full screen
  below it.
- Nothing destructive is reachable from inside a dialog. *Delete* keeps its
  inline confirmation on the row; *Retire* and *Reactivate* keep their place in
  the row menu.
- A successful create still shows the new Account from the server's returned
  balance and then re-reads the list to reconcile (ADR 0006); a successful
  rename still re-reads so the new name lands everywhere. A failed save leaves
  the dialog open with the person's input and the reason shown.
- `withOverlayContainer()` joins `withPinnedTimezone()` and `TEST_API_BASE_URL`
  as a spec-support seam: it reaches the overlay container the dialog renders
  into and tears it down after each test.
