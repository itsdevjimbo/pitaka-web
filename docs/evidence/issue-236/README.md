# Issue 236 verification

Verified on 2026-09-22 against the rendered Goal list, detail, editor, and Contribution form seams and against an authenticated local development workflow in Chrome.

## Implemented behavior

- Goals use the approved full-width C ledger: one continuous surface fills the available workspace, with Goal rows separated by dividers. It is not an independent two-column card grid. The selected Active, Completed, or Abandoned collection is the only one rendered; the segmented control exposes `aria-pressed`, keeps keyboard focus on selection, and shows the selected result count or lifecycle-specific empty state.
- Every row keeps its wrapping Goal name and actions together, puts the icon-and-text funding badge immediately beneath the name, and reflows its funding facts from two desktop columns into a phone stack. Contributed and Target amounts remain separate and complete; percentage, exact remaining/excess amount, target date, independent overdue warning, and View Contributions remain visible.
- Goal detail uses the approved B composition. Its Goal name, lifecycle and actions live in the page header; the funding summary sits beside Contributions at the 1200px breakpoint and stacks below it. The summary reuses the list funding/date treatment and explicitly explains that Contributions earmark Account money rather than move it.
- First loads, initial errors, genuine empty states, refresh failures, and saved-write/failed-reread states use the shared accessible state component. A failed reread keeps the last Goal figures visible and makes funding-based completion and Contribution changes unavailable until a fresh read succeeds; a missing or inaccessible Goal instead replaces the stale screen with a safe return to Goals. Ambiguous Contribution deletion is reconciled with reads and never replays the delete. Successful changes are announced quietly, and deletion restores focus to the next item or section heading.
- New/Edit Goal and Add/Edit Contribution editors now use the shared dirty-dismissal, app-navigation, and pending-save guard. Dirty navigation is aborted until the person chooses Keep editing or Discard changes; discard then resumes the exact destination. Invalid submit remains enabled, reveals errors, and moves focus to the first invalid field. A write that exceeds 15 seconds is not replayed; it returns to an editable state and asks the person to refresh the Goals screen first.
- Redesigned Goal surfaces use the approved semantic card, text, feedback, warning, danger, divider, and empty-state roles rather than the prior per-screen neutral, amber, and red styles.

## Automated verification

- Focused Goal suites: 48 tests passed across nine files.
- Rendered list tests select Active, Completed, and Abandoned, verify selected-state semantics and focus, preserve the selected lifecycle through refresh, exercise lifecycle-specific empty states, and assert that rows share one ledger surface.
- Rendered detail tests keep the page hierarchy outside the summary and verify the wide B workspace seam. Existing suites continue to cover loading, initial error, stale/saved-stale recovery, unavailable funding writes, confirmations, uncertain deletes, empty Contributions, editor validation and dirty/pending dismissal safeguards.
- `npm run build`, `npm run lint`, `npm run check:changed -- --base origin/main`, and `npm run check:format`: passed.
- Full repository suite: 1,041 tests passed across 79 files.

## Rendered browser evidence

An isolated local Profile with real API Goal, Account, and Contribution records was rendered in Chrome. The data covered in-progress, reached-and-overdue, over-target, completed, abandoned, long-name, full-decimal-amount, and Contribution-history cases.

- [Goals list — desktop Light](goals-list-desktop-light.png): 1440×1000; one 1080px-wide continuous ledger with three divider-separated Active rows.
- [Goals list — desktop Dark](goals-list-desktop-dark.png): 1440×1000.
- [Goals list — phone Light](goals-list-phone-light.png): 390×844; long name and full amounts wrap/stack without horizontal overflow.
- [Goal detail — desktop Light](goal-detail-desktop-light.png): 1440×1000; computed workspace columns were 475px / 581px.
- [Goal detail — phone Dark](goal-detail-phone-dark.png): 390×844; page header, summary, and Contributions stack cleanly.

Chrome's accessibility tree exposed Active, Completed, and Abandoned as buttons with true/false pressed states. Space selected Completed and focus remained on Completed. At 390px, all visible list and detail links/buttons measured at least 44×44px. A 320 CSS-pixel viewport (the reflow equivalent of 400% zoom from 1280px) had `scrollWidth === clientWidth` on Goal detail, with a single 288px workspace column and no horizontal clipping. Light and Dark screenshots were visually inspected after capture.

## Limits

- The Chrome accessibility-tree audit verifies roles, names, pressed state and keyboard focus, but it is not a manual screen-reader session.
- The 400% result uses the standards-equivalent 320 CSS-pixel viewport rather than browser chrome zoom controls. Reduced-motion behavior and computed contrast were not re-audited in this correction; they remain covered by the shared Pocket Pop foundation evidence and should stay in final user review.
