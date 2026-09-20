/** A standing instruction that generates income or expense Transactions. */
export type Schedule = {
  id: number;
  accountId: number;
  categoryId: number | null;
  name: string;
  direction: ScheduleDirection;
  amount: number;
  description: string | null;
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

/** The fields supplied when creating an income or expense Schedule. */
export type NewSchedule = {
  accountId: number;
  categoryId: number;
  name: string;
  direction: ScheduleDirection;
  amount: number;
  description: string | null;
  frequency: ScheduleFrequency;
  firstGeneration: Date;
  lastGeneration: Date | null;
};

/** The details that may change without replacing a Schedule's identity or Frequency. */
export type ScheduleUpdate = {
  name: string;
  amount: number;
  categoryId: number | null;
  description: string | null;
  lastGeneration: Date | null;
};

export const SCHEDULE_NAME_MAX = 255;
export const SCHEDULE_AMOUNT_MIN = 0.01;
export const SCHEDULE_AMOUNT_MAX = 999_999_999_999.99;

export const SCHEDULE_FREQUENCIES: Record<ScheduleFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};
