import { Route } from '@angular/router';
import { authGuard, guestGuard } from '@/app/core/session';

export const routes: Route[] = [
  // Auth
  {
    path: 'auth',
    canActivate: [guestGuard],
    loadChildren: () => import('./domains/auth/routes'),
  },

  // App
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'app',
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadChildren: () => import('./domains/app/routes'),
  },

  // Fallback
  {
    path: '**',
    redirectTo: '',
  },
];
