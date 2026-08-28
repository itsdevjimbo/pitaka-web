import { Route } from '@angular/router';
import { authGuard } from '@/app/core/session';

export const routes: Route[] = [
  // Auth
  {
    path: 'auth',
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
