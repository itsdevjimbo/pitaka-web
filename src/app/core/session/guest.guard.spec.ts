import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { guestGuard } from './guest.guard';
import { Session } from './session';

describe('guestGuard', () => {
  function run(authenticated: boolean, url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Session, useValue: { isAuthenticated: () => authenticated } },
      ],
    });

    return TestBed.runInInjectionContext(() =>
      guestGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)
    );
  }

  it('lets a signed-out visitor reach the auth area', () => {
    expect(run(false, '/auth/sign-in')).toBe(true);
  });

  it('sends a signed-in visitor into the app instead of showing sign-in', () => {
    const result = run(true, '/auth/sign-in');

    expect(result).toBeInstanceOf(UrlTree);
    expect((result as UrlTree).toString()).toBe('/app');
  });

  it('sends a signed-in visitor away from registration too', () => {
    const result = run(true, '/auth/sign-up');

    expect(result).toBeInstanceOf(UrlTree);
    expect((result as UrlTree).toString()).toBe('/app');
  });
});
