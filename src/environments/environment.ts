/**
 * Build-time configuration. This is the development default; the production
 * build swaps in `environment.prod.ts` via the `fileReplacements` entry in
 * `angular.json`.
 */
export const environment = {
  production: false,
  /** Absolute origin of the Pitaka API — bound to the `API_BASE_URL` token. */
  apiBaseUrl: 'http://pitaka.localhost',
};
