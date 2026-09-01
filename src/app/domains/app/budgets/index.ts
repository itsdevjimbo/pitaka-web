// The Budgets domain's interface to the rest of the app: the vocabulary (types,
// constants) and the API adapter. The routed screen is not re-exported — it is
// lazy-loaded by path from `routes.ts`, and a barrel export would defeat its
// code-splitting (the same call `accounts/index.ts` makes). The calendar
// helpers stay domain-internal — nothing above `budgets/` needs them, the way
// `accounts/index.ts` keeps `offset-timestamp` out of its barrel.
export { BUDGET_AMOUNT_MIN, BUDGET_NAME_MAX, PERIODS } from './data/budget';
export type { Budget, NewBudget, Period } from './data/budget';
export { BudgetsService } from './data/budgets.service';
