---
status: accepted
---

# Cache Category and Tag reference collections, and invalidate on write

The Category and Tag collections are reference data held in application-lifetime
shared caches. Every successful write drops the owning service's cache, and the next
cached reader re-fetches the whole collection. A failed fetch is discarded so a
retry reaches the API; a failed write leaves the last successful collection
intact.

This is a narrow exception to the default cold resource readers. It does not
weaken [ADR 0006](0006-never-render-a-balance-from-cache.md): balances, totals,
computed amounts, and other financial figures are never served from these
caches or authorized for caching by this decision.

## Why these collections are cached

A balance is a **figure the person acts on**, so an old value is worse than a
spinner. Category and Tag names are **reference labels**. Their bounded
staleness is acceptable, and each collection has a concrete repeated-read use:

- Categories label Transactions across screens and supply several filing and
  filtering controls. One request can resolve many rows and controls.
- Tags feed the local autocomplete on the record and refile Transaction forms.
  A dialog can close and reopen without fetching the same whole collection
  again. Transactions already carry their Tags with names, so this cache is not
  used to resolve row labels.

The staleness window is one application instance (one tab) and closes after that
instance next writes the resource. A rename in another tab or on another device
can retain an old label until then. No cross-tab invalidation is built.

## Invalidation belongs to the service

Create, rename, status-change, and delete operations invalidate the relevant
cache inside `CategoriesService` or `TagsService` after the write succeeds. It
is never a separate call a consumer can forget.

`CategoriesService.refreshList()` is the deliberate non-write invalidator. The
new and edit Schedule forms use it after the API rejects a formerly eligible
Category, ensuring the next picker state comes from a fresh active-only read.

Nothing is patched into or removed from a cached collection. Write responses
describe one resource (or have no body), not the authoritative collection, so a
write invalidates and the next cached reader re-fetches. The Categories and Tags
management screens use their services' cold `readAll()` readers and re-read
after successful writes; their writes still invalidate the shared caches used
elsewhere.

## Category readers encode filing rules

One Category cache has four normal readers plus an explicit refresh. The method
a consumer chooses carries the filtering and freshness rule so consumers do not
each have to reproduce it.

- **`names()`** — cached, **whole set**, id to name. A Transaction filed under a
  since-retired Category must still render its label, so this reader never
  narrows.
- **`list()`** — cached, **active-only**. It feeds write pickers. Refiling is
  still filing, and the API accepts a retired Category as a new reference on a
  Transaction, Budget, or Schedule (#98), so this client-side filter is the
  guard.
- **`all()`** — cached, **whole set**, carrying `kind`, `isActive`, and
  `isDefault`. It supports places that show a retired Category marked rather
  than hidden: the Transactions filter
  ([ADR 0016](0016-carry-the-transactions-filter-in-the-url.md)) and forms
  editing records whose saved Category has since been retired.
- **`readAll()`** — cold and **whole set**, for the Categories management
  screen.
- **`refreshList()`** — invalidate, then return the freshly fetched
  **active-only** set after a server rejection proves a saved picker selection
  stale.

The adapter keeps `isActive` so _Retired_ is rendered from the wire rather than
inferred from absence. It also keeps `isDefault` (added with the Categories
screen, #107), allowing Pitaka-supplied rows to be badged and their forbidden
write actions withheld.

## Tag readers serve autocomplete and management

Tags have no active/retired axis and need no id-to-name lookup, so both readers
return the whole set:

- **`all()`** — cached, for the Tag autocomplete on Transaction forms.
- **`readAll()`** — cold, for the Tags management screen.

An inline-created Tag is appended to the open form's own options because the
form needs the created resource immediately. The successful create also
invalidates the shared cache; it does not patch that cache.

## Consequences

- A successful cached fetch is replayed for the application session until a
  successful write invalidates it.
- Failed cached fetches are not replayed. The next cached read retries the API.
- Failed writes do not invalidate a previously successful collection.
- Cold management reads neither consume nor populate the shared caches.
- No other collection becomes cacheable by analogy. A new cache needs its own
  explicit repeated-read benefit and correctness analysis, and financial
  figures remain governed by ADR 0006.
