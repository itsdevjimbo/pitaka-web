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
import { provideIcons } from '@/app/core/icons/provider';
import { authInterceptor, provideSession } from '@/app/core/session';
import { provideTheming } from '@/app/core/theming';
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

    // Core
    provideIcons(),
    provideTheming({
      scheme: 'system',
      primary: '#1565C0',
      error: '#dc2626',
    }),
  ],
};
