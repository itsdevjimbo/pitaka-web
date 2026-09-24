# Issue 245 — Reset password

## Visual review

The reset screen was opened locally with a placeholder token and inspected in desktop Light, Dark, and System appearance. The current system setting resolves to Dark. The centered reset card, Pitaka wordmark, password guidance, reveal control, and full-width submit action render in each view. Screenshots were captured in the task conversation for review; they are not stored as image files in this branch.

The responsive Dark view was also checked at a 320 CSS-pixel viewport: text wraps without clipping and the field, reveal control, and submit action remain reachable. At 400% browser zoom the page reflows without horizontal clipping; its lower controls remain reachable by scrolling vertically. The reveal and submit controls use 44px minimum hit-area styling. Keyboard traversal from the page heading through the password field, reveal control, and submit action was observed. Blurring an empty field shows its required error. The missing-link recovery state was checked to show generic recovery guidance and move focus to its heading. Chrome's accessibility tree exposes the page heading, secure password field, and named reveal button.

Screen-reader output was not manually checked with assistive technology. The page has no motion effects, so a reduced-motion setting was not separately exercised. Contrast was inspected in the rendered Light and Dark views; no numeric contrast ratio was measured. Component tests cover accessible labels, error linkage, focus behavior, and the pending announcement.

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
