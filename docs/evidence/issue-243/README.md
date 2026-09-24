# Issue 243 — Sign-up

## Visual review

The `/auth/sign-up` route was opened in Chrome at a wide desktop size during the correction and compared directly with the throwaway prototype. The screenshot is visible in the correction conversation. It shows the shared Pitaka / Appearance header, the rounded Pocket Pop brand panel with “Room for your everyday.” and the pocket mark, and the unboxed form on the right.

The form uses the existing self-hosted Pocket Pop logos and Outfit heading role. Its phone layout switches to a focused surface card and hides the desktop brand panel. This correction visually rechecked wide Light only; Dark and phone screenshots were not saved.

## Behavior and checks

- Registration success replaces the form in place with the check-inbox guidance and existing resend control. Registration does not sign the person in (ADR 0015).
- Invalid submission stays enabled, surfaces touched field errors, focuses the first invalid field, and sends no request.
- Pending submission prevents a second registration request and announces progress.
- Password reveal is keyboard-operable and exposes its state through an accessible label and pressed value.
- Registration failure, server field errors, duplicate email, and clearing stale error feedback remain covered by the existing rendered tests.
- No real registration request was submitted; that would create a Profile and send a confirmation email. The success and failure outcomes are exercised through the component's AuthService boundary.

Checks run from the issue branch:

- `npm run check:changed -- --base origin/main`
- `npm run check:format`
- `npm run lint`
- `npm test` — 1,076 tests passed
- `npm run build`
