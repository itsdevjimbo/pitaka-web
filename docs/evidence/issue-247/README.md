# Issue 247 — Confirm email change

## Visual review

The local confirmation route was opened in Chrome at desktop size. The compact centered card, Pitaka wordmark, and shared Appearance menu were inspected in System, Light, and Dark. The invalid-link recovery state was also inspected in Light and Dark. A 400% zoom view showed the card filling the available width; the full page was not checked for scroll reachability. Screenshots were shown in the task conversation. No PNG artifacts are stored in this branch: the system screenshot export failed, and an isolated headless capture did not represent the expected phone viewport, so it was discarded.

The phone viewport, complete keyboard traversal, screen-reader output, reduced-motion behavior, and measured computed/composited contrast were not verified. The CSS gives primary actions a 44px minimum height; this was not measured as a rendered hit area. No live email-change link was used.

## Behavior

- Loading the link never redeems it. Confirm and Not now remain explicit choices, and Not now preserves the pending change.
- Confirmation progress is announced and duplicate submissions are ignored. Invalid or unavailable links show recovery with a focused heading.
- A signed-out success returns to sign-in with the existing changed-email reason. A matching signed-in Profile is refreshed before navigating to Profile; a refresh retry does not redeem the link again. A 401 expires the session.
- When another Profile is signed in, the link confirmation does not refresh or alter that session. Address-taken and invalid-link recovery offer actions appropriate to the active Profile.
- Component tests use rendered controls and observe AuthService, Session, and Router effects. No real confirmation API request was made, so the live email and token lifecycle were not exercised.

## Checks

Checks run on the issue branch:

- `npm run check:changed -- --base origin/main` — passed.
- `npm run check:format` — passed.
- `npm run lint` — passed.
- `npm test -- --watch=false` — 80 files and 1,113 tests passed.
- `npm run build` — passed.
