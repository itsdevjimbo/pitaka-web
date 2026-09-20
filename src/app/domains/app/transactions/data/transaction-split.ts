import { LinkedContributionAccount } from './linked-contribution';

/** One ordered Goal row in an atomic Transaction split. */
export type TransactionSplitRow = {
  goalId: number;
  amount: number;
  note: string | null;
  acknowledgeTargetOverrun: boolean;
};

/** The complete semantic payload retained for idempotent recovery. */
export type TransactionSplitPayload = {
  transactionId: number;
  contributionDate: string;
  contributions: readonly TransactionSplitRow[];
};

/** One newly created row returned by a successful split or matching replay. */
export type CreatedTransactionSplitContribution = {
  id: number;
  goalId: number;
  accountId: number;
  transactionId: number;
  amount: number;
  contributionDate: Date;
  note: string | null;
};

/** Historical result saved for the operation, not a current-state promise. */
export type TransactionSplitResult = {
  transactionId: number;
  transactionAmount: number;
  linkedTotal: number;
  remainingCapacity: number;
  account: LinkedContributionAccount;
  contributions: CreatedTransactionSplitContribution[];
};
