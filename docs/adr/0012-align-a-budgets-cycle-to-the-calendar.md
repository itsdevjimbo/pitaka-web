---
status: accepted
---

# Align a Budget's Cycle to the calendar, and count only exact Category matches

A Budget recurs (see `CONTEXT.md`): its **Period** is a cadence and a **Cycle** is one dated window, the span its **Spent** figure covers. The API stores `Period`, `StartDate` and `EndDate` and evaluates none of them — `BudgetService` writes the enum and never reads it — so the meaning of a Cycle is a decision, not a fact to be discovered. Three rules fix it:

1. **Cycles follow the calendar, not the start day.** Monthly is a calendar month, Weekly runs Monday to Sunday, Quarterly is a calendar quarter, Yearly is January to December. `StartDate` says only when the Budget begins.
2. **A short Cycle carries the full ceiling.** The first Cycle is truncated by `StartDate` and the last by `EndDate`, and neither is pro-rated.
3. **A narrowed Budget matches its Category exactly.** Child Categories are not rolled up.

## Why

**Calendar alignment** is what the words mean. Someone who sets up a grocery budget on the 17th does not expect their month to run 17th-to-16th forever; they expect it to reset when the month does. The alternative — anchoring each Cycle to `StartDate` — also drags in arithmetic with no good answer: a Monthly Budget starting 31 January needs a clamping rule for February, and every such rule is a decision a person can be surprised by. Calendar alignment has no clamping and no surprises.

**No pro-rating** is the cost of that, and it is a real wart: a Budget created on the 28th shows a full ceiling for three days. Pro-rating was rejected because it makes the ceiling a number the person did not enter and cannot predict, and because the same rule then has to be defended for the truncated final Cycle. A short Cycle that says ₱20,000 is at least legible. The create form blunts this by defaulting `StartDate` to the start of the current calendar Period, so the common path has no short first Cycle at all.

**Exact Category matching** is the least obvious of the three, and it records a hazard rather than a preference. Categories nest in the API, so rolling a Budget on "Food" up over "Food › Groceries" is what a person probably expects. But the API rejects a direct self-reference and *not* a deeper cycle, so the tree is not acyclic and anything walking it can loop — which is precisely why the client already discards `parentId` and refuses to render Categories as a tree. A rollup would put that same unguarded walk on the server, inside the sum that a money figure depends on. Rollup is reconsiderable once the API guarantees the tree is acyclic; until then, exact match.

## Consequences

- These rules live on the **server**, because the server computes `AmountSpent`. The client does not re-derive a Cycle: the API returns the `cycleStart` and `cycleEnd` it summed over, so the window a figure covers and the window a screen labels cannot disagree. Two implementations of the same calendar arithmetic is the bug class a money application can least afford.
- The client still owns calendar arithmetic for one thing — defaulting `StartDate` in the create form — and that is a convenience, not an authority. If it disagreed with the server it would move a default, not a number.
- Rule 2 gives `EndDate` its plain meaning: spending after it never counts, because the final Cycle is truncated rather than extended to its natural end.
- A Budget can be narrowed to an Income Category as far as the API is concerned — `VerifyCategoryExistence` checks existence, not `CategoryType` — and such a Budget could only ever read ₱0 Spent. The client offers Expense Categories only; the gap is filed against `pitaka`, the same move ADR 0010 made for a Transfer's Category.
- Budgets do not partition spending, they observe it. An unnarrowed Budget and a Groceries Budget both count the same expense, and that is correct.
