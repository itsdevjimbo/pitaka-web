import { isSessionLapse, safeReturnUrl, signInRedirect } from './sign-in-route';

describe('safeReturnUrl', () => {
  it('keeps an in-app path', () => {
    expect(safeReturnUrl('/app/accounts/42')).toBe('/app/accounts/42');
  });

  it('rejects every flavour of absent', () => {
    expect(safeReturnUrl(null)).toBeNull();
    expect(safeReturnUrl(undefined)).toBeNull();
    expect(safeReturnUrl('')).toBeNull();
  });

  it('rejects a protocol-relative URL', () => {
    expect(safeReturnUrl('//evil.example')).toBeNull();
  });

  it('rejects an absolute URL', () => {
    expect(safeReturnUrl('https://evil.example/app')).toBeNull();
  });

  it('rejects a value not rooted at /', () => {
    expect(safeReturnUrl('app/accounts')).toBeNull();
  });
});

describe('signInRedirect', () => {
  it('carries just the return URL by default', () => {
    expect(signInRedirect('/app/accounts/42')).toEqual([
      ['/auth/sign-in'],
      { queryParams: { returnUrl: '/app/accounts/42' } },
    ]);
  });

  it('adds the lapse marker when asked', () => {
    expect(signInRedirect('/app/accounts/42', { lapsed: true })).toEqual([
      ['/auth/sign-in'],
      {
        queryParams: {
          returnUrl: '/app/accounts/42',
          reason: 'session-expired',
        },
      },
    ]);
  });
});

describe('isSessionLapse', () => {
  it('accepts the exact marker signInRedirect mints', () => {
    const [, { queryParams }] = signInRedirect('/x', { lapsed: true });
    expect(isSessionLapse(queryParams?.['reason'] as string)).toBe(true);
  });

  it('rejects anything else, including every flavour of absent', () => {
    expect(isSessionLapse(null)).toBe(false);
    expect(isSessionLapse(undefined)).toBe(false);
    expect(isSessionLapse('')).toBe(false);
    expect(isSessionLapse('expired')).toBe(false);
    expect(isSessionLapse('session-expired ')).toBe(false);
  });
});
