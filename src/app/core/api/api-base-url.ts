import { InjectionToken, ValueProvider } from '@angular/core';

/**
 * Base URL for the Pitaka API. It can be an absolute origin in development or
 * an empty string when production requests use the same-origin `/api` path.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');

export const provideApiBaseUrl = (url: string): ValueProvider => ({
  provide: API_BASE_URL,
  useValue: url.replace(/\/$/, ''),
});
