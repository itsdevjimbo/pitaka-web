# Issue 241 validation

Date: 2026-09-24  
Branch: `feat/241-redesign-profile`

## Automated checks

- `npm run build` — passed.
- `npm run lint` — passed.
- `npm run check:format` — passed.
- `npm run check:changed` — passed.
- Profile feature specs — 4 files, 29 tests passed.
- Dialog shell and Transaction split specs — 2 files, 24 tests passed after updating their `MatDialogRef` test doubles for `afterOpened()`.
- Full suite — 80 files, 1,072 tests passed.

## Scope and limits

The tests render Profile sections and exercise identity/password saves, pending email actions, validation and focus, save failures, changed-form dismissal, and Profile route navigation through the public Auth/Session interfaces. The route test covers Profile teardown when the Session Profile becomes `null`; no app-level session-expiry recovery workflow test was added, per the agreed test seam.

The development app's sign-in screen rendered in a fresh browser session. I did not enter credentials or reach Profile. The authenticated session already open in the original checkout is scoped to its `localhost:4200` origin; the temporary build used `localhost:4321`. The original checkout also has uncommitted Tags changes on `feat/240-redesign-tags` in files that differ from this branch, so switching it would risk those changes.

No Profile screenshot was captured. Manual real-API Profile workflows, screen-reader behavior, Light/Dark/System screen states, phone and long-content layouts, reduced motion, 400% reflow, and computed rendered contrast remain unverified. The browser sign-in view and component-test fixtures are not presented as evidence for those checks.
