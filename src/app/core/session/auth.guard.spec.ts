import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { authGuard } from './auth.guard';
import { Session } from './session';

describe('authGuard', () => {
  function run(authenticated: boolean, url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Session, useValue: { isAuthenticated: () => authenticated } },
      ],
    });

    return TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)
    );
  }

  it('lets an authenticated visitor through', () => {
    expect(run(true, '/app/accounts')).toBe(true);
  });

  it('redirects an unauthenticated visitor to sign-in, preserving the target as returnUrl', () => {
    const result = run(false, '/app/accounts/42');

    expect(result).toBeInstanceOf(UrlTree);
    const tree = result as UrlTree;
    expect(tree.toString()).toContain('/auth/sign-in');
    expect(tree.queryParams['returnUrl']).toBe('/app/accounts/42');
  });
});
