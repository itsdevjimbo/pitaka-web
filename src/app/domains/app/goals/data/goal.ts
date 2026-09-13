/** A savings target the person accumulates toward over time (see `CONTEXT.md`). */
export type Goal = {
  id: number;
  name: string;
  targetAmount: number;
  targetDate: Date | null;
  status: GoalStatus;
  currentAmount: number;
};

/** The deliberate lifecycle states a Goal may carry. */
export type GoalStatus = 'Active' | 'Completed' | 'Abandoned';

/** The fields supplied when a person starts a Goal. */
export type NewGoal = {
  name: string;
  targetAmount: number;
  targetDate: Date | null;
};

/** The mutable Goal fields sent as a complete replacement on edit. */
export type UpdateGoal = NewGoal;

/** The longest Goal name the API accepts. */
export const GOAL_NAME_MAX = 255;

/** The smallest positive target or Contribution amount the API accepts. */
export const GOAL_AMOUNT_MIN = 0.01;

/** The largest target or Contribution amount the API accepts. */
export const GOAL_AMOUNT_MAX = 999_999_999_999.99;
