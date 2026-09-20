/** An earmark of money in an Account toward a Goal (see `CONTEXT.md`). */
export type GoalContribution = {
  id: number;
  goalId: number;
  accountId: number;
  transactionId: number | null;
  amount: number;
  contributionDate: Date;
  note: string | null;
};

/** The fields needed to add an earmark to a Goal. */
export type NewGoalContribution = {
  goalId: number;
  accountId: number;
  transactionId: number | null;
  amount: number;
  contributionDate: Date;
  note: string | null;
};

/** The one Contribution field the API permits a person to correct. */
export type UpdateGoalContribution = {
  note: string | null;
};
