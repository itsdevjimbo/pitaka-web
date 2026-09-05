import { Routes } from '@angular/router';
import { guestGuard } from '@/app/core/session';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout'),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'sign-in',
      },
      {
        path: 'sign-in',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/sign-in/sign-in'),
      },
      {
        path: 'sign-up',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/sign-up/sign-up'),
      },
      {
        // Asking for a reset link is a guest action — a live session makes it
        // meaningless — so it sits behind `guestGuard` with sign-in and
        // sign-up, unlike the two link-landing screens below (ADR 0015).
        path: 'forgot-password',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/forgot-password/forgot-password'),
      },
      {
        // Confirming is an operation on a Profile reached by link, not a guest
        // action a live session makes meaningless — `guestGuard` here would
        // silently destroy the token the person came to spend (ADR 0015).
        path: 'confirm-email',
        loadComponent: () =>
          import('./features/confirm-email/confirm-email'),
      },
    ],
  },
];

export default routes;
