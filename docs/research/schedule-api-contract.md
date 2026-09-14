# Existing Schedule API contract

Research for [Research the existing Schedule API contract](https://github.com/itsdevjimbo/pitaka-web/issues/192), a child of [Map: the Schedules screen](https://github.com/itsdevjimbo/pitaka-web/issues/188).

**Primary source:** the .NET API repo at `/Users/jimbo/Desktop/Projects/C#/pitaka`, at commit `580c540`. Citations below are paths and lines in that repo. Product-facing prose uses **Schedule**; the API calls the resource `RecurringTransaction`.

## Answer in one line

The API already supports listing, creating, reading, partially editing, pausing, resuming, cancelling, automatic completion, and conditionally deleting income/expense Schedules, but its immutable structural fields, UTC-based calendar evaluation, catch-up behavior, terminal-state loopholes, sparse list rows, and end-date edge case constrain the intended management experience.

## Resource and endpoints

The authenticated controller exposes:

- `GET /api/recurringtransactions`
- `POST /api/recurringtransactions`
- `GET /api/recurringtransactions/{id}`
- `PUT /api/recurringtransactions/{id}`
- `PATCH /api/recurringtransactions/{id}/status`
- `DELETE /api/recurringtransactions/{id}`

The route follows ASP.NET's controller-name convention (`Controllers/RecurringTransactionsController.cs:12-16,64-205`). The returned resource carries `id`, `accountId`, nullable `categoryId`, `name`, `type`, `amount`, nullable `description`, `frequency`, `startDate`, nullable `endDate`, `nextRunDate`, and `status` (`Resources/RecurringTransactionResource.cs:6-18`). The collection query has no ordering, pagination, filtering, Account/Category names, generated-history count, or deletability indicator (`Services/RecurringTransactionService.cs:22-26`).

Directions are `Income` and `Expense`; repeating Transfers do not exist (`Enums/RecurringTransactionType.cs:3-7`). Frequencies are `Daily`, `Weekly`, `Monthly`, and `Yearly` (`Enums/Frequency.cs:3-9`). Statuses are `Active`, `Paused`, `Completed`, and `Cancelled` (`Enums/RecurringTransactionStatus.cs:3-9`). These enums serialize as strings (`Program.cs:23-25`).

## Create and edit

Create requires Account, name, direction, frequency, amount, and start date. Category, description, and end date are optional. Name is limited to 255 characters; amount is from `0.01` through `999999999999.99`; start must be after the current UTC date; and an end must be after the start (`Requests/CreateRecurringTransactionRequest.cs:11-57`). Names are unique per user (`Data/PitakaDbContext.cs:65`; `Controllers/RecurringTransactionsController.cs:97-100`). A new Schedule starts Active with `nextRunDate` equal to `startDate` (`Models/RecurringTransaction.cs:31-33`; `Services/RecurringTransactionService.cs:43-63`).

PUT can change only name, amount, category, description, and end date (`Requests/UpdateRecurringTransactionRequest.cs:7-22`; `Services/RecurringTransactionService.cs:66-77`). It cannot change Account, direction, frequency, first generation, or next generation. Updating an end date checks only that it remains after the stored start (`Controllers/RecurringTransactionsController.cs:137-160`).

## Account and Category constraints

Create rejects a missing, foreign, or inactive Account. The update shape cannot move a Schedule to another Account (`Controllers/RecurringTransactionsController.cs:74-104`; `Requests/UpdateRecurringTransactionRequest.cs:7-18`). Generation also requires the Account to be active (`Actions/GetDueRecurringTransactions.cs:19-26`).

Account retirement suppresses generation without changing Schedule status. There is no explicit Account-to-Schedule delete behavior in the context, so EF's required-relationship convention applies cascade deletion: deleting an Account that has no Transaction-history guard but does have an unused Schedule may delete that Schedule with it (`Models/RecurringTransaction.cs:9-12,38`; `Data/PitakaDbContext.cs:84-132`; `Controllers/AccountsController.cs:104-126`). This is an inference from the model and complete relationship configuration.

When supplied, a Category must be visible to the user and match the Schedule direction (`Controllers/RecurringTransactionsController.cs:40-62,89-95,137-146`; `Actions/VerifyTransactionCategory.cs:33-47`). `Category.IsActive` is not checked, so the API accepts a retired Category on create or edit, and a Schedule already using one continues to generate Transactions. This conclusion follows directly from the verifier's complete query and verdict set plus the generation predicate, neither of which reads Category active state (`Actions/VerifyTransactionCategory.cs:8-13,33-47`; `Actions/GetDueRecurringTransactions.cs:19-26`). The web client therefore owns any rule that retired Categories disappear from pickers.

## Pause, resume, completion, and cancellation

The status endpoint accepts Active, Paused, and Cancelled but rejects manually setting Completed (`Requests/RecurringTransactionPatchRequest.cs:6-21`). Pausing or cancelling simply stores that status. Setting Active recomputes `nextRunDate` as the cadence occurrence on or after the current UTC day; if that is beyond the end date, the Schedule becomes Completed instead (`Services/RecurringTransactionService.cs:79-101`).

Consequently, the current API has no genuinely terminal stopped state: a client may reactivate a Cancelled Schedule because Active is accepted without regard to the prior status. It may also attempt to activate a Completed Schedule; whether that resumes it depends only on whether the calculated occurrence is beyond its current end (`Services/RecurringTransactionService.cs:79-101`). This is an inference from the exhaustive branch logic.

## Generation and calendar behavior

A Schedule is due when it is Active, its Account is active, and `nextRunDate` is no later than the current **UTC** day (`Actions/GetDueRecurringTransactions.cs:19-26`). The worker creates a Transaction dated at midnight on the stored next-run date. It copies Account, Category, amount, and direction, links the Schedule id, and sets the description to `Generated by recurring transaction: {name}` rather than copying the Schedule description (`Jobs/GenerateDueRecurringTransactions.cs:52-56`; `Actions/GenerateTransaction.cs:8-25`). Schedules cannot carry Tags because neither the resource nor requests contain them.

After generation, `nextRunDate` becomes the first cadence occurrence strictly after the current UTC day. If that occurrence is after the end date, status becomes Completed without advancing the stored `nextRunDate`, so a Completed resource continues to expose the just-generated date (`Jobs/GenerateDueRecurringTransactions.cs:58-67`). Daily adds days, Weekly adds seven-day blocks, and Monthly/Yearly add months or years from the original start (`Actions/GetNextRunDate.cs:14-50`). Therefore cadence stays anchored to first generation rather than drifting from the last actual generation.

The end date is inclusive in ordinary generation: an occurrence on the end date can generate, and completion happens when the following occurrence is later than the end (`Jobs/GenerateDueRecurringTransactions.cs:52-67`).

Missed occurrences are not fully replayed. If a stored next run is in the past, one Transaction is generated for that stored date, then the calculation jumps directly to the first occurrence after today (`Jobs/GenerateDueRecurringTransactions.cs:52-67`; `Actions/GetNextRunDate.cs:17-30`). Thus pausing or Account inactivity skips intervening occurrences after at most one old due generation. This is an inference from the worker's single pass per Schedule and its exclusive-of-today recalculation.

The background worker's interval is configurable and may be disabled, so `nextRunDate` is a planned calendar date rather than a guaranteed execution instant (`Jobs/RecurringTransactionGenerationWorker.cs:25-50`).

An Account optimistic-concurrency loss is retried on the next worker run. Other failures are logged and rolled back for that Schedule while processing continues for the remaining Schedules, so one persistently invalid Schedule starves itself rather than the entire run (`Jobs/GenerateDueRecurringTransactions.cs:71-88`).

## Delete and generated history

Delete returns 204 only while no Transaction references the Schedule. Once any generated Transaction exists it returns 409, preserving the foreign-key signal that distinguishes generated Transactions; cancellation is then the intended terminal action (`Controllers/RecurringTransactionsController.cs:183-205`; `Services/RecurringTransactionService.cs:110-117`; `Data/PitakaDbContext.cs:124-132`). The list resource does not expose whether that guard will fire, so a client cannot know deletability without attempting delete or receiving more API data.

Generated Transactions carry `recurringTransactionId`, but the existing Transaction list contract has no Schedule filter. The global paginated endpoint accepts Account, Category, direction, description, and date filters only (`Controllers/TransactionsController.cs:66-74`; `Requests/TransactionQueryRequest.cs:7-30`; `Services/TransactionService.cs:25-97`). The legacy Account-nested endpoint has no query filters (`Controllers/AccountsController.cs:129-142`). A generated-history navigation filtered to one Schedule therefore needs a contract addition or client-side filtering of an otherwise bounded result.

## Important contract gaps and edge cases

These are facts or direct inferences the product specification must account for, not proposed product decisions:

1. **Local-calendar mismatch.** Create validation, due evaluation, resume, and recurrence calculation use UTC day, so they cannot promise the person's local-calendar first/next generation near a UTC boundary (`Requests/CreateRecurringTransactionRequest.cs:39-45`; `Actions/GetDueRecurringTransactions.cs:22-25`; `Actions/GetNextRunDate.cs:20-32`).
2. **Structural edits are absent.** Account, direction, frequency, and start date cannot be edited (`Requests/UpdateRecurringTransactionRequest.cs:7-18`).
3. **Stopped is not terminal.** Cancelled can be patched back to Active (`Services/RecurringTransactionService.cs:79-101`).
4. **Completed extension is not atomic.** PUT may extend `endDate`, but restoring Active is a separate PATCH; current PATCH logic allows it if a future cadence occurrence fits (`Controllers/RecurringTransactionsController.cs:121-180`; `Services/RecurringTransactionService.cs:79-101`).
5. **Potential generation beyond a shortened end.** PUT can set an end date earlier than the current `nextRunDate` because it validates only `end > start`. The due query ignores end, and the worker generates before checking whether the following occurrence exceeds end. A later due pass can therefore create one Transaction after the edited end date (`Controllers/RecurringTransactionsController.cs:148-150`; `Actions/GetDueRecurringTransactions.cs:22-25`; `Jobs/GenerateDueRecurringTransactions.cs:52-67`). This is an inference from the operation order.
6. **Sparse operational list.** The list has IDs but no dependency names, ordering, history count, or action capability flags (`Resources/RecurringTransactionResource.cs:6-18`; `Services/RecurringTransactionService.cs:22-26`).
7. **No Schedule-filtered history endpoint.** Transactions expose the originating id but cannot be queried by it through the current list contract (`Resources/TransactionResource.cs:6-23`; `Services/TransactionService.cs:17-84`).
8. **Retirement enforcement is client-only for Category.** The server accepts retired Categories and keeps generating under them, while inactive Accounts suppress generation (`Actions/VerifyTransactionCategory.cs:33-47`; `Actions/GetDueRecurringTransactions.cs:19-26`).
9. **Description has two meanings.** A Schedule stores a description, but generated Transactions receive a fixed provenance sentence instead (`Services/RecurringTransactionService.cs:43-58`; `Actions/GenerateTransaction.cs:14-18`).
10. **Unused Schedule deletion may follow Account deletion.** Account retirement merely suppresses generation, but the required Account relationship appears to cascade on delete by convention; the Account delete guard checks history and Goal contributions, not Schedules (`Controllers/AccountsController.cs:104-126`; `Models/RecurringTransaction.cs:9-12,38`; `Data/PitakaDbContext.cs:84-132`). This is an inference that deserves an API test before relying on it in UX wording.

These gaps support a separate API-contract decision before the UX specification can truthfully promise local calendar dates, terminal stopping, completed extension, Schedule-filtered history, and dependency-aware actions.
