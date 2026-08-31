---
status: accepted
---

# Render a Transaction's date in the person's own timezone

A Transaction's date is shown as a calendar day in the viewer's local timezone,
never as UTC. A coffee bought at 7am appears on the day it was bought, not the
day before because a raw UTC string rolled backwards across midnight.

## How the wire value is read

The API sends `transactionDate` as an ISO date-time string. Two kinds of value
arrive and the difference is meaningful:

- A Transaction the person recorded carries a real instant. The API stores it
  UTC (`.ToUniversalTime()` on write) — but it persists to MySQL, whose
  `datetime` column holds no zone, so the value read back and serialised has
  **no** designator: `…T05:00:00`, a naive string that nonetheless names a UTC
  time. (A freshly created row returned straight from the POST still has its
  in-memory `Kind=Utc` and *does* carry a `Z` — so the bug only showed itself
  after a refresh re-read the row from the database.)
- A generated transaction carries a bare wall-clock day (`…T00:00:00`), also
  with no designator. The API has no per-user timezone and deliberately never
  stamps these UTC — there is no instant to convert from, and forcing one would
  land western users on the wrong day.

So a naive string is ambiguous, and `new Date(value)` — which reads any naive
string as local — is wrong for the person-recorded half: it would show a Manila
viewer 5 AM for the 1 PM they entered. The adapter disambiguates with
`recurringTransactionId` (the `generated` signal), in `parseTransactionDate`:

- a string **with** a designator (`Z` or `±HH:MM`) is honoured as written —
  nothing appended, nothing stripped;
- a naive string on a **person-recorded** row is read as UTC (`new Date(value +
  'Z')`), so it converts to the viewer's local time;
- a naive string on a **generated** row is read as local (`new Date(value)`), so
  the bare calendar day is shown as written.

The result is rendered with a local formatter (`DatePipe`, no timezone
argument). An instant converts to the viewer's day; a wall-clock day is shown as
written.

## Time of day

A person-recorded Transaction is shown with its local time (`29 Aug 2026,
2:05 PM`); a generated transaction is shown as the day alone. The generated one
carries only a wall-clock date stamped at midnight — there is no time to show,
and rendering `12:00 AM` would be false precision. `generated` is the reliable
signal for "no meaningful time".

## Consequences

- The hand-written `Transaction` type carries a `Date`, not a string, so the
  parse happens once at the seam and nothing above it re-derives a day.
- Rendering must stay local: no `toISOString()`, no `DatePipe` with an explicit
  `'UTC'`, no `formatInTimeZone(..., 'UTC')` on this value.
- The `generated` flag now does double duty: it drives both "no meaningful time"
  and "read the naive string as UTC, not local". If the API is fixed to send a
  `Z` on every stored instant (an EF `DateTimeKind.Utc` conversion on read),
  `parseTransactionDate` collapses to honouring the designator and the
  generated-vs-recorded branch can go.
- If the API later grows a real per-user timezone and stamps every Transaction a
  true instant, this reduces to the plain instant-to-local case and the ADR can
  be simplified rather than reopened.
