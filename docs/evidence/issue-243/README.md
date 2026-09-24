# Issue 243 — Sign-up

## Visual review

The `/auth/sign-up` route was opened in Chrome and captured at a wide desktop size in the task review. The screenshot is visible in the implementation conversation. It shows the approved A composition: Pocket Pop brand panel on the left, unboxed form on the right, and the shared Appearance menu in the auth shell.

The form uses the existing self-hosted Pocket Pop logos and Outfit heading role. Its phone layout switches to a focused surface card and hides the desktop brand panel. Dark and phone screenshots were not saved in this review.

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
