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
export type {
  LinkedContributionAccount,
  TransactionLinkedContribution,
  TransactionLinkedContributions,
} from './data/linked-contribution';
export type {
  CreatedTransactionSplitContribution,
  TransactionSplitPayload,
  TransactionSplitResult,
  TransactionSplitRow,
} from './data/transaction-split';
export type {
  TransactionSplitAvailability,
  TransactionSplitUnavailableReason,
} from './data/transaction-split-availability';
export type { RecordTransactionDialogData } from './ui/record-transaction-dialog';
export type { RefileTransactionDialogData } from './ui/refile-transaction-dialog';
export { TransactionsService } from './data/transactions.service';
export { scheduleHistoryQueryParams } from './data/transaction-criteria-params';
export { RecordTransactionDialog } from './ui/record-transaction-dialog';
export { RefileTransactionDialog } from './ui/refile-transaction-dialog';
export { TransactionSplitContextStore } from './ui/transaction-split-context';
export {
  REFUSED_SPLIT_MESSAGE,
  TRANSACTION_SPLIT_IDEMPOTENCY_KEY,
  TransactionSplitRecoveryStore,
  UNCERTAIN_SPLIT_MESSAGE,
} from './ui/transaction-split-recovery';
export type {
  TransactionSplitContext,
  TransactionSplitContextState,
  TransactionSplitHistoryContext,
} from './ui/transaction-split-context';
export type { TransactionSplitAttempt, TransactionSplitRecoveryState } from './ui/transaction-split-recovery';
export { TransactionRow, toAccountRow, toSpanningRow } from './ui/transaction-row';
export type { TransactionRowModel, TransactionRowReading } from './ui/transaction-row';
