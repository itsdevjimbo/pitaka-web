/**
 * The single error type every failed API call is collapsed into.
 *
 * The Pitaka API returns four distinct failure shapes (ADR 0002). Nothing above
 * the HTTP adapter should ever have to tell them apart: it sees an `ApiError`
 * with a human-readable `message` and, when the server blamed specific fields, a
 * `fieldErrors` map whose keys are camelCased to match form controls.
 */
export class ApiError extends Error {
  /** Field name (camelCase) to the messages the server attached to it. */
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;

  /** The HTTP status that produced this error, or `0` for a transport failure. */
  readonly status: number;

  constructor(
    message: string,
    status: number,
    fieldErrors: Record<string, readonly string[]> = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  /** Whether the server attributed the failure to one or more named fields. */
  get hasFieldErrors(): boolean {
    return Object.keys(this.fieldErrors).length > 0;
  }
}
