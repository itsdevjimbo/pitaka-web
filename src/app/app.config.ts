import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { errorInterceptor, provideApiBaseUrl } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons/provider';
import { authInterceptor, provideSession } from '@/app/core/session';
import { BRAND_ACCENT, provideTheming } from '@/app/core/theming';
import { environment } from '@/environments/environment';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Order matters: on the way back, `errorInterceptor` runs innermost and
    // normalises every failure to an `ApiError` first, so `authInterceptor` can
    // recognise a 401 as a lapsed session. Swapping them disables that.
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    provideApiBaseUrl(environment.apiBaseUrl),
    provideSession(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })
    ),

    // Material
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: {
        subscriptSizing: 'dynamic',
      },
    },
    provideNativeDateAdapter(),
    provideDialogDefaults(),

    // Core
    provideIcons(),
    provideTheming({
      scheme: 'system',
      // The one brand choice (ADR 0008). `error` is not a brand colour — it is
      // just red — so it stays a literal here rather than a named token.
      primary: BRAND_ACCENT,
      error: '#dc2626',
    }),
  ],
};
