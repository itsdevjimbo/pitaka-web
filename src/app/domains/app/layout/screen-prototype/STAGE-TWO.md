# Pocket Pop — second layout review

The user chose A for Accounts, Transactions and sign-in, and B for Account/Goal detail. `variant=selected` follows that mix. The initial recommendation of C for Transactions is superseded. No other composition has been approved yet.

Run `npm run prototype:screens`. Open <http://localhost:4321/app/budgets?variant=selected&scheme=light>. The top selector now reaches every agreed screen family. The sample-data cases include ordinary, crowded, empty, retired Account, error, invalid link and success, with cases applied only where meaningful. Add `width=phone` for a 390px iframe or `width=320` for a 320px iframe; both use real viewport media queries. These do not substitute for all browser zoom and assistive-technology checks.

## Current composition map

| Screen family        | Composition / status                          | Concrete evidence in the prototype                                                                                                                         |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts             | A selected                                    | Summary and balance cards; active/retired filter; crowded/long names/large and negative balances; Account chooser                                          |
| Account detail       | B selected                                    | Side summary on wide screens, stacked on phones; history, signed Transfers, read-only destination-side action; retired Record suppression                  |
| Transactions         | A selected                                    | Wide history and direction markers; stacked phone notes, filters, unsigned global Transfers, Load more                                                     |
| Goal detail          | B selected                                    | Progress beside Contribution history; linked Contribution editor preserves fixed amount/link                                                               |
| Budgets              | A proposed; B/C alternatives                  | Current/Future/Finished, current Cycle dates, Spent versus ceiling, overspending, future without progress, finished under/over phrasing                    |
| Goals list           | A proposed; B/C alternatives                  | Active/Completed/Abandoned, progress/target, funded and overdue examples, lifecycle menu placement, detail entry                                           |
| Schedules            | A proposed; B rail alternative                | Upcoming/Paused/Past; retired Account/Category labels; Pause/Resume/Extend placement; generated-history links; delete eligibility and stale-write controls |
| Categories           | A proposed; B stacked panes alternative       | Independent Expense/Income search and status controls, default read-only rows, Retired discovery, actions                                                  |
| Tags                 | A proposed; B rail alternative                | Inline creation, search, inline rename with Enter/blur/Escape, delete confirmation outside editor                                                          |
| Profile              | A proposed; B/C alternatives                  | Identity beside Email/Password on wide screens; all stack on phones; long values; pending change actions; editor sketches                                  |
| Sign-in              | A selected                                    | Branded desktop panel beside form; focused phone form; links to new auth sketches                                                                          |
| Sign-up              | Inherits A, proposed                          | Same desktop brand panel; name/email/password; password reveal; check-inbox replacement after sample submission, email kept in memory                      |
| Forgot password      | Compact centered card, proposed               | Email field, generic sent response, form retained for resend                                                                                               |
| Reset password       | Compact centered card, proposed               | New password, reveal, invalid-link recovery, sample success                                                                                                |
| Confirm email        | Compact centered card, proposed               | Automatic confirming state, success/invalid-link cases; no invented initial confirm button                                                                 |
| Confirm email change | Compact centered card, proposed               | Explicit Confirm change/Not now, invalid-link recovery, sample success                                                                                     |
| Shared editors       | Inherited desktop modal / phone fullscreen    | Representative financial/Profile forms; Escape/close/Cancel; no backdrop dismissal; no real writes                                                         |
| Shell / More         | Grouping already settled; copy/panel proposed | Day to day / Plan ahead / Organize; five phone destinations; anchored More panel with remaining destinations, appearance and sign-out                      |

A uses horizontal controls and cards or compact lists as appropriate. B moves planning controls into a side rail at wide widths, stacks Category panes, and groups Profile differently. C presents planning in continuous rows and Profile in horizontal sections. Some established families intentionally inherit a composition instead of multiplying alternatives with no unresolved structural question.

## Checks and remaining limits

- Standalone development compilation passes. Real application/session/production entry points stay unchanged.
- Wide Light Budgets A inspected visually. A 320px Dark Profile with long name/email and pending-email actions inspected at top and lower sections. A 320px Light invalid-reset-link recovery card inspected visually.
- Narrow Profile review exposed crowded phone destination labels; grid columns now give Transactions extra width with 12px labels.
- Native controls/dialog are sketches. Financial writes, real auth redemption, resend cooldown timing, API validation and failure recovery are not implemented; labels/actions represent existing workflows. Full appearance persistence is still outside this specimen.
- Check-inbox email is held in memory and not added to URLs. Confirmation/password-reset success paths represent signed-out examples; session-dependent redirect and refresh-failure variants remain required by the established auth behavior.
- Existing route-owned Accounts/Transactions filtering, dialogs and lifecycle rules remain constraints. Sketch fixtures do not establish changes to those behaviors. Extra state acceptance details belong to the existing interaction decision.
- Still to validate before resolving the screen ticket: the user's second-stage choices, final responsive exceptions, representative final composition combinations in both schemes, keyboard/zoom/reflow, complete Goal-detail lifecycle/generated-Transaction examples and a precise final coverage record. This is not a completed accessibility audit.

No production implementation, ADR/glossary changes, deployment or implementation PR. Keep this prototype on its throwaway branch.
