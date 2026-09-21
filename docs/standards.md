# Coding standards

These rules apply to new code and files changed for a task. Existing deviations are
tracked in the [repository cleanup plan](standards-cleanup.md); cleanup of unrelated
files stays in separate changes. Review changed code against this document and the
relevant ADRs. An existing pattern is evidence, not permission to repeat a documented
deviation.

## Sources of truth

- [CONTEXT.md](../CONTEXT.md) owns product terminology. Use its names in code, tests,
  routes, and user-facing text.
- [ADRs](adr/) own architectural decisions and their rationale. Read those relevant
  to the behavior being changed; surface a contradiction before replacing a decision.
- [ESLint](../eslint.config.ts), [Prettier](../prettier.config.ts), and
  [TypeScript](../tsconfig.json) own mechanical rules. Use their configuration rather
  than maintaining another list of indentation, import order, and compiler settings.

## Organize by domain and responsibility

Keep resource models, HTTP adapters, and domain calculations in the owning domain's
`data/`; routed screens in `features/`; reusable forms, rows, and dialogs in `ui/`.
Use `app/core/` for capabilities shared across domains, such as money formatting,
session handling, and dialog infrastructure. Share a helper when consumers need the
same rule; similarity alone does not establish shared behavior.

Apply responsibility-based grouping throughout the repository. When a directory
mixes distinct responsibilities, introduce named subfolders so a reader can locate
the relevant capability without scanning unrelated files. Keep each implementation
with its templates, styles, tests, and private helpers. Small, cohesive folders may
stay flat; there is no fixed file-count limit or requirement to wrap every file or
component in its own directory. Avoid vague catch-all folders such as `misc/` or
`helpers/` that hide ownership.

Use `schedules/ui/` as the example: `new-schedule/` holds its dialog and form,
while `schedule-row/` holds its component, template, and test. Group existing shared
editors together when their forms or validation belong to the same responsibility.
Apply the same principle within `data/`, `features/`, and shared capabilities;
preserve the domain and layer boundaries above. Folder names should describe the
responsibility, and extra nesting should make navigation clearer.

Import another resource domain through its `index.ts`. Within a domain, use direct
relative imports. Export only the vocabulary and capabilities other domains need;
keep routed screens lazy-loaded from their concrete paths. Route assembly is the
intentional exception to the domain entry-point rule.

```ts
// Another domain's public capability.
import { AccountsService } from '@/app/domains/app/accounts';
// This domain's implementation.
import { GoalsService } from '../../data/goals.service';
```

Use default exports for routed feature components and named exports for reusable
UI, services, and helpers, matching the existing route and barrel conventions. Use
`type` for type definitions; the lint configuration enforces this choice.

## Control-flow braces

Always use braces for `if`, `else if`, and `else` bodies, including single-statement
guards, returns, and throws. Loops also require braces. Keep normal `else if`
chains; each condition's body must be a block. ESLint enforces this with
`curly: ['error', 'all']` in production code and tests.

```ts
if (!save) {
  throw new Error('Expected the Save button');
}
```

## Components, state, and asynchronous work

Follow the existing standalone component and `inject()` patterns. Keep
implementation dependencies private and template-only members protected. Use
signals for mutable view state and `computed` for derived reactive state. Keep
parameterized calculations as functions; a function is not automatically a signal.

```ts
protected readonly goals = signal<readonly Goal[]>([]);
protected readonly activeGoals = computed(() =>
  this.goals().filter((goal) => goal.status === 'Active'),
);
```

Keep HTTP work in adapters; screens coordinate requests and represent loading,
empty, success, and failure states explicitly. Bind component-owned subscriptions
to their destruction using `takeUntilDestroyed`. For reads that can overlap,
cancel or identify superseded requests so an older result cannot replace a newer
selection. Destruction alone does not solve request ordering.

A write that must survive a dismissed dialog needs an explicit owner outside that
dialog, as in `ScheduleLifecycleCoordinator`. Explain that lifetime at the owner;
do not mechanically add component cancellation to an intentionally surviving write.

Use the existing signal-form and shared server-error helpers for forms. Preserve
the person's input on failure and prevent duplicate submissions. Reuse
`DialogShell` and the shared dialog defaults; follow
[ADR 0013](adr/0013-move-account-create-and-rename-into-a-dialog.md) and
[ADR 0014](adr/0014-keep-destructive-actions-out-of-an-editor.md) for editing and
destructive actions.

## API boundaries and financial correctness

Keep wire types, wire-name translation, parsing, and endpoint-specific error
interpretation in the resource adapter. Components consume domain models and
normalized errors. Follow [ADR 0002](adr/0002-hand-write-the-api-client.md) and
[ADR 0003](adr/0003-translate-three-domain-terms-at-the-adapter.md); preserve API
names except for the deliberate translations they record.

```ts
// Inside the Schedule adapter; wire names stop here.
return {
  firstGeneration: parseCalendarDate(resource.startDate),
  lastGeneration: resource.endDate === null ? null : parseCalendarDate(resource.endDate),
};
```

This excerpt illustrates the mapping boundary, not a complete Schedule factory.
Use the domain's existing date conversion helper.

Read balance-bearing data freshly and reconcile balance-changing writes with a
server read, following [ADR 0006](adr/0006-never-render-a-balance-from-cache.md).
Do not infer a new balance by arithmetic on a remembered figure. The existing
Category reference and Tag autocomplete caches invalidate inside their services
after writes and discard failed fetches. Their boundaries and distinct rationales
are recorded in
[ADR 0017](adr/0017-cache-categories-and-invalidate-on-write.md); neither
authorizes caching financial figures.

Use the shared money helpers. Distinguish instants from calendar days before parsing
or formatting dates: Transaction date behavior is specified in
[ADR 0007](adr/0007-render-transaction-dates-in-local-time.md), and Budget calendar
days in [ADR 0011](adr/0011-model-a-budgets-dates-as-calendar-days.md). Reuse the
corresponding domain converters and test timezone-sensitive boundaries.

## Test observable behavior

Component tests default to rendered interactions and observable outcomes: enter
values, activate controls, and assert text, enabled states, navigation, emitted
outputs, or requests to the component's dependencies. Keep pure calculation tests
direct and adapter tests at the HTTP boundary. Use typed fixtures and dependency
stubs; an assertion must not conceal missing behavior the test relies on.

```ts
const element = fixture.nativeElement as HTMLElement;
const save = Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save');
if (!save) {
  throw new Error('Expected the Save button');
}
save.click();
await fixture.whenStable();
fixture.detectChanges();
expect(element.textContent).toContain('A Goal with this name already exists.');
```

Use accessible labels, text, roles, and existing overlay helpers to find controls.
Cover relevant failure, retry, in-flight, and stale-response behavior, not only
successful submission. Synchronize with the operation or fixture instead of adding
arbitrary delays. Keep each test's failure tied to observable behavior rather than
private field names or the number of internal helper calls.

Direct access to component internals is a narrow exception: explain the exact
behavior that cannot reasonably be exercised through the rendered or public
interface, and limit the accessed surface. Do not add public production members
solely to bypass this rule. Where the fixture-cast lint rule applies, place an
`eslint-disable-next-line no-restricted-syntax -- <specific reason>` immediately
above the exceptional line. Review the reason; “needed for testing” is insufficient.
Unnecessary disables are reported by ESLint.

The automated guard detects `fixture.componentInstance as unknown as ...`. Other
ways of reaching private/protected internals still require the same review; passing
the syntax check does not establish that a test follows this standard.

## Comments and examples

Explain surprising behavior, contract constraints, and deliberate exceptions close
to the code. Put architectural reasoning in a linked ADR rather than repeating its
history in class and method comments. Keep useful contract facts when shortening
an existing explanation.

```ts
// Fresh read: this response includes the current balance (ADR 0006).
// A DateOnly is a local calendar day; parsing it as an ISO instant shifts western dates.
```

These are examples of useful reasons. A comment that merely narrates a method's
name adds no rule. Add or amend an ADR when a decision carries a meaningful
trade-off and future readers need the reason; ordinary local choices do not each
need an ADR.

## Checks and exceptions

Run `npm run check:changed` for tracked edits and untracked source files against
`HEAD`. Use `npm run check:changed -- --base origin/main` to include committed
branch changes since the common ancestor. Both check entire changed `.ts` and
`.html` files under `src/`, not only edited lines. They do not rewrite files.

The pre-commit hook formats staged source files and runs ESLint with zero warnings
on them. CI checks changed source formatting and lint with zero warnings, then
retains the existing full-repository lint, application tests, and production build.
It also tests the changed-file checker. PR comparisons use the common ancestor of
the PR base and HEAD; push comparisons use `--since` to compare directly with the
previous tip, including force-push rollbacks. A new branch's first push compares with the
default branch. Missing or invalid Git history fails the check rather than silently
skipping it.

Fixture-internals casts are errors in full-repository lint. A necessary access must
carry the narrow, reviewed exception described above. CI checks the full source
tree with `npm run check:format`; use the same command before submitting changes
that touch source formatting. Changes to checks themselves should run the standards
enforcement suite with `npm run test:standards`; behavior changes should run the
affected tests and the normal repository checks.

Reviewers also check domain boundaries, request lifetimes, financial freshness,
test intent, and comment usefulness. Those judgments are not guaranteed by lint.
