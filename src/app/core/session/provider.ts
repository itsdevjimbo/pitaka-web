import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { Session } from './session';

/**
 * Verifies a stored token against the server before the app renders, so the
 * person is never shown a shell that then fails on every request behind it
 * (ADR 0004).
 */
export const provideSession = (): EnvironmentProviders =>
  makeEnvironmentProviders([
    provideAppInitializer(() => inject(Session).verifyBoot()),
  ]);
