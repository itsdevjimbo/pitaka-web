// The Accounts domain's interface to the rest of the app: the vocabulary
// (types, constants, error classes) and the API adapter. The routed screens are
// not re-exported here — they are lazy-loaded by path from `routes.ts`, and a
// barrel export would defeat their code-splitting.
export { ACCOUNT_NAME_MAX, ACCOUNT_TYPES } from './data/account';
export type { Account, AccountType, NewAccount } from './data/account';
export {
  AccountDeleteBlockedError,
  AccountModifiedError,
} from './data/account-errors';
export type { DeleteBlockReason } from './data/account-errors';
export { AccountsService } from './data/accounts.service';
