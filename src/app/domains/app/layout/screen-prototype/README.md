# Pocket Pop screen layouts — throwaway review

**Current status:** the user selected **A for Accounts, Transactions and sign-in; B for Account detail and Goal detail**. Open `?variant=selected` (or omit `variant`) to carry those choices between routes. All remaining families now have sketches, documented in [the current stage-two review and coverage matrix](STAGE-TWO.md). Their default A composition is proposed, not approved. This update supersedes the historical first-stage limitations below where a sketch has since been added.

## Historical first-stage record

Question: which concrete composition should carry the approved Pocket Pop identity, navigation and tokens into the app? Three structures are available on existing route shapes with `?variant=A|B|C`.

First-stage selection is [recorded on the decision ticket](https://github.com/itsdevjimbo/pitaka-web/issues/221#issuecomment-5748686665). The full decision remains open for remaining-family choices and final layout validation.

## Run

From this branch/worktree, `npm ci` if dependencies are absent, then `npm run prototype:screens`.

Open <http://localhost:4321/app/accounts?variant=A&scheme=light>. The top selector switches the five representative screens. The floating bottom bar cycles A/B/C, also available through left/right arrow keys outside fields and dialogs. Appearance is System/Light/Dark and follows System live; review choices live in the URL. This does not implement the full browser-local persistence decision.

Choose **390px preview** or append `&width=phone` to create a real 390px iframe viewport. The frame contains the same route without `width`; it applies the same media queries as a narrow browser. The frame's outer URL remains its initial view while navigation inside it changes. Open full width returns to that initial route. Review chrome occupies an extra 88px below phone navigation; production navigation would sit at the safe-area bottom without this review bar.

| Composition             | Accounts                                                                   | Detail / history                                                          | Sign-in                                                                                 |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A — Card overview       | Broad total above separate balance cards, 1/2/3 columns by available width | Summary above full-width history; leading direction icons on wide screens | Large colored brand panel on left, unboxed form on right; focused form card on phone    |
| B — Summary + workspace | Summary column beside vertically arranged Accounts at ≥1200px              | Balance or Goal progress beside working history at ≥1200px; stacks below  | Form and right-hand brand panel inside one shared frame; unboxed phone form             |
| C — Compact ledger      | Horizontal summary strip above a continuous list with aligned amounts      | Compact history columns on desktop, full-width metadata/notes on phone    | Open editorial brand area and separate form card; phone card keeps a primary top border |

All use grouped desktop navigation, five phone destinations and contextual Record. More is an anchored phone panel. Sidebar group copy and More presentation are proposals. Brand copy is illustrative and does not establish a permanent tagline.

## Coverage in this stage

| Screen         | Route                    | Cases / interactions                                                                                                                                          |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts       | `/app/accounts`          | Everyday, crowded/long names/large and negative balances, empty, retired/no active; status filter and scoped total; menu placement; recording Account chooser |
| Account detail | `/app/accounts/everyday` | Balance and history; outgoing/incoming Transfers; retired explanation with Record hidden; long title/amount; record/refile layout                             |
| Transactions   | `/app/transactions`      | Compact history; working notes search and direction filter; filter disclosure; unsigned global Transfers; Load more fixture; no matches/empty                 |
| Goal detail    | `/app/goals/rainy-day`   | Progress, target, remaining amount, Contribution history including linked row, empty Contributions; contribution form placement                               |
| Sign-in        | `/auth/sign-in`          | Three branded desktop compositions, focused phone forms, appearance control; sample submit only                                                               |

`case=everyday|stress|empty|retired` supplies review fixtures. Retired is relevant to Accounts and Transactions; Goal/sign-in do not gain a new lifecycle state from that control. Account cards all lead to the representative Account detail; this is a layout fixture, not a real multi-Account data browser. The record chooser retains the selected sample Account explicitly.

### Deliberate limits

- This separate development entry point uses deterministic fixtures at existing route shapes. It does not use real sessions, API reads, or financial mutations. Normal `npm start` and production entry points are unchanged. The alternate route table is only built with the explicit `screen-prototype` configuration.
- Native HTML controls/dialog provide low-cost layout evidence in Angular. This is not completed Angular Material integration. Production should use the established components and DialogShell.
- Account-type, Account/Category/date filters show space and placement; only status, notes search and direction change fixtures. All filter semantics and ADR 0016 must survive later implementation. Pagination is local fixture state.
- Forms are representative layout sketches. Refilling all real Category/Tag/Transfer, Contribution edit, eligibility and recovery behavior remains necessary. In particular, linked Contribution amount/link remain immutable. No prototype form grants new domain capability.
- Goal lifecycle actions, target-reached/overdue/lifecycle groups, generated Transaction and Schedule filter examples, complete sign-in feedback/password reveal, remaining management/authentication screens, and a final coverage matrix are **not yet complete**. These must be added after the first composition review, before resolving this ticket.
- Budgets, Goals list, Schedules, Categories, Tags, Profile and remaining auth flows currently show an explicit next-stage notice rather than simulated product outcomes.
- Approved colors, type and shape are reused from the token resolution. Financial colors are separate from brand accents; negative Account balances stay neutral. Global Transfers are unsigned, Account-relative Transfers signed, destination-side actions read-only. Account summaries do not invent available/earmarked values absent from the current model.

## Evidence so far

- Angular development compilation succeeded; no API connection is needed.
- Visually inspected wide Light Accounts A, wide Light Goal detail B, and wide Light sign-in A.
- Inspected dark long-content Account detail B through the browser accessibility tree.
- Visually inspected a 390px Dark Transactions C viewport, Account chooser, and full-screen recording form with explicit Account context. The phone review prompted full-width long-note layout below title/amount.
- Final chosen compositions still require all width/scheme combinations, 320px and zoom/reflow, complete keyboard/focus paths, retired/empty and dense edge scenarios, and the remaining screen coverage. This evidence is not accessibility conformance or complete visual acceptance.

Do not merge this throwaway branch. The planning map owns decisions; production implementation belongs to a later effort.
