import { convertToParamMap } from '@angular/router';
import { criteriaFromQueryParams, criteriaToQueryParams, sameCriteria } from './account-criteria-params';

describe('Account criteria URL parameters', () => {
  it('omits the default active, all-types view', () => {
    expect(criteriaToQueryParams({ isActive: true })).toEqual({});
  });

  it('uses lowercase person-facing values for the non-default filters', () => {
    expect(criteriaToQueryParams({ isActive: false, type: 'Investment' })).toEqual({
      status: 'retired',
      type: 'investment',
    });
    expect(criteriaToQueryParams({ type: 'Cash' })).toEqual({
      status: 'all',
      type: 'cash',
    });
  });

  it('defaults unknown values safely while preserving a valid other axis', () => {
    expect(criteriaFromQueryParams(convertToParamMap({ status: 'gone', type: 'bank' }))).toEqual({
      isActive: true,
      type: 'Bank',
    });
  });

  it('round-trips the all lifecycle selection separately from active', () => {
    expect(criteriaFromQueryParams(convertToParamMap({ status: 'all' }))).toEqual({});
    expect(sameCriteria({}, { isActive: true })).toBe(false);
  });
});
