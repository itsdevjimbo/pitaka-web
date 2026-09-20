// The Goals domain's interface to the rest of the app: vocabulary, its two
// resource adapters, and the fresh pooled-earmark projection used by Add.
export { GOAL_AMOUNT_MAX, GOAL_AMOUNT_MIN, GOAL_NAME_MAX } from './data/goal';
export type { Goal, GoalStatus, NewGoal, UpdateGoal } from './data/goal';
export type { GoalContribution, NewGoalContribution, UpdateGoalContribution } from './data/goal-contribution';
export { GoalsService } from './data/goals.service';
export { GoalContributionsService } from './data/goal-contributions.service';
export { toGoalDateOnly } from './data/goal-calendar';
export { ContributionDeletionCoordinator } from './data/contribution-deletion';
export type { ContributionDeletionResult } from './data/contribution-deletion';
export { accountHeadroom, signedAccountHeadroom } from './data/account-headroom';
export type { AccountHeadroom } from './data/account-headroom';
export { withAccountNames } from './data/contribution-account-name';
export type { GoalContributionSource, GoalContributionWithAccountName } from './data/contribution-account-name';
