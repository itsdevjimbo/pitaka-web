// The Transactions domain's interface to the rest of the app: the vocabulary
// (types, constants), the API adapter, and the row an Account's detail screen
// renders. "Every Transaction for one Account" is a query on this domain, not a
// capability of Accounts (ADR 0009), so Account detail imports from here and the
// dependency runs one way.
export { TRANSACTION_DIRECTIONS } from './data/transaction';
export type {
  NewTransaction,
  RefileTransaction,
  Tag,
  Transaction,
  TransactionDirection,
  TransferDestinationAccount,
} from './data/transaction';
export { TransactionsService } from './data/transactions.service';
export { RecordTransactionForm } from './ui/record-transaction-form';
export { RefileTransactionForm } from './ui/refile-transaction-form';
export { TransactionRow, toTransactionRow } from './ui/transaction-row';
export type { TransactionRowModel } from './ui/transaction-row';
