import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Profile } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { Theming } from '@/app/core/theming';
import { User } from './user';

/** The slice of the component the tests reach into. */
type UserInternals = {
  signOut(): void;
};

describe('User', () => {
  const ada: Profile = { id: 7, name: 'Ada Lovelace', email: 'ada@example.com' };

  function setup(profile: Profile | null = ada) {
    const signOut = vi.fn();

    TestBed.configureTestingModule({
      imports: [User],
      providers: [
        provideRouter([]),
        provideIcons(),
        { provide: Session, useValue: { profile: signal(profile), signOut } },
        { provide: Theming, useValue: { scheme: signal('system') } },
      ],
    });

    const fixture = TestBed.createComponent(User);
    fixture.detectChanges();

    return {
      fixture,
      cmp: fixture.componentInstance as unknown as UserInternals,
      signOut,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    };
  }

  it('shows the signed-in name and email from the session, not a placeholder', () => {
    const { text } = setup();

    expect(text()).toContain('Ada Lovelace');
    expect(text()).toContain('ada@example.com');
  });

  it('signs out through the session rather than just linking to sign-in', () => {
    const { cmp, signOut } = setup();

    cmp.signOut();

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
