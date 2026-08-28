import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Session } from './session';
import { APP_HOME_ROUTE } from './sign-in-route';

/**
 * Gate for the auth area (sign-in, registration). A person who already has a
 * verified session has no business on these screens, so they are sent into the
 * app instead of being shown a sign-in form they would only bounce off.
 */
export const guestGuard: CanActivateFn = () => {
  const session = inject(Session);
  const router = inject(Router);

  if (!session.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree([APP_HOME_ROUTE]);
};
