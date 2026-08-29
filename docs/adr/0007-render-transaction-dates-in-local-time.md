---
status: accepted
---

# Render a Transaction's date in the person's own timezone

A Transaction's date is shown as a calendar day in the viewer's local timezone,
never as UTC. A coffee bought at 7am appears on the day it was bought, not the
day before because a raw UTC string rolled backwards across midnight.

## How the wire value is read

The API sends `transactionDate` as an ISO date-time string. Its form is not
uniform, and the difference is meaningful:

- A Transaction the person recorded carries a real instant, serialised **with** a
  zone designator (`…T07:00:00Z`).
- A generated transaction carries a bare wall-clock day, serialised **without**
  one (`…T00:00:00`). The API has no per-user timezone and deliberately never
  stamps these UTC — there is no instant to convert from, and forcing one would
  land western users on the wrong day.

`new Date(value)` already honours that distinction: a string with a designator
parses to the instant it names, one without parses in local time. So the adapter
does exactly `new Date(resource.transactionDate)` — it never appends `Z` and
never strips one — and the value is rendered with a local formatter (`DatePipe`,
no timezone argument). An instant converts to the viewer's day; a wall-clock day
is shown as written.

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
- If the API later grows a real per-user timezone and stamps every Transaction a
  true instant, this reduces to the plain instant-to-local case and the ADR can
  be simplified rather than reopened.
