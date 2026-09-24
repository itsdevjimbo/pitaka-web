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

The actual Profile page loaded at `http://localhost:4200/app/profile` in the existing authenticated development app. The dark desktop rendering showed composition A, separate Identity/Email/Password sections, and the current email in both relevant sections. No Profile write was submitted. The screenshot appeared in the browser output for this task, but the system screenshot command could not export it to a file (`could not create image from display`), so there is no PNG artifact in this branch.

Real Profile save and email workflows, screen-reader behavior, Light/Dark/System variants beyond the displayed dark desktop state, phone and long-content layouts, reduced motion, 400% reflow, and computed rendered contrast remain unverified. The browser screenshot is evidence of one rendered state, not a substitute for those checks.
