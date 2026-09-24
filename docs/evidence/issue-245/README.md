# Issue 245 — Reset password

## Visual review

The reset screen was opened locally with a placeholder token and inspected in desktop Light and Dark appearance. Both views show the centered reset card, Pitaka wordmark, password guidance, reveal control, and full-width submit action. Screenshots were captured in the task conversation for review; they are not stored as image files in this branch.

The responsive Dark view was also checked at a 320 CSS-pixel viewport: text wraps without clipping and the field, reveal control, and submit action remain reachable. Keyboard traversal from the page heading through the password field, reveal control, and submit action was observed. Blurring an empty field shows its required error. The missing-link recovery state was checked to show generic recovery guidance and move focus to its heading.

Screen-reader output, reduced-motion settings, and 400% zoom were not manually checked. The reset screen has no motion effects. Component tests cover the accessible labels, error linkage, focus behavior, and pending announcement.

## Behavior and checks

- A well-formed link shows the form. Missing or malformed parameters show recovery without calling the reset API; a rejected reset token moves to that same recovery path.
- Invalid client-side passwords keep Submit enabled, focus the password field, and send no request.
- A pending request disables Submit, announces progress, and ignores duplicate submissions.
- Password field errors preserve the entered value and remain linked to the field. Other failures preserve the value and show the general error.
- Successful reset uses the existing session completion path, clears local session state, and routes to sign-in with the password-reset reason.
- No real reset token or API request was used. The browser check used a placeholder token; success, rejection, validation, and failure paths were exercised through the component and session tests.

Checks run on the issue branch:

- `npm run check:changed -- --base origin/main`
- `npm run check:format`
- `npm run lint`
- `npm test -- --watch=false` — 1,095 tests passed
- `npm run build`
