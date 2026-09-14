import { ParamMap } from '@angular/router';
import { AccountCriteria, AccountType, ACCOUNT_TYPES } from './account';

/** The person's URL vocabulary for the Accounts list (#174). */
const STATUS_PARAM = 'status';
const TYPE_PARAM = 'type';

/**
 * Converts Account criteria to their readable URL form. Active and all types
 * are the default view, so their keys are deliberately absent from a link.
 */
export function criteriaToQueryParams(
  criteria: AccountCriteria
): Record<string, string> {
  const params: Record<string, string> = {};
  if (criteria.isActive === false) {
    params[STATUS_PARAM] = 'retired';
  } else if (criteria.isActive === undefined) {
    params[STATUS_PARAM] = 'all';
  }
  if (criteria.type !== undefined && isAccountType(criteria.type)) {
    params[TYPE_PARAM] = criteria.type.toLowerCase();
  }
  return params;
}

/**
 * Reads a URL totally. Unknown values widen to the default on just that axis,
 * so a hand-edited link can never produce an API-invalid enum value.
 */
export function criteriaFromQueryParams(params: ParamMap): AccountCriteria {
  const criteria: AccountCriteria = { isActive: true };
  const status = params.get(STATUS_PARAM);
  if (status === 'retired') {
    criteria.isActive = false;
  } else if (status === 'all') {
    delete criteria.isActive;
  }

  const type = params.get(TYPE_PARAM);
  const accountType = accountTypeFromUrl(type);
  if (accountType !== null) {
    criteria.type = accountType;
  }
  return criteria;
}

/** Compare only the criteria the URL and API can observe. */
export function sameCriteria(a: AccountCriteria, b: AccountCriteria): boolean {
  const left = criteriaToQueryParams(a);
  const right = criteriaToQueryParams(b);
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}

function accountTypeFromUrl(value: string | null): AccountType | null {
  if (value === null) {
    return null;
  }
  const match = Object.keys(ACCOUNT_TYPES).find(
    (type) => type.toLowerCase() === value
  );
  return match === undefined ? null : (match as AccountType);
}

function isAccountType(value: string): value is AccountType {
  return Object.prototype.hasOwnProperty.call(ACCOUNT_TYPES, value);
}
