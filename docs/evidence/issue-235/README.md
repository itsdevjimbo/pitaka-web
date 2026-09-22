# Issue 235 verification

Verified on 2026-09-22 against the Budget list and editor components' rendered service and dialog seams.

## Implemented behavior

- Budgets now use the approved full-width C composition: Current cycle comes first, followed by Future and Finished groups. The responsive ledger is a two-column card row on wide screens and stacks on phones.
- A current or finished Budget gives Spent priority over its ceiling, keeps full peso amounts in tabular figures, states the server-returned Cycle window, and spells out both under/left and over-ceiling outcomes. Future Budgets state their start day and ceiling without presenting an invented zero-Spent figure.
- The screen keeps Budget spending distinct from Goal funding. A Budget's Category and Period remain visible, and only the server-returned expense-only `amountSpent` figures are rendered.
- New, Adjust, and Remove retain their existing API and validation contracts. Editors now use the shared dirty/pending dismissal safeguards, invalid Submit remains enabled and focuses the first invalid field, and a 15-second uncertain write releases the editor with a refresh-before-retry explanation.
- A successful create, adjustment, or removal announces once and then reads fresh Cycle figures. If that reread fails, the previous ledger stays visible with **Saved, but couldn’t refresh**; retry only reads, and freshness-dependent actions stay unavailable until it succeeds. Removal confirmation starts on Cancel, and a successful removal moves focus to the next Budget action or the page heading.

## Automated verification

- Focused Budget suites: 110 tests passed across five files.
- Full application suite: 1,025 tests passed across 78 files.
- `npm run build`, `npm run lint`, `npm run check:format`, and `npm run check:changed -- --base origin/main`: passed.

## Limits

- The temporary worktree began without installed dependencies; `npm ci` installed the lockfile-resolved packages before verification.
- The focused rendered tests cover the Budget list's loading, initial error, empty, current/future/finished, over/under ceiling, dialog, validation, removal, stale, saved-stale, focus, retry, dirty dismissal, pending state, and uncertain-write recovery. Browser automation found no available browser surface, so an authenticated branch session and Light/Dark/System desktop/phone captures could not be produced. The required visual and assistive-technology review remains a user-review gate.
