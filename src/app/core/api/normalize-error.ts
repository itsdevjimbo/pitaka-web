import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from './api-error';

const VALIDATION_MESSAGE = 'Please correct the highlighted fields and try again.';

/**
 * The line shown when a session has lapsed: the message for a 401 here, and the
 * same words `AuthSignIn` shows as an information notice after `Session.expire`
 * bounces someone to sign-in. Exported so the sentence lives in one place
 * rather than being written twice.
 */
export const SESSION_ENDED_MESSAGE =
  'Your session has ended. Please sign in again.';

/**
 * One honest "not found" for both 404 and 403, so the app never leaks whether
 * another person's record exists (story 51). A 403's own `detail` would confirm
 * the row is real — precisely what must not reach the screen — so this wording
 * stands in for both.
 */
const NOT_FOUND_MESSAGE =
  "We couldn't find that. It may have been deleted, or it may not be yours.";

const CONNECTIVITY_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

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
 * A transport failure — no response at all, `status` 0 — is not one of the four
 * but reaches here the same way, and gets its own message rather than a
 * status-derived one built from a status that never came back.
 *
 * 404 and 403 are pulled out ahead of those branches and collapsed to one
 * not-found message, so the app never leaks whether another person's record
 * exists and a 403's `detail` never reaches the screen.
 *
 * No branch ever surfaces the server's own text: a body we did not write can be
 * a stack trace or a raw internal string, which the spec rules out of the UI.
 * Where such a body arrives it is logged with its endpoint, the same treatment
 * the bodyless 400 gets, so it stays diagnosable without being displayed.
 */
export function normalizeHttpError(response: HttpErrorResponse): ApiError {
  const { status } = response;

  // Transport failure: the request never reached the server, so there is no
  // status to derive a message from.
  if (status === 0) {
    return new ApiError(CONNECTIVITY_MESSAGE, 0);
  }

  const body = unwrapBody(response.error);

  // 404 / 403: collapsed to one not-found message, ahead of every branch that
  // would surface the server's own text. A 403 ProblemDetails `detail` is the
  // sentence the spec rules out — it confirms the row exists — so the server's
  // wording must not win here. The body is still logged, the same treatment the
  // bodyless 400 and the bare-string login body get, so it stays diagnosable.
  if (status === 404 || status === 403) {
    if (body !== null && body !== undefined && body !== '') {
      logServerText(
        response.url,
        typeof body === 'string' ? body : JSON.stringify(body)
      );
    }
    return new ApiError(NOT_FOUND_MESSAGE, status);
  }

  // A bare JSON string: the failed-login body. The text is the server's own and
  // never reaches the person — `AuthService` supplies the wording for the one
  // case that has any, and everything else is status-derived.
  if (typeof body === 'string') {
    logServerText(response.url, body);
    return new ApiError(fallbackMessage(status), status);
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

/** Keep an undisplayable server body diagnosable without putting it on screen. */
function logServerText(url: string | null, text: string): void {
  console.warn(
    `[api] undisplayable body from ${url ?? 'unknown endpoint'}: ${text}`
  );
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
    return SESSION_ENDED_MESSAGE;
  }
  if (status >= 500) {
    return 'Something went wrong on the server. Please try again.';
  }
  return `The request failed (${status}). Please try again.`;
}
