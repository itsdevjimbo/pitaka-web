---
status: accepted
---

# Never render a balance from a cache

An Account's balance is the server's freshly recomputed figure, guarded by an
optimistic-concurrency version. Pitaka Web never shows a balance it remembered:
every entry to a screen that displays one re-reads it from the API.

A stale figure is a survivable bug in most applications and a trust-ending one in
a money application. The person acts on the number — decides whether they can
afford something — so a number that was right five minutes ago and is wrong now
is worse than a spinner.

## Consequences

- The resource services return **cold** `Observable`s with no `shareReplay`, no
  in-memory store, and no service-worker caching of `/api/accounts` or any other
  balance-bearing response. A component subscribes on init and holds nothing
  across navigations.
- A write that changes a balance (recording a Transaction, retiring an Account)
  is followed by a re-read, not a local patch of the number.
- The optimistic-concurrency version travels on the hand-written types for the
  write paths that need it (rename, retire, delete). The read-only list does not
  model it, because it never sends it back.
- This costs a request on every visit to Accounts. That is the intended trade:
  correctness over a saved round trip.
