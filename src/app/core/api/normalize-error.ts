import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from './api-error';

const VALIDATION_MESSAGE = 'Please correct the highlighted fields and try again.';

const BODYLESS_MESSAGE =
  'The request was rejected. A value may be missing, out of range, or in the ' +
  'wrong format, or it may point to a record that no longer exists. Review ' +
  'what you entered and try again.';

/**
 * Collapses any {@link HttpErrorResponse} into a single {@link ApiError}.
 *
 * Knowing the four failure shapes the Pitaka API can return is this client's
 * defining job (ADR 0002), so all four get a branch here: a bare JSON string on
 * failed login, a ValidationProblemDetails `errors` map with PascalCase keys, a
 * ProblemDetails carrying a human-readable `detail`, and a bodyless 400.
 * Anything else falls through to a generic, status-derived message.
 */
export function normalizeHttpError(response: HttpErrorResponse): ApiError {
  const { status } = response;
  const body = unwrapBody(response.error);

  // A bare JSON string: the failed-login body.
  if (typeof body === 'string') {
    const text = body.trim();
    const usable = text.length > 0 && !text.startsWith('{') && !text.startsWith('[');
    return new ApiError(usable ? text : fallbackMessage(status), status);
  }

  // ValidationProblemDetails: a PascalCase `errors` map. The server's own
  // `title` ("One or more validation errors occurred.") is exactly the raw
  // string the spec rules out, so the form-level message is always ours; the
  // per-field messages carry the specifics.
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (record['errors'] && typeof record['errors'] === 'object') {
      const fieldErrors = camelCaseFieldErrors(
        record['errors'] as Record<string, unknown>
      );
      return new ApiError(VALIDATION_MESSAGE, status, fieldErrors);
    }

    // ProblemDetails: a human-readable `detail` specific to this occurrence.
    if (typeof record['detail'] === 'string' && record['detail'].length > 0) {
      return new ApiError(record['detail'], status);
    }
  }

  // A bodyless 400 (ten call sites in the API, ADR 0002). Never attributed to a
  // field — a wrong red outline is worse than none; logged with its endpoint so
  // it can be justified as a server-side fix later.
  if (status === 400) {
    console.warn(
      `[api] bodyless 400 from ${response.url ?? 'unknown endpoint'}`
    );
    return new ApiError(BODYLESS_MESSAGE, status);
  }

  return new ApiError(fallbackMessage(status), status);
}

/**
 * Angular wraps a response whose body failed to parse as JSON in
 * `{ error: SyntaxError, text: string }`. Recover the raw text when it does.
 */
function unwrapBody(error: unknown): unknown {
  if (
    error &&
    typeof error === 'object' &&
    'error' in error &&
    'text' in error
  ) {
    const wrapper = error as { error: unknown; text: unknown };
    if (wrapper.error instanceof Error && typeof wrapper.text === 'string') {
      return wrapper.text;
    }
  }
  return error;
}

function camelCaseFieldErrors(
  errors: Record<string, unknown>
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(errors)) {
    const messages = Array.isArray(value)
      ? value.map(String)
      : [String(value)];
    result[camelCaseKey(key)] = messages;
  }
  return result;
}

/**
 * `Email` -> `email`, `$.email` -> `email`. Validation keys arrive PascalCase
 * because they come from `nameof(...)`, while every payload field is camelCase.
 */
function camelCaseKey(key: string): string {
  const stripped = key.replace(/^\$\.?/, '');
  if (stripped.length === 0) {
    return stripped;
  }
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

function fallbackMessage(status: number): string {
  if (status === 401) {
    return 'Your session has ended. Please sign in again.';
  }
  if (status >= 500) {
    return 'Something went wrong on the server. Please try again.';
  }
  return `The request failed (${status}). Please try again.`;
}
