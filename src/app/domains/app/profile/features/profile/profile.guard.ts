import { type CanDeactivateFn } from '@angular/router';
import { type Observable } from 'rxjs';

type ProfileRouteComponent = {
  canDeactivate: () => boolean | Observable<boolean>;
};

/** Applies the Profile page's inline-editor safeguards before route changes. */
export const profileCanDeactivateGuard: CanDeactivateFn<ProfileRouteComponent> = (component) =>
  component.canDeactivate();
