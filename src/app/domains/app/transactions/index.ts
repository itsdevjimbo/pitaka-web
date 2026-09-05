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
export type { RecordTransactionDialogData } from './ui/record-transaction-dialog';
export type { RefileTransactionDialogData } from './ui/refile-transaction-dialog';
export { TransactionsService } from './data/transactions.service';
export { RecordTransactionDialog } from './ui/record-transaction-dialog';
export { RefileTransactionDialog } from './ui/refile-transaction-dialog';
export { TransactionRow, toAccountRow, toLedgerRow } from './ui/transaction-row';
export type {
  TransactionRowModel,
  TransactionRowReading,
} from './ui/transaction-row';
