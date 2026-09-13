import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, Profile } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { ProfileIdentity } from './profile-identity';

type ProfileInternals = {
  editingName: WritableSignal<boolean>;
  nameModel: WritableSignal<{ name: string }>;
  nameForm: { name: FieldTree<string> };
  hasChangedName: () => boolean;
  successMessage: WritableSignal<string | null>;
  errorMessage: WritableSignal<string | null>;
  beginNameEdit(): void;
  saveName(event: Event): void;
};

const ADA: Profile = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  pendingEmail: null,
};

describe('ProfileIdentity', () => {
  function setup(updateProfile: AuthService['updateProfile'] = () => of(ADA)) {
    const profile = signal<Profile | null>(ADA);
    const applyProfileUpdate = vi.fn((updated: Profile) =>
      profile.set(updated)
    );

    TestBed.configureTestingModule({
      imports: [ProfileIdentity],
      providers: [
        provideIcons(),
        { provide: AuthService, useValue: { updateProfile } },
        { provide: Session, useValue: { profile, applyProfileUpdate } },
      ],
    });

    const fixture = TestBed.createComponent(ProfileIdentity);
    const cmp = fixture.componentInstance as unknown as ProfileInternals;
    fixture.detectChanges();
    return { fixture, cmp, applyProfileUpdate };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: ProfileInternals
  ) {
    cmp.saveName(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
  }

  it('opens a focused inline editor seeded with the signed-in name', async () => {
    const { fixture, cmp } = setup();

    cmp.beginNameEdit();
    fixture.detectChanges();
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector(
      '#profile-name'
    ) as HTMLInputElement | null;
    expect(cmp.nameModel().name).toBe('Ada Lovelace');
    expect(input?.value).toBe('Ada Lovelace');
    expect(document.activeElement).toBe(input);
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe('Ada Lovelace'.length);
  });

  it('requires a trimmed name of at most 255 characters before saving', async () => {
    const updateProfile = vi.fn();
    const { fixture, cmp } = setup(
      updateProfile as unknown as AuthService['updateProfile']
    );

    cmp.beginNameEdit();
    cmp.nameModel.set({ name: '   ' });
    await submitAndSettle(fixture, cmp);

    expect(
      cmp.nameForm
        .name()
        .errors()
        .map((error) => error.message)
    ).toContain('Enter a name');
    expect(updateProfile).not.toHaveBeenCalled();

    cmp.nameModel.set({ name: 'x'.repeat(256) });
    await submitAndSettle(fixture, cmp);

    expect(
      cmp.nameForm
        .name()
        .errors()
        .map((error) => error.message)
    ).toContain('The name must be 255 characters or fewer');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('keeps an unchanged name open and does not write', async () => {
    const updateProfile = vi.fn();
    const { fixture, cmp } = setup(
      updateProfile as unknown as AuthService['updateProfile']
    );

    cmp.beginNameEdit();
    cmp.nameModel.set({ name: '  Ada Lovelace  ' });
    await submitAndSettle(fixture, cmp);

    expect(updateProfile).not.toHaveBeenCalled();
    expect(cmp.editingName()).toBe(true);
    expect(cmp.hasChangedName()).toBe(false);
  });

  it('keeps the editor stable while saving and updates the signed-in identity on success', async () => {
    const response = new Subject<Profile>();
    const { fixture, cmp, applyProfileUpdate } = setup(() =>
      response.asObservable()
    );

    cmp.beginNameEdit();
    cmp.nameModel.set({ name: '  Augusta Ada King  ' });
    cmp.saveName(new Event('submit'));
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '#profile-name'
    ) as HTMLInputElement;
    const cancel = fixture.nativeElement.querySelector(
      'button[type="button"]'
    ) as HTMLButtonElement;
    const save = fixture.nativeElement.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement;
    expect(input).not.toBeNull();
    expect(save).not.toBeNull();
    expect(input.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(save.disabled).toBe(true);

    response.next({ ...ADA, name: 'Augusta Ada King' });
    response.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(applyProfileUpdate).toHaveBeenCalledWith({
      ...ADA,
      name: 'Augusta Ada King',
    });
    expect(cmp.successMessage()).toBe('Name updated');
    expect(fixture.nativeElement.textContent).toContain('Name updated');
    expect(document.activeElement?.textContent).toContain('Edit name');
  });

  it('maps server validation onto the name field', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError(
            'Please correct the highlighted fields and try again.',
            400,
            {
              name: ['Choose a name with fewer characters.'],
            }
          )
      )
    );

    cmp.beginNameEdit();
    cmp.nameModel.set({ name: 'Ada Byron' });
    await submitAndSettle(fixture, cmp);

    expect(
      cmp.nameForm
        .name()
        .errors()
        .map((error) => error.message)
    ).toContain('Choose a name with fewer characters.');
    expect(cmp.errorMessage()).toBeNull();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('#profile-name')
    );
  });

  it('cancels on Escape, returns focus to Edit name, and clears stale success feedback', async () => {
    const { fixture, cmp } = setup();

    cmp.successMessage.set('Name updated');
    cmp.beginNameEdit();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(cmp.successMessage()).toBeNull();

    const input = fixture.nativeElement.querySelector(
      '#profile-name'
    ) as HTMLInputElement;
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cmp.editingName()).toBe(false);
    expect(document.activeElement?.textContent).toContain('Edit name');
  });
});
