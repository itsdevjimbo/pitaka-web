---
status: accepted
---

# Treat Pitaka as single-currency until public signup

No currency field exists anywhere in the domain — not on the user, the account, or the transaction. Amounts are bare decimals. Rather than leave that implicit, Pitaka Web declares it: the app is peso-only, and formatting lives behind a single token so there is exactly one place to change when that stops being true.

## Considered options

A client-side currency picker was rejected outright. It would render `₱` and `$` over the identical stored number, so switching would appear to change a balance's value without changing it — a lie a finance app does not recover from.

Adding a currency field to the API was deferred rather than rejected. It is the correct fix, but it is backend scope we chose not to open before any screen exists to validate the shape against, and the choice between account-level and user-level currency is better made with real usage in view.

## Consequences

- Revisit before anyone outside the author signs up. Adding currency after real balances exist means backfilling every row and deciding what historical amounts meant.
- Amounts are always positive; direction is carried by the transaction type, never by a negative number.
