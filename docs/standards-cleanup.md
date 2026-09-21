# Repository standards cleanup plan

This is the agreed repo-wide cleanup plan, not authorization to execute every
migration in the standards change. The [standards](standards.md) apply to new and
changed code while the remaining repository is brought into line in separate,
reviewable changes. Preserve existing behavior and useful test coverage.

The inspection baseline on 2026-09-20 found 165 source files differing from the
existing Prettier configuration and 24 fixture-internals double assertions across
23 files. The migrations below refreshed those inventories before changing them;
the historical counts were starting points, not permanent allowances.

## 1. Formatting pass

Completed in [#251](https://github.com/itsdevjimbo/pitaka-web/issues/251), after the
component-test migration [#250](https://github.com/itsdevjimbo/pitaka-web/issues/250).
The refreshed inventory found 143 of 295 TypeScript and HTML source files needing
formatting. They were normalized mechanically with the existing Prettier policy,
with enforcement and documentation kept in a separate commit for review.
One raw `textContent` assertion was aligned with formatter-normalized template
whitespace in its own commit; rendered wording and application behavior are unchanged.

The full source tree now passes `npm run check:format`, and CI runs that check after
installing dependencies. The changed-file checker remains in CI and available for
local formatting and zero-warning lint feedback. Completion was verified with the
full-source format check, standards enforcement tests, changed-file checks, full
lint, application tests, and the production build.

## 2. Component test migrations

Tracked in [#250](https://github.com/itsdevjimbo/pitaka-web/issues/250).

Completed in #250 across Accounts, Categories, Tags, Budgets, Goals,
Transactions, Profile, Layout, and authentication. All inventoried casts were
replaced with rendered interactions or public component outputs, with no lint
exceptions remaining. The repository rule is now enforced as an error.

Validation for #250 includes the focused domain suites, the standards enforcement
suite, changed-file checks against `origin/main`, full-repository lint, and the
production build. The application suite was run in domain batches to keep each
browser test process bounded.

Find candidates with `rg 'componentInstance as unknown as' src` and the lint
diagnostics. Start with one representative form and one list, then migrate in
domain-sized batches: Accounts, Categories, Tags, Budgets, Goals, Transactions,
Profile, Layout, and authentication. Recheck other domains for alternate internal-access patterns.

Replace duplicated `*Internals` types and protected-method calls with rendered
interactions and observable assertions. Reuse `src/testing/overlay.ts` and existing
test setup helpers. Keep direct tests for extracted pure logic. Where a behavior
requires a narrow internal seam, record the specific reason at the access rather
than disabling a whole file or weakening production visibility.

Done for each batch when it preserves the prior behavioral scenarios, passes the
affected suites and changed-file checks, and introduces no undocumented internal
access. Once all diagnostics are resolved or justified, promote the fixture-cast rule
to an error in full-repository lint.

## 3. Comment and ADR reconciliation

Tracked in [#252](https://github.com/itsdevjimbo/pitaka-web/issues/252).

Completed in #252. ADR 0017 now owns the rationale and boundaries for the Category
label/filter cache and the Tag autocomplete cache, including invalidation, failed
reads and writes, and cold management readers. ADR 0006 remains authoritative for
financial freshness and no broader caching exception was introduced.

Repeated service and management-screen narratives were replaced with concise ADR
references while API shapes, error meanings, filtering rules, and refresh behavior
remain beside their implementations. Source, service specs, and ADR history were
checked without changing runtime behavior.

Verification: changed-file checks, the Category and Tag service suites (48 tests),
full-source formatting, full lint, the standards enforcement suite, the full
application suite (985 tests), and the production build.

## 4. Domain and asynchronous behavior audit

Tracked in [#253](https://github.com/itsdevjimbo/pitaka-web/issues/253).

Audit each resource domain's `index.ts`, imports, and routes. Cross-domain consumers
should use public exports; same-domain imports and route assembly retain their
intentional direct paths. Keep routed features out of resource barrels.

Review overlapping reads and writes separately: destruction cleanup, superseded
reads, dialog-dismissal behavior, and reconciliation of financial figures. Treat a
surviving write coordinator as a deliberate lifetime to verify, not an automatic
subscription leak. Add behavior tests only where an actual gap or defect is found.

Done when exceptions are explicit, any discovered fixes pass focused behavior
tests, and domain batches pass normal checks. Keep those fixes separate from the
formatting and comment changes.

## Completion

The cleanup is complete when fixture-cast diagnostics are resolved or individually
justified, documentation agrees with the implemented boundaries, and every resource
domain has been audited. Full-source formatting now passes and is enforced in CI.
Record completed batches and their verification here as they land; do not mark a
batch complete from a search count alone.
