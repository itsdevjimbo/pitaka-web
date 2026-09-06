# What a retired Category does to a Budget and a Schedule

Research for [#98](https://github.com/itsdevjimbo/pitaka-web/issues/98), a child of the
Categories map [#91](https://github.com/itsdevjimbo/pitaka-web/issues/91).

**Primary source:** the .NET API repo at `/Users/jimbo/Desktop/Projects/C#/pitaka`, at
commit `53b2222`. Every citation below is `path:line` in that repo. No secondary source
was used.

## Answer in one line

`Category.IsActive` is **inert everywhere except the Categories endpoints themselves**.
Nothing anywhere in the API reads it to gate a Budget, a Schedule, or a Transaction —
neither for existing references nor for new ones. Retiring a Category changes exactly one
thing: the `isActive` field on `GET /api/categories`. It is a client-side display flag.

This is deliberate, not an oversight. ADR 0004 states it outright: a retired Category must
still resolve names on old records and so must still be returned by `GET /api/categories`;
"the filtering happens in pickers, not on read"
(`docs/adr/0004-a-category-in-use-cannot-be-deleted.md`, *Considered options* →
*Soft-delete the category*).

## 1. Does a Budget narrowed to a retired Category keep computing `amountSpent`?

**Yes, unchanged.** `GET /api/budgets` neither fails, nor drops the Budget, nor returns it
empty.

- `BudgetService.GetAllForUser` filters on `UserId` only — no Category join, no `IsActive`
  clause (`PitakaApp.Api/Services/BudgetService.cs:17-21`).
- `BudgetsController.Get` enriches every returned Budget via `GetBudgetWithSpend`, with no
  filtering step (`PitakaApp.Api/Controllers/BudgetsController.cs:49-66`).
- The sum itself matches on `t.CategoryId == budget.CategoryId` and nothing else — the
  `Category` row is never loaded, so its `IsActive` cannot participate
  (`PitakaApp.Api/Actions/GetBudgetAmountSpent.cs:26-35`).
- `BudgetWithSpendResource` carries `CategoryId` as a bare `int?` and no Category detail at
  all (`PitakaApp.Api/Resources/BudgetWithSpendResource.cs:9-21`), so a retired Category
  cannot even be *noticed* from the Budgets wire shape.

Transactions filed under the Category before it was retired continue to be summed, and
Transactions filed under it *after* it was retired are summed too (see section 4).

## 2. Does a Schedule carrying a retired Category still generate Transactions?

**Yes.** Generation is gated on the Schedule's status and its **Account**'s `IsActive` —
never on the Category:

    rt.Status == RecurringTransactionStatus.Active && rt.Account.IsActive &&
    rt.NextRunDate <= today

(`PitakaApp.Api/Actions/GetDueRecurringTransactions.cs:19-26`)

The generated Transaction copies `CategoryId` straight across with no validation
(`PitakaApp.Api/Actions/GenerateTransaction.cs:14`). `RecurringTransactionService` touches
`CategoryId` only as an assignment target at lines 50 and 69 and never reads a Category row
(`PitakaApp.Api/Services/RecurringTransactionService.cs`).

So a retired Category keeps generating Transactions filed under itself, indefinitely.

## 3. Do POST/PUT reject a retired Category as a *new* reference?

**No. This is the load-bearing finding, and it refutes the ticket's premise.** The ticket
asked which status code the rejection uses; there is no rejection.

Both write paths funnel every Category reference through a verifier, and neither verifier
loads or consults `IsActive`:

- `VerifyBudgetCategory.VerifyAsync` queries
  `c.Id == categoryId && (c.UserId == user.Id || c.IsDefault)`, then returns `Ok` /
  `NotFound` / `NotExpense`. Retired is not one of the verdicts
  (`PitakaApp.Api/Actions/VerifyBudgetCategory.cs:31-45`; the verdict enum is at `:8-13`).
- `VerifyTransactionCategory.VerifyAsync` is the same shape with verdicts `Ok` /
  `NotFound` / `TypeMismatch` (`PitakaApp.Api/Actions/VerifyTransactionCategory.cs:33-47`,
  enum at `:8-13`). It serves both `TransactionsController` and
  `RecurringTransactionsController`.

The controllers can only send what the verdicts describe. `BudgetsController` maps them to
`400 "Category does not exist"` and
`400 "A budget can only be narrowed to an expense category."`
(`PitakaApp.Api/Controllers/BudgetsController.cs:38-47`, applied on POST at `:78-82` and on
PUT at `:124-128`). `RecurringTransactionsController` maps them to
`400 "Category does not exist"` and
`400 "A recurring transaction's category must be of the same type as the transaction."`
(`PitakaApp.Api/Controllers/RecurringTransactionsController.cs:51-62`, applied on POST at
`:87-93` and on PUT immediately below it).

There is no third branch. **A retired Category is accepted as a brand-new Budget narrowing
or a brand-new Schedule category, with a 201/200 and no warning.**

Note the contrast with Accounts, which *is* gated: both controllers reject an inactive
Account with `400 "Account is inactive"`
(`PitakaApp.Api/Controllers/TransactionsController.cs:90-93`,
`PitakaApp.Api/Controllers/RecurringTransactionsController.cs:84-87`). The Category
equivalent was simply never written.

### Nothing else gates it either — what was checked to conclude an absence

- **Request validators.** There are none beyond DataAnnotations. `BudgetRequest`'s
  `IValidatableObject.Validate` checks only `EndDate >= StartDate`; `CategoryId` is a plain
  `int? = null` with no attribute (`PitakaApp.Api/Requests/BudgetRequest.cs:22, 28-37`).
  `CreateRecurringTransactionRequest.cs:30`, `UpdateRecurringTransactionRequest.cs:14`,
  `CreateTransactionRequest.cs:18` and `UpdateTransactionRequest.cs:9` likewise declare
  `CategoryId` with no constraint. There is no `Validators/` directory in the project.
- **DB constraints.** The `is_active` column is a plain non-null `tinyint(1)` defaulted to
  `true`, with no check constraint and no index
  (`PitakaApp.Api/Migrations/20260903154453_AddIsActiveToCategory.cs:16-21`). The three
  Category foreign keys in `PitakaApp.Api/Data/PitakaDbContext.cs:107-121` (Budget,
  RecurringTransaction, Transaction) are `Restrict`-on-delete only; an FK cannot express
  "referencable only while active" in any case.
- **Repo-wide grep.** `IsActive` appears in non-migration API source only in
  `Category.cs:25,32,37`, `Account.cs:23,54,59`, the two resources, the two patch
  request/input records, the two `PatchActiveStatus` service methods, and the
  **Account**-gating sites listed above. No Category-gating site exists.
- **The API's own test suite.** `PitakaApp.Api.Tests` asserts retire/reactivate on the
  Categories endpoints and that retired Categories are still listed
  (`Controllers/CategoriesControllerTest.cs:525-539`, `:544-554`, `:588-600`) and that
  delete-in-use still 409s when retired (`:604`, `:618`). **No test in
  `BudgetsControllerTest.cs`, `RecurringTransactionsControllerTest.cs`,
  `TransactionsControllerTest.cs` or `Jobs/GenerateDueRecurringTransactionsTest.cs`
  mentions a retired Category at all** — the only `isActive: false` fixtures in those files
  are Accounts (`RecurringTransactionsControllerTest.cs:123`, `:959`). The suite has no
  opinion to state because there is no behaviour to pin.

## 4. Filing a Transaction under a retired Category

**Allowed, both on create and on update.** `TransactionsController.Post` runs the same
`VerifyTransactionCategory` (`PitakaApp.Api/Controllers/TransactionsController.cs:96-102`),
which has no retired verdict; `PUT` reuses it. `TransactionService` assigns `CategoryId`
without reading the Category (`PitakaApp.Api/Services/TransactionService.cs:117`, `:154`),
and the list filter matches on the id alone (`:37-39`), so retired Categories remain fully
filterable — which incidentally answers #91's open "Not yet specified" item on the
Transactions filter bar from the API side: the API will happily filter by one.

## Does #93's no-confirmation assumption survive?

**Yes — on its own terms, and more strongly than the ticket expected.** #98's exit
condition was "if retiring breaks a Schedule, #93 reopens". Retiring breaks nothing:

- an existing Budget keeps computing `amountSpent` (section 1);
- an existing Schedule keeps generating Transactions (section 2);
- nothing anywhere returns a new error after a retire.

Retire is server-side reversible and consequence-free. There is nothing for a confirmation
to name.

**But the assumption survives for a different reason than the one it was made on**, and
that difference is a client decision, not an API one. #93 assumed *retired-but-usable-by-
existing, rejected-as-new*. The API implements only the first half. Since retirement is
enforced nowhere on the server, the "retired Categories are filtered out of pickers"
decision from #91 is the **sole** enforcement of what retiring means — exactly as ADR 0004
intended. Two consequences the spec should be explicit about:

1. **A Schedule carrying a newly retired Category will keep filing Transactions under it
   forever.** Not a break, but arguably a surprise: the person retired the Category to stop
   using it, and a Schedule quietly keeps using it. If that is worth surfacing, it belongs
   on the Schedules screen or in retire's own wording — not as a blocking confirmation.
2. **A Budget or Schedule edit form must filter retired Categories out of its picker
   itself.** The API will accept one, so a leak in the client is a silent wrong-state, not
   a 400. This is a client-side invariant with no server backstop.
