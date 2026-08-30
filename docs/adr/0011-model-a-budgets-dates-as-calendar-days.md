---
status: accepted
---

# Model a Budget's dates as calendar days, not instants

A Budget's `startDate` and `endDate` arrive as `DateOnly` — `"2026-08-30"`, no time, no zone designator — and are parsed into a `Date` constructed at **local midnight** (`new Date(2026, 7, 30)`), never by handing the wire string to `new Date()`. They are calendar days: the day a Budget begins and the day it stops, as written on a calendar, with no instant behind them.

This deliberately does **not** follow ADR 0007, and the difference is easy to miss.

## Why ADR 0007's rule does not reach these

ADR 0007 chose plain `new Date(value)` for a Transaction's date, on the grounds that the API sends a *mix* — a real instant with a zone designator, and a person-entered wall-clock without one — and that `new Date()` already honours the distinction: a string with a designator parses to the instant it names, one without parses in local time.

That reasoning covers date-*time* strings. It does not cover a date-*only* string, because ECMAScript parses those as **UTC midnight** rather than local midnight. So `new Date("2026-08-30")` is not the date-only sibling of `new Date("2026-08-30T00:00:00")`; the two land a whole UTC offset apart.

The consequence is a wrong-day bug that this codebase cannot currently see. Pitaka is peso-only (ADR 0005) and Manila sits at UTC+8, so UTC midnight renders as 8am the same local day and the date reads correctly. In any negative offset it renders as the day before: a Budget starting `"2026-08-01"` displays as 31 July, and a person in New York reads the wrong month on every Budget they own.

## Consequences

- The adapter constructs the `Date` from the string's year, month and day rather than parsing the string, and reverses that on the way out — a `startDate` is sent back as `"YYYY-MM-DD"` assembled from local getters, never via `toISOString()`, which would reintroduce the same offset error in the other direction.
- The conversion lives in one pure module beside the service, in the position `offset-timestamp.ts` occupies for Transactions, and its spec pins a negative-offset zone (`withPinnedTimezone`) so the bug this ADR exists to prevent is actually reachable in a test. A spec written only in Asia/Manila would pass against the broken implementation.
- `Transaction.date` and `Budget.startDate` are both `Date`, and one is an instant while the other is a calendar day. The type does not carry the difference, so this ADR does. Anyone "fixing" the Budget adapter to match ADR 0007 for consistency is reintroducing the bug.
- If the API ever grows a real per-user timezone, this does not change: a calendar day has no instant to convert, which is the same reason ADR 0007 refuses to stamp a generated transaction UTC.
