/**
 * Build-time configuration. This is the development default; the production
 * build swaps in `environment.prod.ts` via the `fileReplacements` entry in
 * `angular.json`.
 */
export const environment = {
  production: false,
  /** API origin in development; production uses a same-origin `/api` path. */
  apiBaseUrl: 'http://pitaka.localhost',
};
