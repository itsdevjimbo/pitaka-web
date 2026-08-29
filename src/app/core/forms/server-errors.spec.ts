import { ApiError } from '@/app/core/api';
import { partitionServerError } from './server-errors';

/**
 * A stand-in for a signals `FieldTree` — `partitionServerError` only ever passes
 * these straight back through in `fieldTree`, so identity is all that matters.
 */
function fakeControl(name: string) {
  return { _control: name } as never;
}

describe('partitionServerError', () => {
  const FALLBACK = 'Something went wrong. Please try again.';

  it('sends a non-ApiError throw to the banner via the fallback', () => {
    const result = partitionServerError(new Error('offline'), {}, FALLBACK);

    expect(result.boundErrors).toEqual([]);
    expect(result.bannerMessage).toBe(FALLBACK);
  });

  it('binds a blamed field onto its control and leaves the banner clear', () => {
    const email = fakeControl('email');

    const result = partitionServerError(
      new ApiError('Please correct the highlighted fields and try again.', 400, {
        email: ['That email is not registered.'],
      }),
      { email },
      FALLBACK
    );

    expect(result.boundErrors).toEqual([
      {
        fieldTree: email,
        kind: 'server',
        message: 'That email is not registered.',
      },
    ]);
    expect(result.bannerMessage).toBeNull();
  });

  it('surfaces a blamed field with no control on the banner instead', () => {
    const result = partitionServerError(
      new ApiError('Please correct the highlighted fields and try again.', 400, {
        tenantCode: ['That workspace is not accepting sign-ins.'],
      }),
      { email: fakeControl('email') },
      FALLBACK
    );

    expect(result.boundErrors).toEqual([]);
    expect(result.bannerMessage).toBe(
      'That workspace is not accepting sign-ins.'
    );
  });

  it('keeps bound field errors even when an unattributed message also present', () => {
    const password = fakeControl('password');

    const result = partitionServerError(
      new ApiError('Please correct the highlighted fields and try again.', 400, {
        password: ['Too short.'],
        tenantCode: ['Unknown workspace.'],
      }),
      { password },
      FALLBACK
    );

    expect(result.boundErrors).toEqual([
      { fieldTree: password, kind: 'server', message: 'Too short.' },
    ]);
    expect(result.bannerMessage).toBe('Unknown workspace.');
  });

  it('puts a field-less ApiError message straight on the banner', () => {
    const result = partitionServerError(
      new ApiError(
        'That email and password do not match. Please try again.',
        401
      ),
      { email: fakeControl('email'), password: fakeControl('password') },
      FALLBACK
    );

    expect(result.boundErrors).toEqual([]);
    expect(result.bannerMessage).toBe(
      'That email and password do not match. Please try again.'
    );
  });
});
