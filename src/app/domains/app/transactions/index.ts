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
  TransactionSearchResult,
  TransferDestinationAccount,
} from './data/transaction';
export type {
  LinkedContributionAccount,
  TransactionLinkedContribution,
  TransactionLinkedContributions,
} from './data/linked-contributions/linked-contribution';
export type {
  CreatedTransactionSplitContribution,
  TransactionSplitPayload,
  TransactionSplitResult,
  TransactionSplitRow,
} from './data/linked-contributions/transaction-split';
export type {
  TransactionSplitAvailability,
  TransactionSplitUnavailableReason,
} from './data/linked-contributions/transaction-split-availability';
export type { RecordTransactionDialogData } from './ui/record-transaction/record-transaction-dialog';
export type { RefileTransactionDialogData } from './ui/refile-transaction/refile-transaction-dialog';
export { TransactionsService } from './data/transactions.service';
export { scheduleHistoryQueryParams } from './data/transaction-criteria-params';
export { RecordTransactionDialog } from './ui/record-transaction/record-transaction-dialog';
export { RefileTransactionDialog } from './ui/refile-transaction/refile-transaction-dialog';
export { TransactionSplitContextStore } from './ui/transaction-split/transaction-split-context';
export {
  REFUSED_SPLIT_MESSAGE,
  TRANSACTION_SPLIT_IDEMPOTENCY_KEY,
  TransactionSplitRecoveryStore,
  UNCERTAIN_SPLIT_MESSAGE,
} from './ui/transaction-split/transaction-split-recovery';
export type {
  TransactionSplitContext,
  TransactionSplitContextState,
  TransactionSplitHistoryContext,
} from './ui/transaction-split/transaction-split-context';
export type {
  TransactionSplitAttempt,
  TransactionSplitRecoveryState,
} from './ui/transaction-split/transaction-split-recovery';
export { TransactionRow, toAccountRow, toSpanningRow } from './ui/transaction-row/transaction-row';
export type { TransactionRowModel, TransactionRowReading } from './ui/transaction-row/transaction-row';
