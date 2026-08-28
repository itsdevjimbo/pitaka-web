import { HttpErrorResponse } from '@angular/common/http';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { ApiError } from './api-error';
import { normalizeHttpError } from './normalize-error';

/**
 * Sign-in meets two of the API's four failure shapes (ADR 0002): a bare JSON
 * string on failed login, and a ValidationProblemDetails `errors` map with
 * PascalCase keys. Both must collapse to a single `ApiError`; anything else
 * falls through to a generic, status-derived message. The other two shapes are
 * normalised when a screen that hits them is built.
 */
describe('normalizeHttpError', () => {
  const response = (init: {
    status?: number;
    statusText?: string;
    url?: string;
    error?: unknown;
  }): HttpErrorResponse =>
    new HttpErrorResponse({
      url: `${BASE_URL}/api/auth/login`,
      status: 400,
      statusText: 'Bad Request',
      ...init,
    });

  it('turns a ValidationProblemDetails body into field errors with camelCased keys', () => {
    const error = normalizeHttpError(
      response({
        status: 400,
        error: {
          title: 'One or more validation errors occurred.',
          status: 400,
          errors: {
            Email: ['The Email field is required.'],
            Password: ['The Password must be at least 8 characters.'],
          },
        },
      })
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.fieldErrors).toEqual({
      email: ['The Email field is required.'],
      password: ['The Password must be at least 8 characters.'],
    });
    // The friendly form-level message wins over the server's raw `title`.
    expect(error.message).toBe(
      'Please correct the highlighted fields and try again.'
    );
  });

  it('strips a leading JSON path segment from validation keys', () => {
    const error = normalizeHttpError(
      response({
        status: 400,
        error: { errors: { '$.email': ['Invalid.'] } },
      })
    );

    expect(error.fieldErrors).toEqual({ email: ['Invalid.'] });
  });

  it('turns the bare-string login failure into an ApiError carrying that message', () => {
    const error = normalizeHttpError(
      response({ status: 401, error: 'Invalid email or password.' })
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Invalid email or password.');
    expect(error.status).toBe(401);
    expect(error.fieldErrors).toEqual({});
  });

  it('unwraps a bare string that arrived through Angular parse-failure wrapping', () => {
    const error = normalizeHttpError(
      response({
        status: 401,
        error: { error: new SyntaxError('Unexpected token'), text: 'Invalid email or password.' },
      })
    );

    expect(error.message).toBe('Invalid email or password.');
  });

  it('does not surface a raw JSON blob as the message', () => {
    const error = normalizeHttpError(
      response({ status: 500, error: '{"stack":"boom"}' })
    );

    expect(error.message).not.toContain('stack');
    expect(error.message).not.toContain('{');
  });
});
