---
status: accepted
---

# Keep a Transfer as one Transaction, not a linked pair

The API stores a Transfer as a single row: `AccountId` is the Account the money leaves, `TransferToAccountId` the one it lands in, and `UpdateAccountBalance` moves both. Since pitaka#61 widened the list filter to `AccountId == id || TransferToAccountId == id`, that one row appears in *both* Accounts' lists — so a single Transaction is read from two places, and whether it shows as `-₱5,000` or `+₱5,000` depends on which Account the person is standing in. Pitaka Web keeps it that way: one Transaction, signed against the Account in view.

## Considered options

A **linked pair** — an outgoing Transaction and an incoming one joined by a shared id — was the alternative, and its appeal is real: every row would belong to exactly one Account, so a sign would be intrinsic rather than contextual, and the list filter would go back to a plain `AccountId ==`.

It was rejected because the pair has no owner, and the question "which one is the real Transaction?" has no good answer in either form it could take. Split in the API, the movement is the *pair* and neither leg is it, so every write has to fan out: delete both atomically, keep the date and the note in sync, and never leave an orphan leg — which would corrupt a balance permanently and silently, with nothing left on screen to explain the missing money. Rendered as two rows over one record, the two rows *are* the record: deleting either removes both, and the interface would have spent a row asserting there were two things when there was one.

Both trade a rendering problem for a data-integrity problem. In a money application that trade only runs the other way. The rendering problem is also already solved — `toRow` signs a Transfer against the Account on screen in eight lines that have been correct since #19.

## Consequences

- A Transfer's sign is a property of the *reading*, not of the record. The rule holds only where an Account is in view. Every screen that renders a Transaction today has one; the first screen that does not — a Transactions list spanning Accounts — must render a Transfer unsigned, as "Cash → Bank", rather than picking a side.
- A Transaction is acted on where it was recorded. In the destination Account's list a Transfer is read-only and links back to the source, because deleting from there would move a balance the screen cannot show. The two Accounts are not equal partners: `accountId` is the Transaction's home.
- Nothing needs invalidating across Accounts when a Transfer is recorded or removed, even though two balances move. ADR 0006 already forbids caching a balance, so the other Account re-reads its own on entry by construction.
- A Transfer carries no Category. `CategoryType` has exactly two members, Income and Expense, so no Category could classify one — the client sends `categoryId: null` on every write and renders no Category field for that direction. The API does not enforce this and will store a Category on a Transfer; that gap is filed against `pitaka`.
