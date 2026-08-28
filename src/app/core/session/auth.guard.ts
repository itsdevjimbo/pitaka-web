import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Session } from './session';
import { signInRedirect } from './sign-in-route';

/**
 * Gate for the authenticated area. An unauthenticated visit is redirected to
 * sign-in with the attempted URL preserved as `returnUrl`, so the person lands
 * where they were headed once they sign in.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(Session);
  const router = inject(Router);

  if (session.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(...signInRedirect(state.url));
};
