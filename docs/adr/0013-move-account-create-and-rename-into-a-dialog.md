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

## Amendment (2026-09-08): Category create is a dialog too

Issue #107 shipped the Categories screen with **create as an inline field**
pinned to the top of each pane, and argued explicitly against a dialog: a pane
*is* a kind, so there is no income-or-expense question to ask, and — unlike an
Account, which needs a type and a starting balance — nothing else to fill in
either. A one-field dialog looked like ceremony.

That is now reversed. Adding a Category opens `AddCategoryDialog`: the same
`DialogShell`-plus-form shape this ADR fixed, opened from an *Add* control on
the pane. The kind stays implicit — the dialog is handed the pane's kind and
states it in the title ("New expense category"), exactly as the rename dialog
does — so no kind control appears. `AddCategoryForm` sits beside
`RenameCategoryForm` as a near-mirror.

Why the reversal:

- **The original argument proved the wrong thing.** "No kind question to ask"
  does not imply "no dialog": the dialog omits the kind question too. What was
  left was a one-field create that happened to render in the pane instead of
  over it — and rename, its pair, was already a dialog. Splitting the pair
  across two shapes cost more than the dialog it saved.
- **The inline field carried bespoke weight** the dialog form does not: focus
  and blur choreography after a create, a touched/dirty reset so the emptied
  `required` field would not flash "Enter a name", and an unattributable error
  folded onto the name control because the pane had no room for a banner. The
  dialog form closes on success and shows a banner like every other form in the
  app.

Everything else this ADR settles is unchanged and now covers Category create:
`provideDialogDefaults()`, the `DialogShell` chrome and Escape, nothing
destructive inside the dialog, a re-read after the successful write (#107,
ADR 0017 — the screen re-reads cold rather than reconciling a returned figure),
and `withOverlayContainer()` in the specs.

## Amendment (2026-09-21): changed and pending editors do not close immediately

The original statement that Escape may discard a half-typed form is superseded.
An untouched editor still closes immediately. Once an editor changes, Escape,
Cancel, and the close control ask the person to **Keep editing** or **Discard
changes**, with initial focus on the safe action. While a save is pending,
ordinary dismissal is blocked and the dialog explains why. A successful save
may still close its editor directly.

`DialogShell` owns this policy so the close control and restored Escape behavior
cannot drift apart. Editors report only whether they are changed or pending;
they continue to own validation and writes. Session expiry is the deliberate
exception: `Session` closes protected overlays immediately, clears private
state, and sign-in explains that unsaved work was discarded.

## Amendment (2026-09-22): app navigation follows the editor dismissal policy

App and browser-history navigation now follows the same untouched, changed,
and pending rules as Escape and the close control. Material's automatic
navigation close stays disabled because it cannot ask before discarding.
Instead, `DialogShell` observes Router navigation while an editor is open:

- an untouched editor closes and navigation continues;
- a changed editor aborts the in-flight navigation and asks the person to Keep
  editing or Discard changes;
- a pending editor aborts navigation and explains that saving must finish.

If the person discards, the shell closes and resumes the exact captured URL.
The resumed navigation is explicitly allowed through while the closing
animation may still keep the shell alive. This central policy prevents each
editor from implementing its own router/history interception and keeps direct
links, browser Back, and in-dialog prerequisite links consistent. Session
expiry remains the exception described above and may discard immediately.
