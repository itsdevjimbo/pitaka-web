---
status: accepted
---

# Never render a balance from a cache

An Account's balance is the server's freshly recomputed figure, guarded by an
optimistic-concurrency version. Every entry to a screen that displays one
re-reads it from the API; Pitaka Web does not carry a balance across navigation.

A silently stale figure is a survivable bug in most applications and a
trust-ending one in a money application. The person acts on the number — decides
whether they can afford something — so an unmarked number carried into a new
screen is worse than a spinner. On an already open screen, keeping the last
successful read beside an explicit warning preserves context during a transient
failure; disabling freshness-dependent actions prevents that context from being
mistaken for an actionable balance.

## Consequences

- The resource services return **cold** `Observable`s with no `shareReplay`, no
  in-memory store, and no service-worker caching of `/api/accounts` or any other
  balance-bearing response. A component subscribes on init and holds nothing
  across navigations.
- A write that changes a balance (recording a Transaction, retiring an Account)
  is followed by a re-read, not a locally calculated replacement number.
- If a refresh fails while a screen is already open, the last successfully read
  figure can remain visible only with an explicit stale warning. Actions that
  depend on freshness stay unavailable until a re-read succeeds. After a
  successful write and failed re-read, the warning also confirms that the write
  was saved; the client does not invent the resulting balance.
- The optimistic-concurrency version travels on the hand-written types for the
  write paths that need it (rename, retire, delete). The read-only list does not
  model it, because it never sends it back.
- This costs a request on every visit to Accounts. That is the intended trade:
  correctness over a saved round trip.
