# Pitaka Web

Pitaka Web is the Angular client for Pitaka, a personal expense tracker. (*Pitaka* is Tagalog for wallet.)

This glossary fixes the words the client uses. In three places those words deliberately differ from the names the backend uses; where they do, the backend's name is listed under `_Avoid_` and the translation happens at the HTTP adapter, never above it.

## Language

### Identity

**Profile**:
The person's own identity and credentials — their name, email, and password. It is never called an account.
_Avoid_: Account, user account, my account, user settings

**Confirmed / unconfirmed**:
A Profile that has, or has not, proven control of its email address. Registering creates an unconfirmed Profile and does not sign the person in; confirming is the one step between registering and signing in.
_Avoid_: Verified, activated, validated

**Locked out**:
A Profile temporarily barred from signing in after repeated failed attempts. A timed state that clears itself — distinct from Retire, which is a deliberate choice and never applies to a Profile.
_Avoid_: Banned, suspended, disabled, blocked

### Money that has moved

**Account**:
A container of money the person owns — cash on hand, a bank account, a credit card, a wallet, or an investment holding. It carries a running balance and can be retired without being erased.
_Avoid_: Wallet, ledger, user account, source

**Transaction**:
A single recorded movement of money: income received, an expense paid, or a transfer. Its amount and direction are settled at the moment it is recorded and do not change afterward; how it is *filed* — when it is dated, its Category, its note, its Tags — can be corrected later.
_Avoid_: Entry, record, payment, item

**Direction**:
Which of the three kinds a Transaction reads as: income, expense, or Transfer. It decides what a Transaction can carry — an income or an expense is filed under a Category, a Transfer names a destination Account instead — and it carries the sign, so a recorded amount is always positive. *Income* and *Expense* are the API's own words; *direction* is this client's word for the choice between them, and is not a fourth translated term.
_Avoid_: Type, kind, sign

**Transfer**:
A Transaction moving money between two Accounts the same person owns. Across the pair it is neither income nor expense: it changes where money sits, not how much there is. It is one Transaction rather than two, appearing in both Accounts' lists as the same record and signed against whichever Account is in view — leaving the one it comes from, arriving in the one it goes to. It is recorded against the Account it leaves, and that is the only place it can be refiled or removed. It carries no Category, because every Category is a kind of income or expense and a Transfer is neither.
_Avoid_: Internal transaction, move, send

**Generated transaction**:
A Transaction created automatically by a Schedule rather than entered by the person. An ordinary Transaction in every other respect.
_Avoid_: Recurring transaction, auto transaction, scheduled transaction

### Lifecycle

**Retire**:
Taking an Account out of use while keeping everything it recorded. A retired Account still shows its balance and history, records nothing new, and can be brought back.
_Avoid_: Archive, close, deactivate, disable

**Delete**:
Erasing an Account entirely. Refused while it still holds Transaction history or money owed to a Goal — retiring is the way out.
_Avoid_: Remove, destroy, close

**Refile**:
Correcting how an already-recorded Transaction is filed — when it is dated, its Category, its note, its Tags. Never its amount or direction, which are settled at recording; the only correction for those is to Remove it.
_Avoid_: Edit, update, modify, patch

**Remove**:
Erasing a Transaction, moving the balance back by exactly what it moved. The correction refiling cannot make, since an amount is settled at recording.
_Avoid_: Delete, void, reverse, undo

### Money that is planned

**Schedule**:
A standing instruction that creates a Transaction on a repeating cadence. It is a plan rather than money that has moved, and it can be paused and resumed.
_Avoid_: Recurring transaction, recurring, repeat, subscription

**Budget**:
A recurring spending ceiling for one Cycle, optionally narrowed to a single Category. Only expenses count against it — never income, never a Transfer — and an unnarrowed Budget watches all spending. The person succeeds by staying under it.
_Avoid_: Limit, cap, allowance, plan

**Period**:
How often a Budget renews — daily, weekly, monthly, quarterly, or yearly.
_Avoid_: Frequency, cadence, interval, cycle

**Cycle**:
One dated window of a Budget, the span its Spent figure covers. Cycles follow the calendar rather than the day the Budget began, so the first and last may be short — and a short Cycle still carries the full ceiling.
_Avoid_: Window, term, month, period

**Spent**:
How much of a Budget's ceiling the current Cycle has used: the expenses inside the Cycle that match its Category.
_Avoid_: Used, consumed, progress, current amount

**Goal**:
A savings target the person accumulates toward over time. The person succeeds by reaching it. Distinct from a Budget, which is a ceiling rather than a target.
_Avoid_: Target, savings plan, budget

**Contribution**:
Money moved from an Account toward a Goal. A Goal's progress is the sum of its Contributions and nothing else.
_Avoid_: Deposit, saving, goal transaction, allocation

### Classification

**Category**:
A label classifying a Transaction as a kind of income or expense. Categories may nest, and some are supplied by Pitaka rather than created by the person.
_Avoid_: Type, group, bucket, classification

**Tag**:
A free-form label the person attaches to Transactions to cut across Categories. A Transaction may carry many.
_Avoid_: Label, keyword, marker
