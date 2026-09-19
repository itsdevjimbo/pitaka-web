/** A standing instruction that generates income or expense Transactions. */
export type Schedule = {
  id: number;
  accountId: number;
  categoryId: number | null;
  name: string;
  direction: ScheduleDirection;
  amount: number;
  frequency: ScheduleFrequency;
  firstGeneration: Date;
  lastGeneration: Date | null;
  nextGeneration: Date;
  status: ScheduleStatus;

  /** Surviving generated Transactions; independent of whether deletion is allowed. */
  generatedTransactionCount: number;
  /** Whether this Schedule has never generated a Transaction and may be deleted. */
  canDelete: boolean;
};

export type ScheduleDirection = 'income' | 'expense';
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * `cancelled` is the API's existing reversible state. It remains distinct from
 * Completed and appears in Past until lifecycle actions arrive.
 */
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export const SCHEDULE_FREQUENCIES: Record<ScheduleFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};
