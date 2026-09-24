# Issue #246: Confirm email verification

Route: `/auth/confirm-email`  
Verified against: the local development build from this branch.

## Automated checks

- The full suite passed (80 files, 1,104 tests).
- `npm run build`, `npm run lint`, `npm run check:format`, and `npm run check:changed -- --base origin/main` passed.
- Component tests cover automatic confirmation, signed-in and signed-out next steps, rejected and malformed links, pending/live states, retry, focus after retry, duplicate prevention, focus, request teardown, and resend behavior.
- The `AuthService` adapter tests cover its normalized rejected-link error and preserve field-validation errors as `ApiError`.

## Interaction and visual checks

- Captured desktop screenshots of successful confirmation and invalid-link recovery in System/Dark and Light. A further invalid-link capture shows the recovery form and its full-width resend action. The captures are visible in the implementation session output; no image files are committed.
- A local loopback mock returned `204` for a synthetic successful link and `400` for an invalid link. The success result showed “Email confirmed” and “Continue to sign in”; the rejected link showed the shared recovery form and resend action. No production API or real account was used.
- At 400% browser zoom, the card reflowed within the available width and the email field remained reachable by vertical scrolling. The browser zoom was returned to 100% after inspection.
- The browser accessibility tree exposed the confirmation result or invalid-link heading, email field, and resend button. The invalid-link state has a polite live announcement; focused headings and live-region attributes are also covered by component tests.
- The Appearance menu offered System, Light, and Dark. The browser preference was restored to System after inspection.

## Contrast calculation

The ratios below use the semantic foreground and background pairs rendered by the Light and Dark schemes. The primary palette is generated from `#304BC6`; its rendered `primary-200` value is `#bbc0f5`. Ratios use WCAG relative luminance and are rounded to two decimals.

| Rendered text       | Light foreground / background |   Ratio | Dark foreground / background |   Ratio |
| ------------------- | ----------------------------- | ------: | ---------------------------- | ------: |
| Heading and result  | `#1c2763` / `#ffffff`         | 13.82:1 | `#f0f2ff` / `#1d2443`        | 13.60:1 |
| Supporting copy     | `#596189` / `#ffffff`         |  6.01:1 | `#b4bedf` / `#1d2443`        |  8.21:1 |
| Retry message       | `#b91c1c` / `#feecec`         |  5.68:1 | `#ff8585` / `#442832`        |  5.61:1 |
| Filled action label | `#ffffff` / `#304bc6`         |  7.12:1 | `#12172f` / `#bbc0f5`        | 10.07:1 |

## Limits

- No real confirmation email was sent or delivered. The resend action was visually inspected; automated tests cover its request, announcement, duplicate prevention, fixed reassurance, and cooldown.
- No screen reader was run. Contrast ratios were calculated from the resolved semantic CSS colors, not sampled from a browser screenshot or checked with an accessibility inspection tool.
- Reduced-motion behavior was not emulated. The pending spinner uses the reduced-motion variant in its class list.
- The 400% zoom check approximated a phone-width viewport and covered reflow and access by scrolling in one desktop browser. No physical phone or device emulation was used, and other browser/OS combinations were not checked.
- The screenshots are available in the task session output rather than as image files in the repository.
