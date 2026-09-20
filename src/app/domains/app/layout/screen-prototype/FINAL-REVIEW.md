# Pocket Pop — approved screen compositions

This is the final layout record for the throwaway prototype. It supersedes the provisional status and remaining-layout checklists in README's historical first stage and STAGE-TWO. The live issue resolution is authoritative for the decision. Nothing here authorizes merging prototype code or changing financial behavior.

## Approved composition matrix

| Screen family                | Selected composition                                 | Responsive layout and evidence                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts                     | A                                                    | Broad total and balance cards; grid becomes one column. Wide Light and 320px Dark inspected, including long names, large and neutral negative amounts.                                                                                           |
| Account detail               | B                                                    | Summary beside history at ≥1200px, stacked below. Dark long-content view and actual 200% zoom inspected; balance and history remain available by scrolling. Retired case suppresses Record.                                                      |
| Transactions                 | A                                                    | Full-width history with compact rows; metadata and notes wrap beneath title/amount on phones. Selected A checked at 320px Light with long notes and Dark with Generated marker and Schedule chip.                                                |
| Goal detail                  | B                                                    | Progress beside Contributions at ≥1200px, stacked below. Wide Light completed Goal and 320px Dark overdue Goal inspected. Same approved funding/date badges as the list. Active/reached/over-target/overdue/completed/abandoned cases available. |
| Budgets                      | C, full-width                                        | Preserve C's card/ledger structure, without its narrow centered content cap. Wide Light and 320px Dark long names inspected. Current/Future/Finished fixtures include ceiling, overrun and final-cycle phrasing.                                 |
| Goals list                   | C, full-width                                        | Same C container exception. Explicit funding and independent date badges approved. Wide Light/Dark and 320px Dark long names inspected, including wrapping reached, over-target and overdue labels.                                              |
| Schedules                    | A                                                    | Horizontal view controls and compact rows; phone amounts/actions stack. 320px Dark retired-Account warning inspected. Upcoming/Paused/Past and delete-eligibility examples available.                                                            |
| Categories                   | A                                                    | Independent Expense/Income panes side by side, one column below640px. 320px Light controls/default rows inspected. Each pane owns its search and status.                                                                                         |
| Tags                         | A                                                    | Inline creation/search and compact rows; long names and row actions wrap on phones. 320px Light crowded example inspected.                                                                                                                       |
| Profile                      | A                                                    | Identity beside Email/Password, stacked below900px. 320px Dark long name/email and pending-email actions inspected.                                                                                                                              |
| Sign-in                      | A                                                    | Desktop left brand panel/right form; focused phone card. Wide Light inspected in the first stage.                                                                                                                                                |
| Sign-up                      | Inherit A                                            | Same branding structure; check-inbox replacement after sample submit. 320px Dark form inspected.                                                                                                                                                 |
| Forgot/reset password        | Compact centered cards                               | Focused email/password/recovery content. 320px Light invalid-reset recovery inspected; sample success and resend layouts available.                                                                                                              |
| Confirm email / email change | Compact centered cards                               | Email confirmation starts automatically; email change has explicit Confirm/Not now. Sample success/invalid-link cases available, not real token redemption.                                                                                      |
| Shared editors               | Desktop modal, fullscreen below640px                 | Representative account/record/contribution/profile forms. 390px record and 320px contribution editors inspected. Basic Tab focus visible; Escape restored focus to Add contribution.                                                             |
| Shell                        | Approved grouped sidebar and five phone destinations | Day to day / Plan ahead / Organize. Phone Accounts/Transactions/Budgets/Goals/More; anchored More panel, appearance and Profile destinations. More and labels inspected at320px.                                                                 |

Widths above are prototype CSS breakpoints, not evidence of every possible device/zoom combination. The responsive family decisions are approved; production acceptance must exercise actual components and content.

## Goal status decision

The user explicitly confirmed this treatment after confirming full-width C:

- Put a visible icon-and-text funding badge directly below the Goal name: Target reached at the exact target, neutral Over target with the excess amount, or In progress below target.
- Add a separate Target overdue warning for an Active Goal with a past target date. A funded Active Goal may also be overdue, matching existing behavior.
- Show funding percentage, exact contributed/target amounts, and the overdue date in stronger text. Do not rely on color alone.
- Keep Active/Completed/Abandoned separate. Reaching the target does not mark a Goal complete automatically. Over-target is not an expense/error.

Goal-detail lifecycle menus preserve existing availability: only funded Active Goals expose Mark complete; Active exposes Abandon/Add contribution; non-Active exposes Mark active. Existing Contribution edit/delete remains available. Contribution edits preserve Account/amount/link and expose date/note. Destructive confirmations remain outside editors; this specimen sketches placement, not real confirmation workflows.

## Validation scope

- Angular screen-prototype compilation, formatting, and whitespace checks passed. No test suite is added for throwaway prototype code.
- Representative Light and Dark screens, wide layouts, real320/390px iframe viewports, long names/notes, large and negative balances, lifecycle warnings, filters and action placement were inspected. These checks informed the selected layouts, not a claim that every screen passed every width/scheme combination.
- Actual200% browser zoom on long-content Account detail switched to the phone navigation and stacked B composition. Balance/history remained readable by scrolling. Zoom restored to100% afterward. Review-only chrome consumes extra vertical space and can temporarily cover scrolled content; it does not ship.
- A representative phone editor had visible Tab focus; Escape closed it and restored its trigger. Full keyboard/menu/inline-editor traversal, focus trapping across actual Angular Material components, screen readers,400% reflow, reduced-motion/system-preference overrides, and all touch-target checks remain acceptance work for the interaction/accessibility decision. No accessibility-conformance claim is made here.

## Deliberate specimen limitations and next decision inputs

- All data and mutations are fixtures. Original application entry points, API behavior, sessions, route-owned filtering, browser-local appearance persistence, and financial semantics are unchanged.
- Account/Goal navigation points to representative details, not each row's separate record. Schedule history links use a representative generated salary fixture. Account/Category/date controls are placement-only; notes/direction and Schedule chip update the fixture. Samples do not validate API pagination or every recovery route.
- The generated marker and removable Schedule chip are present, including phone placement and Unknown Schedule fallback. Real date-only versus timed manual-row formatting and complete Back/refresh behavior remain existing implementation requirements.
- Native controls/dialogs provide layout evidence, not completed Angular Material/DialogShell integration. Destructive actions, busy/disabled states, authentication session-dependent recovery, complete sign-in errors/password reveal, validation, loading/stale/error/success copy and focus behavior belong to the existing interaction decision.
- There are no new domain terms or ADR decisions. Implementation, migration, appearance persistence and comprehensive visual/workflow acceptance belong to the remaining map decisions.

## Review/run

`npm run prototype:screens` on `prototype/pocket-pop-screens`.

Use `http://localhost:4321/app/goals?variant=selected&scheme=light`. Selected mix follows all approvals. Explicit A/B/C retain comparisons; C by itself retains the original centered width. `width=320` or `width=phone` creates a real320/390px viewport. Goal-detail cases include `success`, `over`, `overdue`, `completed`, `abandoned`, and `empty`.

Keep this source on the throwaway branch. Rewrite appropriately when implementing the approved design.
