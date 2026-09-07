---
status: accepted
---

# Cache Categories for the session, and buy correctness with invalidation

Categories are held in a session-long shared cache, and every write drops that
cache from inside `CategoriesService`. ADR 0006 forbids the opposite for a
balance, so this reads at first glance like a contradiction; it is a
counterpoint, and the line between them is what the person does with the value.

A balance is a **figure the person acts on** — they decide whether they can
afford something — so a number that was right five minutes ago and is wrong now
is worse than a spinner. A Category name is a **label**: it only has to be
current. A hundred Transaction rows resolve their labels from one request
instead of one per row, and the worst a stale label can do is show the old
spelling of a name until the next read. Nothing is decided on it and nothing is
sent back keyed by it. So Categories buy correctness with **invalidation**
rather than with coldness, and ADR 0006 stands untouched for anything
balance-bearing.

## Invalidation is the service's job, not the caller's

Every write — create, rename, retire, reactivate, delete — drops the cache
**inside `CategoriesService`**, as part of the write. It is never a second call
a caller has to remember, because the caller that forgets it is the bug this
whole ADR exists to prevent, and it would fail silently on a screen nobody was
looking at.

Nothing is patched in place. A write invalidates, and the next reader re-fetches
the collection; the service never reconstructs what the server would have said.

## Four readers, four roles

One cache, read four ways. The narrowing is deliberate: the reader a call site
picks *is* the filtering rule, so no call site is trusted to remember it.

- **`names()`** — cached, **whole set**, id to name. A Transaction filed under a
  since-retired Category must still render its label, so this one can never
  narrow.
- **`list()`** — cached, **active-only**. The narrow one, and the reason it is
  the narrow one: it feeds the write pickers, and refiling is still filing, so
  every picker call site starts offering active-only without changing. The API
  will not enforce this — it accepts a retired Category as a new reference on a
  Transaction, Budget, or Schedule with no error (#98) — so client-side
  filtering is the *only* guard.
- **`all()`** — cached, **whole set**, carrying `kind` and `isActive`. For the
  places that must show a retired Category *marked* rather than hidden: the
  Transactions filter, which governs finding rather than filing (ADR 0016), and
  a form editing a record whose saved Category has since been retired. `names()`
  has no `isActive` and `list()` has already dropped the row, so neither can
  serve these.
- **`readAll()`** — **cold** and whole-set, for the Categories screen itself.
  That screen manages the collection, so it re-reads on entry and after every
  write; it invalidates the cache but never reads through it.

The adapter therefore keeps `isActive` rather than dropping it, so *Retired* is
rendered from the wire and not inferred from an absence.

## Consequences

- The staleness window is a single browser instance and closes on the next
  write. A Category renamed in another tab, or on another device, keeps its old
  label in this session until something writes. Accepted: a label is not a
  figure, and no cross-tab invalidation is built.
- A failed fetch is discarded rather than cached, so a caller that offers a
  retry actually re-fetches.
- This is the one collection in the client held across navigations. Anything
  that grows a balance, a total, or a computed amount is outside this ADR and
  falls back under ADR 0006.
