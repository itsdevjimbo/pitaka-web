---
status: accepted
---

# Carry the Transactions filter in the URL, in the person's terms

The Transactions list's filter criteria live in the query string, and the
route — not a signal on the component — is the source of truth for them (#41). A
narrowed view survives a refresh, can be bookmarked, and can be sent to someone.
The filter bar writes the URL and reacts to it; it never sets the criteria
signal directly.

## The parameters are the person's criteria, not the wire's

`GET /api/transactions` takes `accountId`, `categoryId`, `type`, and
offset-bearing, end-exclusive `from`/`to` (ADR 0011, and the API's own
filter-bounds ADR). The URL deliberately does **not** mirror that:

- `account`, `category`, `direction`, `note` — readable names, and `direction`
  carries this client's word (`income`/`expense`/`transfer`), not the API's
  `TransactionType` (ADR 0003).
- `from`/`to` are bare `YYYY-MM-DD` calendar days, and `to` is the **inclusive**
  end day the person picked. The wire's exclusive `endDay + 1` and its UTC
  offset are `date-range-bounds.ts`'s business, applied below the criteria, not
  in the link. A link carrying the exclusive boundary would read as the wrong
  month.
- `page` is not carried at all. It is a position in a result set, not something
  the person filtered by, and a page number over someone else's matches means
  nothing to whoever receives the link. Entry always starts at page 1;
  *Load more* pages within the session and is forgotten on the next navigation.

## Parsing is total

The API returns 400 for an unparseable `type`, for a non-positive id, and for
`from >= to`. A hand-edited URL forwarded unsanitised would put the person on an
error screen — the exact outcome this ticket exists to prevent. So
`criteriaFromQueryParams` is total: every value it cannot read is treated as
absent.

- An unknown `direction`, a non-numeric / zero / negative / fractional /
  out-of-safe-range id, a `note` that trims to nothing, a `from`/`to` that is
  not a real calendar day (`2026-02-30`, an ISO instant, `garbage`) — each is
  dropped, and the rest of the URL still applies.
- An **inverted** range drops **both** ends, never one. Keeping `from` alone
  would silently widen the list to "everything after that month" when the person
  asked for a range. This is the same rule `toRequestDateBounds` already
  enforces at the wire; it is applied again at the URL seam so a serialised link
  always round-trips.

`criteriaToQueryParams` is the inverse and applies the same range rule, so no
criteria object the app can hold serialises to a URL that would parse back
differently.

## Consequences

- The round-trip is one pure module beside the service
  (`transaction-criteria-params.ts`), in the position `date-range-bounds.ts` and
  `offset-timestamp.ts` occupy, and its spec pins a negative-offset zone so a
  `toISOString()` day-shift in the date serialisation is actually reachable in a
  test (ADR 0011).
- The list component hydrates `criteria` from `route.snapshot.queryParamMap` on
  entry and subscribes to `queryParamMap` for every later change — a filter
  edited in the bar, the back button, a pasted link — with a
  `sameCriteria` guard so a no-op navigation does not fire a redundant read.
- A filter change navigates with `replaceUrl`, so a whole filtering session is
  one history entry and Back leaves the page rather than stepping through every
  control that was touched.
- The read logic from #40 is unchanged: the route subscription calls the same
  page-1 read, the rows stay put under a busy affordance, and Categories and
  Accounts are not re-fetched.
