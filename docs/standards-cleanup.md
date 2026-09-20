# Repository standards cleanup plan

This is the agreed repo-wide cleanup plan, not authorization to execute every
migration in the standards change. The [standards](standards.md) apply to new and
changed code while the remaining repository is brought into line in separate,
reviewable changes. Preserve existing behavior and useful test coverage.

The inspection baseline on 2026-09-20 found 165 source files differing from the
existing Prettier configuration and 24 fixture-internals double assertions across
23 files. Counts are a starting inventory, not permanent allowances.

## 1. Formatting pass

Tracked in [#251](https://github.com/itsdevjimbo/pitaka-web/issues/251), blocked by
the component-test migration [#250](https://github.com/itsdevjimbo/pitaka-web/issues/250).
Formatting legacy specs makes them subject to the zero-warning changed-file gate,
so resolve their existing warnings before starting the full formatting pass.

Make one formatting-only change across `src/**/*.{ts,html}` using the existing
Prettier configuration. Keep behavioral edits out of that change so reviewers can
verify the diff is mechanical. Run the formatter check, full lint, tests, and build.

Done when the entire source tree passes Prettier. Then add a full-source format
check in CI; keep the changed-file command useful for local feedback.

## 2. Component test migrations

Tracked in [#250](https://github.com/itsdevjimbo/pitaka-web/issues/250).

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
access. Once all warnings are resolved or justified, promote the fixture-cast rule
to an error in full-repository lint.

## 3. Comment and ADR reconciliation

Tracked in [#252](https://github.com/itsdevjimbo/pitaka-web/issues/252).

Start with `TagsService`, `CategoriesService`, and the Tags list's long narratives.
Retain non-obvious API contracts beside the mapping/error-handling code. Replace
repeated architectural reasoning with concise links to the authoritative ADR.

Reconcile ADR 0017's claim that Categories are the only cached collection with
TagsService's deliberate autocomplete cache. Record the actual distinction and
invalidation behavior; preserve ADR 0006's financial freshness requirement. Check
historical ADR descriptions against their amendments before shortening comments.

Done when architectural reasons have one authoritative home, useful contract facts
remain discoverable, links resolve, and no comment or ADR incorrectly describes the
current caching boundary. This is documentation work, not a cache redesign.

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

The cleanup is complete when full-source formatting passes, fixture-cast warnings
are resolved or individually justified, documentation agrees with the implemented
boundaries, and every resource domain has been audited. Record completed batches
and their verification here as they land; do not mark a batch complete from a
search count alone.
