import { safeReturnUrl } from './routes';

describe('safeReturnUrl', () => {
  it('keeps an in-app path', () => {
    expect(safeReturnUrl('/app/accounts/42')).toBe('/app/accounts/42');
  });

  it('rejects a missing value', () => {
    expect(safeReturnUrl(null)).toBeNull();
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
