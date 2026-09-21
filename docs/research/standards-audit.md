# Domain boundaries and asynchronous ownership audit

This report records the inspection requested by issue #253. It is an audit, not
authorization to apply every remediation at once. Evidence comes only from this
repository at the `origin/main` baseline fetched for the issue.

## Classification and audit rules

- **Confirmed defect** means a reachable interaction can produce an observable
  wrong or indeterminate result.
- **Standards deviation** means the implementation contradicts
  `docs/standards.md`, but no incorrect product result was established.
- **Deliberate exception** means the behavior is intentional and has a bounded
  reason in an ADR or next to its owner.

The audit treated same-domain relative imports and the direct lazy imports in
`src/app/domains/app/routes.ts:15-52` and `src/app/domains/auth/routes.ts:15-48`
as intentional. It did not treat a `subscribe` or `firstValueFrom` search match
alone as a defect. In particular, a subscription which completes with its one
HTTP response is still reviewed for destruction and ordering, while a write is
reviewed separately for whether cancellation or survival is the required
lifetime.

## Findings summary

| ID  | Classification      | Areas                                                                               | Finding                                                                                                                                                                                      |
| --- | ------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Standards deviation | Goals / Contributions, Schedules                                                    | Internal consumers import their own domain through `index.ts` instead of direct relative paths.                                                                                              |
| F2  | Standards deviation | Profile, authentication                                                             | Profile reaches into an authentication implementation path, and authentication has same-domain alias imports plus a reusable UI-to-feature dependency.                                       |
| F3  | Standards deviation | Layout / shared coordination                                                        | Layout files use alias-based internal paths instead of direct same-domain relative imports.                                                                                                  |
| F4  | Confirmed defect    | Accounts, Budgets, Categories, Goals / Contributions, Schedules, Transactions       | A dialog can be dismissed after a promise-owned write starts; the request survives the dialog, but its result no longer reaches the screen, so reconciliation or error presentation is lost. |
| F5  | Confirmed defect    | Accounts, Budgets, Categories, Goals / Contributions, Schedules, Tags, Transactions | Several post-write or manual refreshes can overlap without cancellation or a request identity, allowing an older response to replace newer facts.                                            |
| F6  | Confirmed defect    | Profile                                                                             | Pending Profile reconciliation retries are not sequenced, so an older response can overwrite a newer Profile.                                                                                |
| F7  | Standards deviation | Schedules                                                                           | Schedule coordinators correctly own surviving writes, but the destroyed confirmation/extension dialogs keep their own unnecessary observers alive.                                           |
| F8  | Standards deviation | Profile, Schedules, Transactions, authentication                                    | Component- or dialog-owned promise reads are not tied to destruction; request identity prevents stale writes but does not release a destroyed owner.                                         |

## Accounts

**Boundary and confirmed behavior.** `accounts/index.ts:1-9` exports the Account
vocabulary, errors, and adapter, but not routed features. Cross-domain consumers
use that entry point, for example Goal detail at
`goals/features/goal-detail/goal-detail.ts:12` and Schedule list at
`schedules/features/schedule-list/schedule-list.ts:7`. Account detail correctly
uses the Transactions public entry point at
`accounts/features/account-detail/account-detail.ts:11-22`; the dependency is in
the direction required by ADR 0009. Routes directly lazy-load the two screens at
`app/routes.ts:15-20`, the explicit route-assembly exception.

Account services are cold: `accounts/data/accounts.service.ts:75-87` creates a
new list request and `:95-96` a new detail request. The filtered Account list
cancels a superseded criteria read with `readReset` at
`accounts/features/account-list/account-list.ts:60`, `:141-147`, and `:167-173`.
Component subscriptions are destruction-bound (`:90-106`, `:146-170`,
`:188-192`, and `:237`). After Account lifecycle writes, `reconcile()` starts a
fresh criteria read (`:237-241`, `:268-269`), so no balance is patched locally.
Account detail likewise re-reads Account, Transactions, Category names and all
Accounts (`account-detail.ts:231-253`) after a record, refile, or removal
(`:175-223`). These behaviors comply with ADR 0006.

**F4 — confirmed defect (dialog write dismissal).** `DialogShell` always closes
from its close control or Escape (`core/dialog/dialog-shell.ts:31-36`, `:53-66`).
The new and rename Account forms own their writes through `firstValueFrom`
(respectively `accounts/ui/new-account-form.ts:94-102` and
`accounts/ui/rename-account-form.ts:73-80`). A promise-owned HTTP subscription is
not tied to destruction. If the person submits and immediately closes the
dialog, the request can still commit, but the dialog has already emitted an
undefined close result; Account list only reconciles a truthy close result
(`account-list.ts:188-201`). The next balance shown on the still-open list can
therefore omit a newly created Account until another read.

- Trigger / expected test: submit create (and rename in its own focused case),
  hold the service response, activate the shell close control, then complete the
  write. The expected outcome must be explicit: either close is disabled until
  the result reconciles, or an external owner reconciles the completed write.
  The current behavior closes immediately and performs neither.
- Bounded fix: Account dialog/form lifetime wiring and Account list
  reconciliation only; do not change the Accounts adapter or introduce a
  balance cache.

**F5 — confirmed defect (detail refresh ordering).** Each Transaction row owns
its removal busy state, so removals of different rows can be in flight together
(`transactions/ui/transaction-row.ts:303-323`). Account detail starts an
independent `read()` for every emitted removal (`account-detail.ts:215-237`) and
does not cancel or identify an earlier refresh. If removal A starts read A,
removal B starts read B, B's newer response lands, and then A's older response
lands, `apply()` at `:257-267` can restore the stale row or balance.

- Trigger / expected test: complete two row removals, return the second fresh
  read first and the first refresh last; expect only the latest server snapshot
  and balance to remain rendered.
- Bounded fix: sequence or cancel `AccountDetail` reads (including initial load
  versus refresh) and add the component behavior test. Do not serialize the
  writes or calculate a balance locally.

No other Accounts facts remain unresolved.

## Budgets

**Boundary and confirmed behavior.** `budgets/index.ts:1-9` exposes only domain
vocabulary and `BudgetsService`; the routed screen remains lazy at
`app/routes.ts:27-29`. Its only cross-resource dependency, Categories, uses the
Categories entry point (`budget-list.ts:12`; both forms do the same). Budget
dates remain calendar days in the adapter, and the cold list is explicit at
`budgets/data/budgets.service.ts:55-78`. The list re-reads after create, adjust,
and remove (`budget-list.ts:194-223`, `:251-293`), so Cycle and Spent figures
come from the server in accordance with ADRs 0006, 0011, and 0012. Component
subscriptions are destruction-bound (`:176-181`, `:230-234`, `:262-265`, and
`:286-290`). Category picker reads intentionally use the active reference cache
(`new-budget-form.ts:136-140`; `adjust-budget-form.ts:150-155`).

**F4 — confirmed defect (dialog write dismissal).** New and adjust forms await
their writes with `firstValueFrom` (`new-budget-form.ts:163-184` and
`adjust-budget-form.ts:158-179`), while the shared shell can close at any time.
`BudgetList.afterDialog` reconciles only a truthy result
(`budget-list.ts:225-238`). Dismissal during the write can therefore leave a
committed Budget or adjustment absent from the current Cycle/Spent display.

- Trigger / expected test: hold create or adjust, close the dialog, then complete
  the write; expect the dialog lifetime policy to preserve reconciliation (or
  prevent dismissal) and render the server's Cycle and Spent values.
- Bounded fix: Budget dialog/form pending-close behavior and list handoff only;
  keep `BudgetsService.list()` cold.

**F5 — confirmed defect (reconcile ordering).** Row removal uses a single
`busyId` but only the matching row is rendered busy (`budget-list.html:92`), so
another row can begin a write. Every success starts an independent cold list
read (`budget-list.ts:257-293`). An older first reconcile can land after the
newer second reconcile and replace it.

- Trigger / expected test: remove two different Budgets, complete the second
  post-write list read before the first, and expect the final rendered list to
  be the newest response.
- Bounded fix: add one supersession mechanism around `BudgetList.reconcile()`
  (and its interaction with `load()`); no service cache and no local Spent
  arithmetic.

No Budget product decision is unresolved.

## Categories

**Boundary and deliberate cache exception.** `categories/index.ts:1-10` exports
the reference vocabulary, adapter, errors, and the shared saved-picker rule, but
not the routed feature. All observed consumers use it. Management uses the cold
reader (`categories-list.ts:68-100`; `categories.service.ts:86-95`); picker and
label consumers use the cached readers whose active/whole-set distinctions are
encoded at `categories.service.ts:39-83`. Every successful write invalidates in
the service (`:107-115`, `:125-129`, `:142-150`, `:160-170`), and a failed
cached fetch is discarded (`:173-181`). This is the deliberate ADR 0017
reference-cache exception, not permission to cache financial figures.

All component subscriptions are destruction-bound (`categories-list.ts:74-100`
and `category-pane.ts:226-254`, `:317-335`).

**F4 — confirmed defect (dialog write dismissal).** Add and rename Category
forms use promise-owned writes (`categories/ui/add-category-form.ts:73-82` and
`categories/ui/rename-category-form.ts:78-83`). Their dialogs may be dismissed
through the unconditional shared shell close. `CategoryPane` emits `changed`
only when `afterClosed` receives the saved Category (`category-pane.ts:216-256`),
so a late successful write invalidates the shared cache but does not refresh the
management screen.

- Trigger / expected test: start Add or Rename, close the dialog before the
  response, complete successfully, and expect the management list to reconcile
  (or the close affordances to remain disabled until completion).
- Bounded fix: Category dialog/form close lifetime and `changed` handoff only;
  retain ADR 0017 invalidation semantics.

**F5 — confirmed defect (two-pane reload ordering).** Expense and Income panes
have independent row writes and both emit the parent `changed` output
(`category-pane.ts:261-307`). Each emission starts an unsequenced cold `readAll`
(`categories-list.ts:94-105`). Two writes across the panes can therefore produce
two reads whose out-of-order completion lets the older collection replace the
newer one.

- Trigger / expected test: complete writes in both panes, return the second
  reload first and the first reload last, and expect the final rows to reflect
  the newest reload.
- Bounded fix: give `CategoriesList` a single superseded-read owner shared by
  `load()` and `reload()`; do not serialize pane writes or change the cache.

No Category facts remain unresolved.

## Goals and Contributions

**Boundary and financial behavior.** External consumers use
`goals/index.ts:1-14`. Accounts and Transactions are imported through their
public entry points in Goal detail (`goal-detail.ts:12-13`) and the Contribution
form (`goals/ui/contribution-form.ts:14`). Contribution reads are cold
(`goals/data/goal-contributions.service.ts:20-37`). Goal detail re-reads Goal,
Contributions, Accounts, and linked source Transactions together
(`goal-detail.ts:270-326`); pooled Account headroom is recomputed from fresh
Accounts and Contributions after a deletion (`:277-297`). This follows ADR 0006
rather than decrementing remembered figures.

Component subscriptions are destruction-bound throughout Goal list
(`goal-list.ts:75-160`) and detail (`goal-detail.ts:94-227`, `:277-284`).

**F1 — standards deviation (same-domain barrel).** Goal detail and its spec
import their own domain through `../../index` (`goal-detail.ts:14-22` and
`goal-detail.spec.ts:11`). The standard requires direct relative imports inside
a domain; the public barrel is for consumers outside it. The same deviation in
Schedules is recorded in that area's entry.

- Trigger / expected test: this is structural, so the verification is the
  existing Goal detail suite plus `npm run check:changed`; imports should resolve
  directly to the owning `data/` modules while rendered behavior stays unchanged.
- Bounded fix: change only those same-domain imports. Do not reduce the public
  exports external Transaction consumers need.

**F4 — confirmed defect (dialog write dismissal).** Goal create/edit writes are
promise-owned (`goals/ui/goal-form.ts:55-79`); Contribution add/edit writes are
promise-owned (`goals/ui/contribution-form.ts:119-159`). The shared shell can
dismiss either dialog during submission. Their parent screens refresh only from
the close result (`goal-list.ts:90-107`; `goal-detail.ts:111-141`, `:258-268`). A
committed Goal or Earmark may therefore be invisible, including stale progress
or Account headroom, until another entry/read.

- Trigger / expected test: hold each write family, dismiss, then complete it;
  expect a defined lifetime which either prevents dismissal or lets an external
  owner deliver the result and run the existing fresh fact read.
- Bounded fix: Goal and Contribution dialog lifetime/handoff plus the existing
  list/detail reconciliation entry points. Never infer Goal progress or Account
  headroom locally.

**F5 — confirmed defect (refresh ordering).** `GoalList.load()` has destruction
cleanup but no supersession (`goal-list.ts:71-87`), and multiple row writes can
be initiated before the first finishes because `busyId` identifies only one row
(`:133-169`). Goal detail likewise starts independent `load()` and
`refreshContributionFacts()` requests (`goal-detail.ts:80-108`, `:270-304`). An
older response can replace facts read after a later Goal or Contribution write.

- Trigger / expected tests: (1) complete two list row writes and resolve their
  reloads newest-first; (2) cause two detail fact refreshes and resolve the
  newest first. In both cases the last rendered Goal progress/history must be
  from the newest initiated read.
- Bounded fix: request identity or cancellation in the two screen coordinators;
  do not change Contribution deletion recovery or cold adapters.

The report does not decide whether every Goal write should be globally
serialized; sequencing the reads is sufficient for the observed defect.

## Profile

**Confirmed behavior.** Profile is the product term (CONTEXT and ADR 0003) and
the API language. The Profile feature consumes shared `AuthService` and
`Session` through their core entry points (`profile-identity.ts:18-20` and
`profile-email.ts:17-20`). Identity writes apply the returned Profile only when
its id matches the live Profile (`core/session/session.ts:86-94`). Email-change
writes explicitly re-read `/api/profile` and retain a truthful local pending
email while that read is retried (`profile-email.ts:42-44`, `:129-195`). Profile
has no balance-bearing cache.

**F2 — standards deviation (cross-domain implementation import).** Password
editing imports `passwordRules` directly from
`@/app/domains/auth/password-rules` (`profile-password.ts:18`). This is a
cross-domain implementation path, and authentication has no public entry point.

- Trigger / expected test: structural verification through the Profile password
  suite and changed-file checks; Profile should import an explicitly exported
  authentication capability, with no behavior change.
- Bounded fix: add the narrow authentication public entry point (or move a truly
  cross-domain credential rule to an agreed core owner) and update this import.
  Do not barrel-export routed authentication screens.

**F6 — confirmed defect (retry ordering).** `retryRefresh()` can call
`reconcile()` repeatedly (`profile-email.ts:124-127`); `reconcile()` has neither
a pending guard nor a request identity (`:186-195`). If two retry reads overlap,
an older `/api/profile` response can apply after a newer one. No existing test
establishes which retry owns the presentation.

- Trigger / expected test: start two refresh retries, resolve the second with a
  newer Profile and the first with an older Profile, and expect the newer
  Profile and cleared refresh warning to remain.
- Bounded fix: sequence only Profile email reconciliation reads. Keep
  `Session.applyProfileUpdate`'s id guard.

**F8 — standards deviation (read destruction).** The same Profile reconciliation
uses an unbounded `firstValueFrom` (`profile-email.ts:186-195`). Sequencing F6
would prevent an older response from winning, but would not release the
component after navigation while the latest read is pending.

- Trigger / expected test: start a reconciliation read, destroy the Profile
  fixture, then settle the source; expect the read subscription to be gone and
  no late Session or local-state update.
- Bounded fix: bind only Profile email's reconciliation read to its component
  destruction, alongside the F6 ordering guard. Do not change the unresolved
  policy for Profile writes.

**Unresolved lifetime fact.** Identity, email, and password writes use
`firstValueFrom` and therefore survive navigation (`profile-identity.ts:75-106`,
`profile-email.ts:108-181`, `profile-password.ts:79-113`). Unlike a dismissed
dialog, there is no close result to strand, and successful identity/email writes
still update `Session`; password completion has no cross-screen state. The
repository does not state whether navigation should cancel these writes or an
application-scoped owner should report their eventual failure. This needs a
product decision before proposing a runtime fix.

## Schedules

**Boundary and translation behavior.** `schedules/index.ts:1-13` exports the
Schedule vocabulary and adapter, never its routed screen. Cross-domain Account,
Category, and Transaction dependencies use their public entry points
(`schedule-list.ts:7-8`; `schedule-row.ts:7`). The adapter alone translates the
API's recurring-transaction vocabulary, preserving ADR 0003. Schedule list
reads Schedules plus fresh Accounts and cached whole-set Categories together
(`schedule-list.ts:112-129`); that mix is correct because only Account facts
carry balances and Category labels are the ADR 0017 reference exception.

**F1 also applies here.** Schedule list, New Schedule, and Edit Schedule import
their own public barrel through `../..` (`schedule-list.ts:9`,
`new-schedule-form.ts:15-24`, and `edit-schedule-form.ts:15-21`).

- Trigger / expected test: this is structural; replace those imports with the
  direct owning `data/` modules, then run the Schedule list and form suites and
  changed-file checks with no rendered behavior change.
- Bounded fix: the three Schedule imports only. Keep the barrel exports for
  consumers in other domains and keep routed features out of it.

**Deliberate surviving write exception.** `ScheduleLifecycleCoordinator` says it
owns lifecycle writes after dialog dismissal (`schedule-lifecycle-coordinator.ts:25-27`),
subscribes outside the dialog (`:40-53`), and publishes completion/conflict/failure
events. Schedule list owns the lasting event subscription and reconciliation
(`schedule-list.ts:105-109`, `:184-199`). Keep this exception; do not add dialog
destruction cancellation to the coordinator's internal subscription. Extend uses
the same coordinator (`schedules/ui/extend-schedule/extend-schedule-dialog.ts:70`),
so the operation has the same intentional surviving lifetime.

**F7 — standards deviation (dialog observer destruction).** The coordinator's
durable subscription does not require the confirmation dialog's separate
subscription to survive. Nevertheless, the dialog subscribes without
destruction cleanup (`schedule-lifecycle-dialog.ts:52-67`), so dismissal retains
the destroyed component until the request settles and a late response still
calls `dialogRef.close()` or updates its signals. The Extend dialog has the same
observer-side lifetime through an unbounded `firstValueFrom`
(`extend-schedule-dialog.ts:65-88`). Unsubscribing these observers does not cancel
the coordinator-owned request because `track()` already subscribed independently.

- Trigger / expected test: start a lifecycle or extension write, dismiss its
  dialog, then complete or fail the request; expect the list-level coordinator
  event and reconciliation to occur while the destroyed dialog performs no late
  close or signal update.
- Bounded fix: add destruction cleanup only to the two dialog-side observers.
  Preserve `ScheduleLifecycleCoordinator.track()` and its existing
  dismissal-survival behavior tests.

**F8 — standards deviation (Edit Schedule read destruction).** The Edit form's
option load and conflict refresh await `firstValueFrom` reads without component
destruction (`edit-schedule-form.ts:185-224`). New Schedule's analogous reads do
bind their joined source to destruction (`new-schedule-form.ts:205-235`), so the
gap is specific rather than a reason to change the adapters.

- Trigger / expected test: hold the initial option read and the conflict refresh
  in focused cases, destroy the Edit dialog, then settle them; expect the sources
  to be unsubscribed and no late form-state update.
- Bounded fix: Edit Schedule read ownership only; retain Category cache refresh
  semantics and the separate surviving-write rules.

**F4 — confirmed defect (other Schedule dialogs).** New and edit Schedule forms
own writes with `firstValueFrom` (`schedules/ui/new-schedule/new-schedule-form.ts:151-166`
and `schedules/ui/edit-schedule/edit-schedule-form.ts:131-146`) but do not use the
lifecycle coordinator. Their dialogs remain dismissible; Schedule list refreshes
create only for a truthy result and edit only when the dialog closes
(`schedule-list.ts:147-165`). On early dismissal the request can commit after a
premature edit refresh, leaving the list stale.

- Trigger / expected test: submit Create/Edit, dismiss before completion, then
  complete the request; expect either pending dismissal to be blocked or the
  completed write to be externally owned and followed by a fresh list read.
- Bounded fix: New/Edit dialog lifetimes only. Reuse a coordinator only if the
  write is deliberately allowed to survive; do not alter
  `ScheduleLifecycleCoordinator` semantics.

**F5 — confirmed defect (list read ordering).** Lifecycle coordination explicitly
supports multiple schedule ids (`schedule-list.ts:184-194`). Each completion,
delete, conflict, create, edit, or manual refresh starts an independent `load()`
(`:112-145`, `:195-209`) with no supersession. A response started after the first
write but before a second can land last and overwrite the newer collection.

- Trigger / expected test: complete lifecycle changes for two Schedules, resolve
  the second reload first and the first reload last; expect only the newest list,
  Account, and Category snapshot to render.
- Bounded fix: one sequenced Schedule-list read owner; retain parallel lifecycle
  writes, coordinator events, and Category cache behavior.

No Schedule lifecycle state is inferred beyond the accepted ADR 0003 amendment.

## Tags

**Boundary and deliberate cache exception.** `tags/index.ts:1-6` exports the Tag
type, adapter, and reusable Tag field; the routed management screen stays out.
Transaction consumers use this entry point. `TagsService.all()` is the cached
autocomplete reader while `readAll()` is cold management data
(`tags.service.ts:20-55`). Writes invalidate only after success (`:66-101`), and
failed cached reads are discarded (`:104-113`). This is exactly the distinct Tag
case in ADR 0017, not a financial cache.

All Tag field and management subscriptions are destruction-bound
(`tag-field.ts:155-156`, `:256-257`, `:283-284`; `tags-list.ts:183-185`,
`:210-212`, and every write subscription).

**F5 — confirmed defect (management reload ordering).** Add, rename, delete, and
stale recovery can independently start cold reads (`tags-list.ts:233-265`,
`:289-322`, `:340-389`). The `adding` and `busyId` flags cover different
controls, so an Add and a row action may overlap. `reload()` and `goStale()` do
not cancel or identify older reads (`:207-216`, `:377-389`). An older collection
can replace a newer one.

- Trigger / expected test: finish an Add and a row Rename/Delete, resolve the
  later reload first and earlier reload last, and expect the newest collection
  to remain.
- Bounded fix: one latest-read policy in `TagsList`, including `load`, `reload`,
  and `goStale`; preserve service cache invalidation and cold management reads.

Tag management is inline, so the shared dialog-dismissal defect does not apply.

## Transactions

**Boundary, ordering, and freshness behavior.** `transactions/index.ts:1-50`
exports external vocabulary, adapter, reusable dialogs/row, and the bounded
split stores; routed features remain out. Cross-domain imports use Account,
Category, Tag, and Goal public entry points. The list's URL criteria are the
source of truth and superseded criteria/page reads are cancelled with `reset`
(`transactions-list.ts:257-271`, `:344-382`, `:394-425`).
`LinkedContributionPanel` uses a request sequence so an older capacity read
cannot replace a newer one (`linked-contribution-panel.ts:38-40`, `:77-95`,
`:128-151`). Those are confirmed compliant overlapping-read owners.

The adapter's list, search, record, refile, linked-capacity, and split calls are
cold; no financial response is replayed. Linked Contribution creation refreshes
authoritative context and Goal histories (`transaction-split-recovery.ts:130-143`,
`:173-207`), and the row refreshes displayed capacity after success
(`transaction-row.ts:253-280`). Removal emits to screens that perform fresh reads
rather than balance arithmetic (`transaction-row.ts:297-323`). These satisfy ADR
0006; transaction parsing and Transfer semantics remain governed by ADRs 0007,
0009, and 0010.

**Deliberate surviving write exception.** The row lazily owns
`TransactionSplitRecoveryStore` outside the dialog
(`transaction-row.ts:242-282`). The store retains one immutable payload and
idempotency key across dismissal (`transaction-split-recovery.ts:64-99`) and is
the only layer allowed to replay (`:102-128`). Existing behavior coverage includes
the out-of-order capacity test at `transaction-row.spec.ts:815-834` and the
dismissed in-flight split test at `:873-895`. Preserve this exception.

**F4 — confirmed defect (ordinary record/refile dismissal).** Record and refile
forms use promise-owned writes (`record-transaction-form.ts:208-253` and
`refile-transaction-form.ts:194-220`). The shared shell can dismiss while they
are pending. Both Account detail and Transactions list refresh only from a saved
close result (`account-detail.ts:157-212`; `transactions-list.ts:443-469`). A
record can therefore change one or two Account balances after the dialog is gone
without the mandatory fresh read; a refile can leave a stale row.

- Trigger / expected tests: hold Record (including a Transfer) and Refile,
  dismiss, then complete. Expect the chosen lifetime policy to ensure the result
  reaches the screen and a fresh server read occurs, or prevent dismissal until
  it can. The Transfer test must verify both affected Accounts are never updated
  by local arithmetic.
- Bounded fix: ordinary record/refile dialog ownership and screen handoff. Do
  not fold these writes into the split recovery protocol without an idempotency
  contract, and do not change the existing split coordinator.

**F5 — confirmed defect (full refresh ordering).** Criteria reads and appended
pages are protected, but `load()` itself subscribes without `takeUntil(reset)`
or a request identity (`transactions-list.ts:288-310`). A URL/filter change calls
`readCriteria()`, whose `resetToFirstPage()` emits `reset` (`:344-370`,
`:394-405`), but that signal cannot cancel the already-running full read. The
newer filtered response can land and then be overwritten by the older unfiltered
response. Multiple row removals or refiles can produce the same ordering. The
parallel issue in Account detail is recorded in its entry.

- Trigger / expected test: hold the entry `load()`, emit a new URL criterion,
  resolve the filtered read first and the older entry read last; expect the
  filtered rows and total count to remain. A second case may use two row
  removals. Keep the existing cancelled-page and criteria tests passing.
- Bounded fix: bring full `load()` into the list's existing reset/supersession
  policy; keep Category reference caching and Account reads fresh.

**F8 — standards deviation (financial read destruction).** Request identities
correctly protect Linked Contribution ordering, but the underlying
`firstValueFrom` reads are not destruction-bound
(`linked-contribution-panel.ts:77-95`, `:128-151`). The per-dialog split context
store has the same gap in its joined capacity/Goal read
(`transaction-split-context.ts:44-50`, `:92-123`). A destroyed row or dialog can
therefore remain retained until a response settles even though its state can no
longer render.

- Trigger / expected tests: hold a panel capacity/refresh read and a split-context
  read, destroy their owning fixtures, then settle the sources; expect each
  subscription to be gone and no late store or signal update. Keep the existing
  out-of-order response tests passing.
- Bounded fix: bind only these read streams to their panel/store destruction.
  Preserve the row-owned split write/recovery lifetime and Contribution deletion
  uncertainty behavior.

**Unresolved navigation lifetime.** `TransactionRow.confirmRemove()` and linked
Contribution deletion use `firstValueFrom` (`transaction-row.ts:303-323`;
`linked-contribution-panel.ts:107-125`), so they survive navigation but their
screen callbacks disappear. The repository establishes uncertainty recovery for
Contribution deletion and split creation, but does not state whether ordinary
Transaction removal must survive navigation or be cancelled. Decide that policy
before changing ownership; a blanket `takeUntilDestroyed` could hide an accepted
server-side removal.

## Authentication and session

**Boundary and confirmed behavior.** Auth routes lazy-load concrete routed files
and correctly leave confirmation/reset link landings outside `guestGuard`
(`auth/routes.ts:15-48`), matching ADR 0015. Core auth/session imports use their
own public entry points. `Session.verifyBoot()` makes a fresh `/api/profile` read
before authentication (`core/session/session.ts:57-84`); no Profile copy is
cached across application boots. Concurrent 401 responses have one teardown
owner (`session.ts:107-151`), and the interceptor excludes sign-in and boot
verification from duplicate expiry handling (`auth.interceptor.ts:7-45`). This
is the deliberate, temporary ADR 0004 session design.

**F2 also applies here.** Authentication exposes no public entry point for the
password validation capability consumed by Profile; see the Profile entry. It
also imports its own implementation with app-root aliases in Sign up
(`auth/features/sign-up/sign-up.ts:11-12`) and Sign in
(`auth/features/sign-in/sign-in.ts:11`) instead of the standard's direct relative
paths. The reset-link UI and its spec reach upward into a routed feature for
shared reassurance copy (`auth/ui/request-reset-link.ts:6` and
`request-reset-link.spec.ts:4`), reversing the documented feature/UI
responsibility split. Route assembly remains the direct-import exception and
routed screens must not enter a public barrel.

- Trigger / expected test: this is structural; run the Sign in, Sign up,
  RequestResetLink, Forgot password, and Profile password suites after replacing
  the same-domain aliases with relative imports. The rendered wording and form
  validation must remain unchanged.
- Bounded fix: move the shared reset reassurance to a non-feature authentication
  owner, use relative imports within authentication, and expose only the password
  validation capability Profile needs from a narrow authentication entry point.

Authentication screens use promise-based, one-shot submissions guarded by their
form submitting states; they are full routed screens, not dismissible dialogs.
The repeating cooldown observers are correctly destruction-bound in
`request-reset-link.ts:78-85` and `resend-confirmation.ts:101-108`.
Navigation during a request leaves `firstValueFrom` alive, but no repository fact
states whether those writes (register, confirm, reset, resend) should survive.
Registration does not establish a session, as required by ADR 0015. This is an
explicit unresolved lifetime policy, not a proposed blanket cancellation fix.

**F8 also applies here.** After a signed-in Profile confirms its own pending
email change, the landing screen performs an unbounded `auth.me()` read, applies
the result to `Session`, and navigates to Profile
(`confirm-email-change.ts:74-92`). If that read settles after the landing screen
has been destroyed, its component-owned continuation can still mutate the
session and pull the person away from their newer route.

- Trigger / expected test: let confirmation succeed and hold the subsequent
  `me()` read, destroy the landing-screen fixture (or navigate away), then settle
  the read; expect no late Profile application or navigation.
- Bounded fix: bind only the post-confirmation `me()` read and its navigation
  continuation to this screen's destruction. This does not decide whether the
  preceding confirmation write itself should survive navigation.

No overlapping authentication read was found which can replace a newer
selection or filter.

## Layout and shared coordination

**Confirmed behavior.** Layout's User component consumes the reactive Profile
and Session through the core entry point (`layout/ui/user.ts:7-8`, `:83-103`), so
Profile updates flow to the shell without a duplicate request or cached identity.
`DialogShell` binds its key-event subscription to destruction
(`core/dialog/dialog-shell.ts:53-62`). Shared `RowNotice`, money helpers, dialog
provider, and session capabilities live under `core/` and no resource domain
imports them through a private implementation path.

**F3 — standards deviation (same-domain import form).** Layout files use absolute
alias imports for their own implementation:
`layout/ui/navigation.ts:9`, `layout/ui/sidebar.ts:2-3`, and
`layout/layout.ts:7-8`. The standard calls for direct relative imports within a
domain. Layout has no public barrel and none is needed for these internal edges.

- Trigger / expected test: structural verification with the layout/User and
  route suites plus changed-file checks; the same components should render and
  lazy routes should remain unchanged.
- Bounded fix: convert only these same-domain imports to relative paths. Do not
  create a layout barrel or export routed screens.

**Shared source of F4.** The shell's unconditional close behavior is correct for
ordinary editable dialogs under ADR 0013, but it has no pending-write contract.
Fixes should not globally disable Escape: each dialog must declare whether its
write is blocked from dismissal or is owned outside it. Schedule lifecycle and
Transaction split already demonstrate the second case.

No shared balance-bearing cache or shared subscription leak was found.

## Proposed remediation order and validation

1. Resolve F4 per dialog family, starting with Transaction record/Transfer and
   Contribution writes because they change balances or Earmarks. Preserve the
   two documented surviving coordinators.
2. Bound the disposable observers and reads in F7-F8 without shortening the
   coordinator-owned writes.
3. Add latest-read behavior tests and fix F5 one screen coordinator at a time.
   Reuse the existing Account/Transaction reset pattern where it fits; request
   identity is also valid where cancellation is undesirable.
4. Apply the bounded import-only F1-F3 changes.
5. Sequence Profile reconciliation (F6) after its focused behavior test.
6. Record product decisions for the unresolved routed-screen navigation
   lifetimes before changing them.

Each runtime batch should run its focused component tests, `npm run
check:changed -- --base origin/main`, full lint, application tests, and the
production build. Import-only batches still require their focused suites and
changed-file checks. This report intentionally proposes no runtime change and
does not mark remediation complete.
