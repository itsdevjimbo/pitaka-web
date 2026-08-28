import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from './api-error';

const VALIDATION_MESSAGE = 'Please correct the highlighted fields and try again.';

/**
 * Collapses any {@link HttpErrorResponse} into a single {@link ApiError}.
 *
 * Sign-in is the only screen wired to the API so far, and it meets exactly two
 * of the API's four failure shapes (ADR 0002): a failed login returns a bare
 * JSON string, and validation failures return a PascalCase `errors` map. Those
 * two are handled here; everything else collapses to a generic, status-derived
 * message. The remaining shapes get their branches when a screen actually hits
 * them.
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
