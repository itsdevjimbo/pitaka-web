# Issue 237 verification

Verified on 2026-09-22 against the Goal detail implementation and the rendered evidence captured while its prerequisite, issue 236, was completed.

## Scope inheritance

Issue 236 established the reusable Goal funding/date treatment and, to verify that treatment in its second required consumer, implemented the Goal detail workspace that issue 237 specifies. The merged implementation therefore already provides:

- the approved B side-summary/Contributions workspace above the `xl` breakpoint and its stacked narrow layout;
- complete contributed and target amounts, percentage, funding status, target date, and an independent overdue warning;
- complete newest-first Contribution history, including source Transaction context for Linked Contributions and explicit wording that earmarks do not move Account money;
- existing Contribution add/edit/delete behavior, immutable Linked Contribution fields, fresh Account-headroom reads, and Goal lifecycle eligibility;
- shared dirty/pending editor guards, validation behavior, safe destructive confirmations, stale-dependent action gating, and saved-but-refresh-failed recovery.

The implementation remains within the existing API and financial model. No new Goal, Contribution, or Account capability was introduced.

## Verification

The issue 236 evidence remains the rendered source of truth because it exercised the same production Goal detail component after the prerequisite and this ticket's overlapping implementation landed:

- [Goal detail — desktop Light](../issue-236/goal-detail-desktop-light.png): 1440×1000, with 475px / 581px summary and Contributions columns.
- [Goal detail — phone Dark](../issue-236/goal-detail-phone-dark.png): 390×844, with the page header, funding summary, and Contribution history stacked without horizontal overflow.

The existing Goal detail suite covers initial loading/error states, exact funding facts, the wide-layout seam, long Contribution history, Linked Contributions, lifecycle eligibility, safe confirmations, pending writes, uncertain deletion recovery, stale reads, saved-but-refresh-failed recovery, and superseded refreshes. Run it with:

```sh
npm test -- --watch=false --include=src/app/domains/app/goals/features/goal-detail/goal-detail.spec.ts
```

Checks run against this branch after the Goal-detail token and import cleanup:

- focused Goal detail suite: 17 tests passed;
- full repository suite: 1,041 tests passed across 79 files;
- `npm run check:changed -- --base origin/main`: passed;
- `npm run check:format`: passed;
- `npm run lint`: passed;
- `npm run build`: passed.

## Accessibility and visual evidence

The inherited rendered checks covered Light/Dark, desktop/phone, long names, full decimal amounts, reached/over-target/overdue/lifecycle cases, keyboard selection, accessibility-tree roles and names, 44px visible targets, and a 320 CSS-pixel reflow equivalent to 400% at 1280px. The Goal detail viewport had no horizontal clipping.

The Chrome accessibility-tree audit is not a manual screen-reader session. Goal detail was not separately captured in System mode, and reduced-motion and computed contrast were not re-audited on this screen after the shared foundations landed. The available computer-control environment exposed no browser surface for a fresh initial-error screenshot, so the two linked normal-state images predate this branch's semantic-token cleanup of that state. Manual screen-reader, System, reduced-motion, rendered-contrast, and final visual review therefore remain explicit release-level completion gates from the implementation handoff; this evidence does not claim those checks passed.
