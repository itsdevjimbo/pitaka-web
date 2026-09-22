# Issue 236 verification

Verified on 2026-09-22 against the rendered Goal list, detail, editor, and Contribution form seams.

## Implemented behavior

- Goals use the approved full-width C layout. Active, Completed, and Abandoned remain lifecycle groups; each Goal independently states its funding amount, percentage, date, and a text-and-icon badge for In progress, Target reached, or neutral Over target with the excess amount. An Active overdue Goal also carries its separate date warning.
- Goal detail shares the exact funding/date treatment in its wide B-style workspace. Long names can wrap beside lifecycle and action controls, and Contribution history retains the distinction between an earmark and moved money.
- First loads, initial errors, genuine empty states, refresh failures, and saved-write/failed-reread states use the shared accessible state component. A failed reread keeps the last Goal figures visible and makes funding-based completion unavailable until a fresh read succeeds.
- New/Edit Goal and Add/Edit Contribution editors now use the shared dirty-dismissal and pending-save guard. Invalid submit remains enabled, reveals errors, and moves focus to the first invalid field. A write that exceeds 15 seconds is not replayed; it returns to an editable state and asks the person to refresh the Goals screen first.
- Redesigned Goal surfaces use the approved semantic card, text, feedback, warning, danger, divider, and empty-state roles rather than the prior per-screen neutral, amber, and red styles.

## Automated verification

- Focused Goal suites: 41 tests passed across nine files.
- `npm run build`, `npm run lint`, and `npm run check:changed -- --base origin/main`: passed.
- Full repository suite: 1,031 tests passed across 79 files; `npm run check:format` also passed.

## Limits

- No browser automation surface was available in this session, so an authenticated branch session could not provide live Goal records, desktop/phone screenshots, keyboard and screen-reader traversal, 400% reflow, rendered contrast, or reduced-motion captures.
- The rendered tests cover the changed list/detail funding states, overdue/funding/lifecycle distinctions, empty/error/stale recovery, invalid Goal submit focus, and uncertain Goal/Contribution write recovery. Live workflow and visual accessibility review remain a user-review gate.
