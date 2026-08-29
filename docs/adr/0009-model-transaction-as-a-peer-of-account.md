---
status: accepted
---

# Model Transaction as a peer of Account, not a part of it

The API nests the list endpoint under an Account (`GET /api/accounts/:id/transactions`), and the client's first Transaction screen was an Account's detail page — so the type and its service were written inside `domains/app/accounts/`. That nesting is wrong for the client: [CONTEXT.md](../../CONTEXT.md) makes Transaction a peer of Account, referenced by Schedule, Budget, Category and Tag, and a Transfer touches two Accounts rather than belonging to one. Transaction gets its own domain folder, `domains/app/transactions/`.

## Consequences

- `TransactionsService` lives under `transactions/` while still calling an Account-scoped URL. This is the same deliberate mismatch ADR 0003 recorded for names, applied to structure: the client's shape follows the product's language, not the API's route tree.
- "Every Transaction for one Account" is a query on the Transactions domain, not a capability of the Accounts domain. Account detail imports from `transactions/`, and the dependency runs one way.
- The Transaction type must stop dropping `accountId` and `transferToAccountId`. They were dropped as unread by the one screen that existed, but a Transfer cannot be signed without knowing which side of it the Account being viewed is on.
