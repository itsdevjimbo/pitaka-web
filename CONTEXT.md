# Pitaka Web

Pitaka Web is the Angular client for Pitaka, a personal expense tracker. (*Pitaka* is Tagalog for wallet.)

This glossary fixes the words the client uses. In three places those words deliberately differ from the names the backend uses; where they do, the backend's name is listed under `_Avoid_` and the translation happens at the HTTP adapter, never above it.

## Language

### Identity

**Profile**:
The person's own identity and credentials — their name, email, and password. It is never called an account.
_Avoid_: Account, user account, my account, user settings

### Money that has moved

**Account**:
A container of money the person owns — cash on hand, a bank account, a credit card, a wallet, or an investment holding. It carries a running balance and can be retired without being erased.
_Avoid_: Wallet, ledger, user account, source

**Transaction**:
A single recorded movement of money: income received, an expense paid, or a transfer. Its amount and direction are settled at the moment it is recorded and do not change afterward.
_Avoid_: Entry, record, payment, item

**Transfer**:
A Transaction moving money between two Accounts the same person owns. Across the pair it is neither income nor expense: it changes where money sits, not how much there is. Against a single Account it is always signed — it leaves the Account it comes from and arrives in the Account it goes to, so one Transfer reads as outgoing from one Account and incoming to the other.
_Avoid_: Internal transaction, move, send

**Generated transaction**:
A Transaction created automatically by a Schedule rather than entered by the person. An ordinary Transaction in every other respect.
_Avoid_: Recurring transaction, auto transaction, scheduled transaction

### Money that is planned

**Schedule**:
A standing instruction that creates a Transaction on a repeating cadence. It is a plan rather than money that has moved, and it can be paused and resumed.
_Avoid_: Recurring transaction, recurring, repeat, subscription

**Budget**:
A spending ceiling for a period, optionally narrowed to one Category. The person succeeds by staying under it.
_Avoid_: Limit, cap, allowance, plan

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
