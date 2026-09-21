# Issue 232 verification

Verified on 2026-09-21 against the real development application, authenticated as the existing development Profile
and reading the live development API. The visual captures were taken from the production Angular components during
the implementation session; the throwaway screen prototype was not used as runtime evidence.

## Visual and interaction results

- Desktop Dark/System: the approved A composition renders a broad total card, two-column Account cards, neutral
  complete balances, status/type filters, management menus, and the labelled **Record transaction** action.
- Narrow phone Dark/System and Light: cards stack, names and amounts remain readable, the **Record** action floats
  above the fixed five-destination navigation, and the page retains space below its content for that navigation.
- Contextual recording: **Record transaction** opens an active-Account chooser, keeps retired Accounts out of the
  choices, hides the entry action while open, then hands the chosen Account to the existing recording form. Focus
  entered the Account chooser and then the Amount field in the recording form.
- Live writes: a disposable zero-balance Account was created, renamed, retired, reactivated, and deleted through the
  rendered UI. An actual ₱1.00 expense and balancing ₱1.00 income were recorded against the development Wallet; each
  successful write closed its form, triggered the fresh Accounts read, and changed the rendered Wallet balance from
  ₱550.00 to ₱549.00 and back to ₱550.00.
- 400% browser zoom: the shell switches to its phone composition; the total, cards, menus, Record action, and bottom
  destinations remain reachable by scrolling. Navigation labels wrap within their own destinations instead of
  overlapping adjacent controls.
- The browser preference was exercised in Light and System and restored to System after verification.
- macOS **Reduce motion** was enabled while the Accounts screen was open and then restored to its original off state.
  The Account loading indicators use `motion-reduce:animate-none`, and the shared reduced-motion rule removes
  nonessential animation and transition duration.
- The shared rendered control height is `2.75rem` (44 CSS px), applied to buttons, links, inputs, and selectors; the
  Account card action column also reserves 44 px. Token-pair contrast calculations for the rendered Account text were
  13.82:1 primary and 6.01:1 secondary in Light, and 13.60:1 primary and 8.21:1 secondary in Dark.

## Automated coverage

- The Accounts component suite covers load/error/empty/filter states, URL-owned filters, full totals, creation,
  rename, retire/reactivate, eligible and blocked deletion, explicit recording Account selection, no-active-Account
  recovery, stale-data action gating, saved-write/failed-reread feedback, and confirmation/deletion focus behavior.
- The shared recording form suite covers invalid-submit focus, dirty and pending dialog state, single submission, and
  the 15-second uncertain-write timeout that releases the form without retrying a financial write.
- Repository build, formatting, lint, and full tests are the final implementation gates recorded in the PR handoff.

## Limits

- The loading, initial-error, filtered-empty, stale, no-Account, and no-active-Account layouts were verified through
  rendered component tests rather than by altering the live development Profile or deliberately taking its API
  offline.
- Chrome's accessibility tree was inspected for headings, names, roles, dialog focus, menu actions, and navigation.
  A separate VoiceOver spoken-output session was not recorded.
- Session captures were presented for user review. macOS denied the automated screen-capture command, so the images
  could not also be checked into this directory.
