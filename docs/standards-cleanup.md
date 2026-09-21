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

Inspection is complete in the
[domain-boundary and asynchronous-ownership audit](research/standards-audit.md).
It accounts for every resource domain, Profile, authentication/session, and
layout/shared coordination with file-and-line evidence. The audit confirms the
route-assembly and same-domain direct-import exceptions, the narrow Category and
Tag reference caches, fresh financial reads, and the deliberate surviving-write
owners for Schedule lifecycle changes and Transaction splits.

Remediation remains open and separate from the audit. The report records bounded
follow-up scopes for internal import deviations, dismissible dialog writes whose
results can lose their screen reconciliation, unsequenced refreshes that can apply
an older response last, Profile email reconciliation ordering, and component-owned
read observers that outlive their destroyed UI owners. Each runtime scope includes
a concrete behavior test; routed Profile, authentication, ordinary
Transaction-removal, and Linked Contribution-deletion navigation lifetimes remain
explicit product decisions rather than guessed cancellation changes.

Do not mark those follow-ups complete from the inspection alone. Land runtime
fixes separately with their focused behavior tests and normal repository checks.

## Completion

The repository-wide inspection is complete: fixture-cast diagnostics are resolved,
documentation agrees with the intended boundaries, and every resource domain has
been audited. Full-source formatting passes and is enforced in CI. The runtime and
import remediations linked from section 4 remain separate follow-up work; record
completed batches and their verification here as they land, and do not mark a batch
complete from a search count alone.
