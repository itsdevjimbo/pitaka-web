import {
  maxLength,
  minLength,
  PathKind,
  required,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';

/** The API's password bounds (`pitaka` RegisterRequest/ResetPasswordRequest: 8–128, length only). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/**
 * The password validators and their wording, in one place so sign-up and
 * reset-password cannot state one bound and enforce another (issue #71). No
 * complexity check — the API deliberately has none.
 */
export function passwordRules<TPathKind extends PathKind = PathKind.Root>(
  field: SchemaPath<string, SchemaPathRules.Supported, TPathKind>
): void {
  required(field, { message: 'You must enter a password' });
  minLength(field, PASSWORD_MIN, {
    message: `Your password must be at least ${PASSWORD_MIN} characters`,
  });
  maxLength(field, PASSWORD_MAX, {
    message: `Your password must be ${PASSWORD_MAX} characters or fewer`,
  });
}
