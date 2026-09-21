/** The fixed Account facts carried by an authoritative Transaction link read. */
export type LinkedContributionAccount = {
  id: number;
  name: string;
  currentBalance: number;
  earmarkedTotal: number;
  availableHeadroom: number;
  active: boolean;
};

/** One complete Contribution row in a Transaction's link history. */
export type TransactionLinkedContribution = {
  id: number;
  goalId: number;
  goalName: string;
  accountId: number;
  transactionId: number;
  amount: number;
  contributionDate: Date;
  note: string | null;
};

/**
 * One coherent, authoritative view of a Transaction's links and both money
 * constraints. Signed values are facts: callers must not clamp them to zero.
 */
export type TransactionLinkedContributions = {
  transactionId: number;
  transactionAmount: number;
  linkedTotal: number;
  remainingCapacity: number;
  account: LinkedContributionAccount;
  linkedContributions: TransactionLinkedContribution[];
};
