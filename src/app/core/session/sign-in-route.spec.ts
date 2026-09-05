import {
  reasonMessage,
  reasonQueryParams,
  safeReturnUrl,
  signInRedirect,
} from './sign-in-route';

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

  it('adds the reason marker when asked', () => {
    expect(
      signInRedirect('/app/accounts/42', { reason: 'session-expired' })
    ).toEqual([
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

describe('reasonQueryParams', () => {
  it('mints the exact param signInRedirect adds', () => {
    expect(reasonQueryParams('email-confirmed')).toEqual({
      reason: 'email-confirmed',
    });
  });
});

describe('reasonMessage', () => {
  it('gives the session-expired wording for its exact marker', () => {
    const [, { queryParams }] = signInRedirect('/x', {
      reason: 'session-expired',
    });
    expect(reasonMessage(queryParams?.['reason'] as string)).toBe(
      'Your session has ended. Please sign in again.'
    );
  });

  it('gives the email-confirmed wording for its exact marker', () => {
    expect(reasonMessage('email-confirmed')).toBe(
      'Your email is confirmed. Sign in to continue.'
    );
  });

  it('yields nothing for anything else, including every flavour of absent', () => {
    expect(reasonMessage(null)).toBeNull();
    expect(reasonMessage(undefined)).toBeNull();
    expect(reasonMessage('')).toBeNull();
    expect(reasonMessage('expired')).toBeNull();
    expect(reasonMessage('session-expired ')).toBeNull();
  });
});
