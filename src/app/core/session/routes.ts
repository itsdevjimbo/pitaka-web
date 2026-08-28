/**
 * The route an unauthenticated visitor — or one whose session has lapsed — is
 * sent to. Kept in one place so the guard, the interceptor, and the Session
 * service agree if the auth area ever moves.
 */
export const SIGN_IN_ROUTE = '/auth/sign-in';
