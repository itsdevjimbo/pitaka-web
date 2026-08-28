import { InjectionToken, ValueProvider } from '@angular/core';

/**
 * Absolute origin of the Pitaka API, e.g. `http://localhost:5044`. The API is a
 * separate deployment from this client, so every request is cross-origin and
 * every URL is built from this token rather than assumed same-origin.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');

export const provideApiBaseUrl = (url: string): ValueProvider => ({
  provide: API_BASE_URL,
  useValue: url.replace(/\/$/, ''),
});
