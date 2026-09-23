# Issue 238 verification

Verified on 2026-09-23 against the production Schedule list, row, lifecycle, and editor components.

## Implemented behavior

- Schedules now use the approved full-width A composition: Upcoming is selected first, Paused and Past remain adjacent secondary views, and upcoming rows state that they are ordered by earliest generation.
- Compact ledger rows keep long names, complete tabular peso amounts, direction, Frequency, Account, Category, inclusive Last generation date, generated Transaction history, restrictions, and actions readable as one responsive unit.
- The screen and editors use the shared Pocket Pop surface, text, direction, warning, danger, focus, typography, loading, initial-error, and stale-state roles. Legacy emerald, rose, amber, red, and neutral screen colors were removed from the changed Schedule templates.
- Existing pause, resume, extend, edit, delete, history, retired-Account, retired-Category, conflict, and stale-data eligibility is preserved. A write followed by a failed reread retains the prior ledger, says **Saved, but couldn’t refresh**, and keeps freshness-dependent actions unavailable until Retry succeeds.
- Create, Edit, and Extend keep invalid Submit available, reveal validation and focus the first invalid field. Changed editors require Keep editing / Discard changes, pending editors cannot be dismissed, and a 15-second uncertain write releases the editor with refresh-before-retry guidance.
- Lifecycle and deletion confirmations start on the safe action. Successful deletion moves focus to the next Schedule or the page heading. Successful actions are announced in a status message while their server-authoritative reread runs.

## Automated verification

- Focused Schedule suites: 108 tests passed across five files.
- Full application suite: 1,047 tests passed across 79 files.
- `npm run build`, `npm run lint`, and `npm run check:format`: passed.
- `npm run check:changed -- --base origin/main`: passed.

## Visual and assistive-technology limits

- Chrome and the in-app browser were unavailable to the computer-use environment, so no fresh authenticated Light/Dark/System desktop or phone screenshots could be captured. The approved prototype remains a design reference, not verification evidence for this implementation.
- Rendered browser checks for actual 400% zoom, composited contrast, 44px targets, reduced motion, keyboard traversal, and a manual screen-reader session remain a user-review gate. Component tests cover the corresponding structure, focus movement, dialog containment, stale gating, full amounts, long-content wrapping classes, and accessible labels, but they are not a substitute for those browser checks.
