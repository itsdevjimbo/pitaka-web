# Pocket Pop — second layout review

**Archived review history:** the user has now confirmed the full-width C composition and Goal-status treatment. [FINAL-REVIEW.md](FINAL-REVIEW.md) supersedes this document's provisional status and remaining-layout checklist, and records final evidence versus deferred interaction acceptance.

The user chose A for Accounts, Transactions, Schedules, Categories, Tags, Profile and sign-in, and B for Account/Goal detail. Budgets and Goals list use **C's existing card/ledger design**, across the available content width instead of its narrow centered container. Sign-up inherits A; recovery and confirmation use compact centered cards. Sidebar headings and the phone More panel are approved. `variant=selected` follows that mix. The initial recommendation of C for Transactions is superseded.

The user clarified that the previous compact A-style card grid was not what they meant. That revision is superseded. Selected Budgets and Goals now resolve to C; only their content max-width cap and auto-centering are removed. C's card structure, typography, spacing and phone stacking remain unchanged. Explicit A/B/C retain their original structures for comparison.

The user subsequently confirmed the full-width C layout, but found reached, over-target and overdue Goals hard to distinguish. The revised Goal rows add visible icon-and-text badges directly below the name: **Target reached** (exact target, income/success color), **Over target · amount** (neutral, not an expense/error), **In progress**, and an independent **Target overdue** warning. Funding percentage and the dated overdue label reinforce the distinction. The existing Active/Completed/Abandoned lifecycle remains separate; funding does not auto-complete a Goal. As in the current application, an Active Goal with a past target date can be both funded and overdue. Everyday fixtures now show all four funding/date examples; the crowded fixture also shows reached plus overdue together. This status treatment is proposed for visual feedback; the underlying C composition is confirmed.

Run `npm run prototype:screens`. Open <http://localhost:4321/app/budgets?variant=selected&scheme=light>. The top selector now reaches every agreed screen family. The sample-data cases include ordinary, crowded, empty, retired Account, error, invalid link and success, with cases applied only where meaningful. Add `width=phone` for a 390px iframe or `width=320` for a 320px iframe; both use real viewport media queries. These do not substitute for all browser zoom and assistive-technology checks.

## Current composition map

| Screen family        | Composition / status                        | Concrete evidence in the prototype                                                                                                                         |
| -------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts             | A selected                                  | Summary and balance cards; active/retired filter; crowded/long names/large and negative balances; Account chooser                                          |
| Account detail       | B selected                                  | Side summary on wide screens, stacked on phones; history, signed Transfers, read-only destination-side action; retired Record suppression                  |
| Transactions         | A selected                                  | Wide history and direction markers; stacked phone notes, filters, unsigned global Transfers, Load more                                                     |
| Goal detail          | B selected                                  | Progress beside Contribution history; linked Contribution editor preserves fixed amount/link                                                               |
| Budgets              | C selected, full-width rather than centered | Current/Future/Finished, current Cycle dates, Spent versus ceiling, overspending, future without progress, finished under/over phrasing                    |
| Goals list           | C selected, full-width rather than centered | Active/Completed/Abandoned, progress/target, funded and overdue examples, lifecycle menu placement, detail entry                                           |
| Schedules            | A selected                                  | Upcoming/Paused/Past; retired Account/Category labels; Pause/Resume/Extend placement; generated-history links; delete eligibility and stale-write controls |
| Categories           | A selected                                  | Independent Expense/Income search and status controls, default read-only rows, Retired discovery, actions                                                  |
| Tags                 | A selected                                  | Inline creation, search, inline rename with Enter/blur/Escape, delete confirmation outside editor                                                          |
| Profile              | A selected                                  | Identity beside Email/Password on wide screens; all stack on phones; long values; pending change actions; editor sketches                                  |
| Sign-in              | A selected                                  | Branded desktop panel beside form; focused phone form; links to new auth sketches                                                                          |
| Sign-up              | Inherits A, selected                        | Same desktop brand panel; name/email/password; password reveal; check-inbox replacement after sample submission, email kept in memory                      |
| Forgot password      | Compact centered card, selected             | Email field, generic sent response, form retained for resend                                                                                               |
| Reset password       | Compact centered card, selected             | New password, reveal, invalid-link recovery, sample success                                                                                                |
| Confirm email        | Compact centered card, selected             | Automatic confirming state, success/invalid-link cases; no invented initial confirm button                                                                 |
| Confirm email change | Compact centered card, selected             | Explicit Confirm change/Not now, invalid-link recovery, sample success                                                                                     |
| Shared editors       | Inherited desktop modal / phone fullscreen  | Representative financial/Profile forms; Escape/close/Cancel; no backdrop dismissal; no real writes                                                         |
| Shell / More         | Grouping, copy and panel selected           | Day to day / Plan ahead / Organize; five phone destinations; anchored More panel with remaining destinations, appearance and sign-out                      |

A uses horizontal controls and cards or compact lists as appropriate. B moves planning controls into a side rail at wide widths, stacks Category panes, and groups Profile differently. C presents planning in continuous rows and Profile in horizontal sections. Some established families intentionally inherit a composition instead of multiplying alternatives with no unresolved structural question.

## Checks and remaining limits

- Standalone development compilation passes. Real application/session/production entry points stay unchanged.
- Corrected C revision: visually inspected Light Budgets and Dark Goals on desktop; both preserve C's existing rows and fill the workspace. Narrow-layout revalidation remains outstanding.
- Goal-status revision: Angular build passes; inspected Light desktop Goals and Dark 320px long-name Goals, scrolling to verify reached, over-target and overdue badge wrapping. Color is reinforced with explicit labels and icons. Narrow Goals retain C's stacking without horizontal clipping in the inspected cases. These checks are not a complete accessibility audit.
- Historical check of the superseded compact A-style grid: Light Budgets and Dark Goals on desktop, plus Dark Goals with long names at 320px. This does not validate the corrected C layout.
- Wide Light Budgets A inspected visually. A 320px Dark Profile with long name/email and pending-email actions inspected at top and lower sections. A 320px Light invalid-reset-link recovery card inspected visually.
- Narrow Profile review exposed crowded phone destination labels; grid columns now give Transactions extra width with 12px labels.
- Native controls/dialog are sketches. Financial writes, real auth redemption, resend cooldown timing, API validation and failure recovery are not implemented; labels/actions represent existing workflows. Full appearance persistence is still outside this specimen.
- Check-inbox email is held in memory and not added to URLs. Confirmation/password-reset success paths represent signed-out examples; session-dependent redirect and refresh-failure variants remain required by the established auth behavior.
- Existing route-owned Accounts/Transactions filtering, dialogs and lifecycle rules remain constraints. Sketch fixtures do not establish changes to those behaviors. Extra state acceptance details belong to the existing interaction decision.
- Still to validate before resolving the screen ticket: corrected full-width C planning layouts, final responsive exceptions, representative final composition combinations in both schemes, keyboard/zoom/reflow, complete Goal-detail lifecycle/generated-Transaction examples and a precise final coverage record. The second-stage composition choices are recorded above. This is not a completed accessibility audit.

No production implementation, ADR/glossary changes, deployment or implementation PR. Keep this prototype on its throwaway branch.
