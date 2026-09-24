# Issue #244: Forgot password verification

Route: `/auth/forgot-password`  
Verified against: the local development build from this branch.

## Automated checks

- The focused forgot-password spec passed (8 tests).
- The full suite passed (80 files, 1,093 tests).
- `npm run build`, `npm run lint`, `npm run check:format`, and `npm run check:changed` passed.
- The route spec confirms the guest page includes the Appearance control.

## Interaction and visual checks

- Captured desktop screenshots of the initial card in Light and Dark, invalid-email feedback with focus on the email field, the generic result with its resend action, and the page at 400% browser zoom. At 400%, the card content reflowed and the submit and sign-in actions remained reachable by scrolling. The screenshots are in the implementation session output; no image files are committed.
- With an invalid address, Submit remains enabled, an email error appears, focus moves to the email field, and no request is made. Component tests cover this behavior as well as clearing the result after an address edit.
- A request using the reserved `.invalid` test address showed the same generic result and retained the address for retry. No real address was used and no delivery was verified.
- A component integration test drives the real `AuthService` through an HTTP 500, confirms the generic result, then retries through HTTP 202 with the same address.
- The Appearance menu exposes System, Light, and Dark. Light and Dark were visually inspected; behavior after changing the host operating-system appearance while System is selected was not verified.
- The browser responsive viewport was set to 320 CSS pixels; its accessibility tree still exposed Appearance, the email field, submit button, and sign-in link. A phone-sized screenshot was not captured.
- Keyboard Tab from the page document reaches Appearance and then Email address. Component tests assert the pending live status, busy state, disabled submit, duplicate prevention, generic failure response, and retry behavior.
- The global control-height token is 44px; the sign-in link has a 44px minimum height. These dimensions come from the rendered styles, not a separate manual pixel measurement.

## Contrast calculation

The ratios below use the screen's resolved semantic color roles and the generated primary palette, with WCAG relative-luminance calculation. The primary colors were observed in the loaded page's generated CSS (`primary-600` resolves to approximately `#314cc4`; `primary-200` to `#bcc0f2`). Values are rounded to two decimals.

| Rendered text      | Light foreground / background |   Ratio | Dark foreground / background |   Ratio |
| ------------------ | ----------------------------- | ------: | ---------------------------- | ------: |
| Heading and result | `#1c2763` / `#ffffff`         | 13.82:1 | `#f0f2ff` / `#1d2443`        | 13.60:1 |
| Supporting copy    | `#596189` / `#ffffff`         |  6.01:1 | `#b4bedf` / `#1d2443`        |  8.21:1 |
| Result panel text  | `#1c2763` / `#e0e6ff`         | 11.14:1 | `#f0f2ff` / `#303b66`        |  9.70:1 |
| Validation error   | `#b91c1c` / `#ffffff`         |  6.47:1 | `#ff8585` / `#1d2443`        |  6.46:1 |
| Submit label       | `#ffffff` / `#314cc4`         |  7.09:1 | `#12172f` / `#bcc0f2`        | 10.06:1 |
| Sign-in link       | `#314cc4` / `#ffffff`         |  7.09:1 | `#bcc0f2` / `#1d2443`        |  8.63:1 |

These are the authored foreground/background pairs used by the page and its Material controls. Browser rendering and screen-reader output were not independently audited with an accessibility inspection tool.

## Limits

- No screen reader was run. The result and pending text use polite live regions, and tests inspect those attributes and states.
- Reduced-motion behavior was not emulated. The page adds no transitions or animations; the shared stylesheet applies the reduced-motion override.
- The 400% check covered page reflow and reachability, not every browser/OS combination.
- The local UI check cannot verify production email delivery. The integration test exercises the actual client service and HTTP error path with a test HTTP backend; it does not contact the production API.
- Long monetary amounts and empty/loading dashboard states do not apply to this recovery screen.
