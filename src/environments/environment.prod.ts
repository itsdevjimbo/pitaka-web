/**
 * Production configuration. Substituted for `environment.ts` at build time by
 * the `fileReplacements` entry in `angular.json` (build > production).
 */
export const environment = {
  production: true,
  // Production requests stay same-origin; the serving layer forwards /api.
  apiBaseUrl: '',
};
