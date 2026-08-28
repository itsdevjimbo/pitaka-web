/**
 * Production configuration. Substituted for `environment.ts` at build time by
 * the `fileReplacements` entry in `angular.json` (build > production).
 */
export const environment = {
  production: true,
  // TODO: point at the deployed Pitaka API origin. The API is a separate
  // deployment from this client (see `API_BASE_URL`), so this must be the
  // absolute cross-origin URL, not a same-origin path.
  apiBaseUrl: 'https://api.pitaka.example',
};
