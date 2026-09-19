# Pitaka Web

Pitaka Web is the Angular client for Pitaka, a personal expense tracker. (*Pitaka* is Tagalog for wallet.)

This glossary fixes the words the client uses. In two places those words deliberately differ from the names the backend uses; where they do, the backend's name is listed under `_Avoid_` and the translation happens at the HTTP adapter, never above it.

## Language

### Identity

**Profile**:
The person's own identity and credentials — their name, email, and password. It is never called an account.
_Avoid_: Account, user account, my account, user settings

**Confirmed / unconfirmed**:
A Profile that has, or has not, proven control of its email address. Registering creates an unconfirmed Profile and does not sign the person in; confirming is the one step between registering and signing in.
_Avoid_: Verified, activated, validated

**Pending email change**:
A time-bounded request to replace a Profile's email address. It ends when the new address is confirmed, the request is cancelled or replaced, or its confirmation window expires silently.
_Avoid_: Email change in progress, pending email, unconfirmed email

**Locked out**:
A Profile temporarily barred from signing in after repeated failed attempts. A timed state that clears itself — distinct from Retire, which is a deliberate choice and never applies to a Profile.
_Avoid_: Banned, suspended, disabled, blocked

### Money that has moved

**Account**:
A container of money the person owns — cash on hand, a bank account, a wallet, or an investment holding. It carries a running balance and can be retired without being erased.
_Avoid_: Wallet, ledger, user account, source

**Transaction**:
A single recorded movement of money: income received, an expense paid, or a transfer. Its amount and direction are settled at the moment it is recorded and do not change afterward; how it is *filed* — when it is dated, its Category, its note, its Tags — can be corrected later.
_Avoid_: Entry, record, payment, item

**Direction**:
Which of the three kinds a Transaction reads as: income, expense, or Transfer. It decides what a Transaction can carry — an income or an expense is filed under a Category, a Transfer names a destination Account instead — and it carries the sign, so a recorded amount is always positive. *Income* and *Expense* are the API's own words; *direction* is this client's word for the choice between them, and is not a fourth translated term.
_Avoid_: Type, kind, sign

**Transfer**:
A Transaction moving money between two Accounts the same person owns. Across the pair it is neither income nor expense: it changes where money sits, not how much there is. It is one Transaction rather than two, appearing in both Accounts' lists as the same record and signed against whichever Account is in view — leaving the one it comes from, arriving in the one it goes to. Where no Account is in view, it is neither incoming nor outgoing and reads as the movement between its two ends. It is recorded against the Account it leaves, and that is the only place it can be refiled or removed. It carries no Category, because every Category is a kind of income or expense and a Transfer is neither.
_Avoid_: Internal transaction, move, send

**Generated transaction**:
A Transaction created automatically by a Schedule rather than entered by the person. An ordinary Transaction in every other respect.
_Avoid_: Recurring transaction, auto transaction, scheduled transaction

### Lifecycle

**Retire**:
Taking an Account or a Category out of use while keeping everything it recorded. A retired Account still shows its balance and history, records nothing new, and can be Reactivated. A retired Category still labels the Transactions already filed under it and is no longer offered when filing a new one, though a record already filed under it keeps showing it. It is still offered when searching: filing and finding are different acts, and history filed under a retired Category has to stay reachable. Retiring a Category does not stop a Schedule: one that already files under it goes on creating Transactions there until the Schedule itself is changed. A Category supplied by Pitaka cannot be retired.
_Avoid_: Archive, close, deactivate, disable

**Reactivate**:
Bringing a retired Account or Category back into use. The inverse of Retire, and the only word for it.
_Avoid_: Restore, unretire, reopen, enable

**Complete / Completed Goal**:
Declaring a Goal achieved after it has reached its target. Completed is a durable state chosen by the person, not a figure derived continuously from the Goal's Contributions; only marking the Goal active ends it.
_Avoid_: Retire, close, finish

**Completed Schedule**:
A Schedule that generated its final eligible occurrence on or before its inclusive Last generation date. It is reached automatically rather than chosen by the person, and can be extended, which reactivates it.
_Avoid_: Stopped, paused, ended, finished

**Abandon / Abandoned**:
Stopping pursuit of a Goal without erasing it or releasing its earmarks. An Abandoned Goal keeps its Contributions but accepts no new ones until the person marks it active.
_Avoid_: Retire, cancel, archive

**Mark active / Active**:
Opening a Completed or Abandoned Goal to pursuit and new Contributions again. It is deliberately distinct from Reactivate, which applies only to a retired Account or Category.
_Avoid_: Reactivate, restore, reopen

**Cancelled Schedule**:
An existing Schedule in the API's reversible Cancelled state. It appears under Past and can be resumed. Permanent stopping is not part of the current product lifecycle.
_Avoid_: Stopped, ended, retired

**Delete**:
Erasing an Account, Category, Goal, or never-used Schedule entirely. A Goal's Contributions and earmarks go with it, but not Account money; an Account with Transaction history or earmarks and a Category still in use cannot be deleted — retire either instead. A Schedule can be deleted only before it has ever generated a Transaction, even if none of its generated Transactions survive.
_Avoid_: Remove, destroy, close

**Refile**:
Correcting how an already-recorded Transaction is filed — when it is dated, its Category, its note, its Tags. Never its amount or direction, which are settled at recording; the only correction for those is to Remove it.
_Avoid_: Edit, update, modify, patch

**Remove**:
Erasing a Transaction, moving the balance back by exactly what it moved. The correction refiling cannot make, since an amount is settled at recording.
_Avoid_: Delete, void, reverse, undo

### Money that is planned

**Schedule**:
A standing instruction that creates income or expense Transactions on a repeating cadence. It is a plan rather than money that has moved: it can be paused and resumed, becomes Completed after its inclusive Last generation date, and an existing Cancelled Schedule can be resumed. A Schedule never creates a Transfer.
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

**Earmark**:
An amount within an Account claimed toward a Goal by a Contribution. It remains part of the Account's balance but cannot simultaneously support another Contribution.
_Avoid_: Allocation, reserved balance, moved money

**Contribution**:
An earmark of money in an Account toward a Goal. A Goal's progress is the sum of its Contributions and nothing else.
_Avoid_: Deposit, saving, goal transaction, allocation

**Linked Contribution**:
A Contribution sourced from an income Transaction into an active Account. Its Account is the Transaction's, its Contribution date is the person's local calendar day when it is created, and its amount may be some or all of the Transaction's amount still uncommitted to other Linked Contributions, subject also to the Account's available money. Its amount and Transaction link are settled when it is created; changing either means deleting it and creating another. The Transaction cannot be removed while the link exists.
_Avoid_: Earmarked transaction, transaction earmark

### Classification

**Category**:
A label classifying a Transaction as a kind of income or expense. Whether it is a kind of income or a kind of expense is settled when it is created and never changes afterward. Categories do not nest. Some are supplied by Pitaka rather than created by the person; those are read-only — they cannot be renamed, retired, or deleted.
_Avoid_: Type, group, bucket, classification

**Tag**:
A free-form label the person attaches to Transactions to cut across Categories. A Transaction may carry many. A name can only be used once — the person cannot have two Tags with the same name. Unlike a Category, a Tag cannot be retired; the only removal is to delete it, which takes it off every Transaction carrying it.
_Avoid_: Label, keyword, marker
