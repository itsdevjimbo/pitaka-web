import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, Profile } from '@/app/core/auth';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { withOverlayContainer } from '@/testing/overlay';
import { ProfileIdentity } from './profile-identity';

const ADA: Profile = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  pendingEmail: null,
  hasPicture: false,
};

describe('ProfileIdentity', () => {
  const overlay = withOverlayContainer();

  function setup(updateProfile: AuthService['updateProfile'] = () => of(ADA)) {
    const profile = signal<Profile | null>(ADA);
    const profilePictureUrl = signal<string | null>(null);
    const writeRevision = {
      sessionGeneration: 1,
      profileId: ADA.id,
      fields: { name: 1, email: 0, pendingEmail: 0, hasPicture: 0 },
      writeGenerations: { name: 1 },
    };
    const applyProfileWriteUpdate = vi.fn((updated: Profile) => profile.set(updated));

    TestBed.configureTestingModule({
      imports: [ProfileIdentity],
      providers: [
        provideDialogDefaults(),
        provideIcons(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AuthService, useValue: { updateProfile } },
        {
          provide: Session,
          useValue: {
            profile,
            profilePictureUrl,
            profilePictureDecodeFailed: vi.fn(),
            beginProfileWrite: vi.fn(() => writeRevision),
            applyProfileWriteUpdate,
            releaseProfileWrite: vi.fn(),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ProfileIdentity);
    fixture.detectChanges();
    return { fixture, applyProfileWriteUpdate };
  }

  async function submitAndSettle(fixture: ComponentFixture<ProfileIdentity>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function click(fixture: ComponentFixture<ProfileIdentity>, label: string) {
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) {
      throw new Error(`No button labelled "${label}"`);
    }
    button.click();
    fixture.detectChanges();
  }

  function input(fixture: ComponentFixture<ProfileIdentity>) {
    return fixture.nativeElement.querySelector('#profile-name') as HTMLInputElement;
  }

  function enterName(fixture: ComponentFixture<ProfileIdentity>, value: string) {
    const name = input(fixture);
    name.value = value;
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('opens a focused inline editor seeded with the signed-in name', async () => {
    const { fixture } = setup();

    click(fixture, 'Edit name');
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('#profile-name') as HTMLInputElement | null;
    expect(input?.value).toBe('Ada Lovelace');
    expect(document.activeElement).toBe(input);
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe('Ada Lovelace'.length);
  });

  it('requires a trimmed name of at most 255 characters before saving', async () => {
    const updateProfile = vi.fn();
    const { fixture } = setup(updateProfile as unknown as AuthService['updateProfile']);

    click(fixture, 'Edit name');
    enterName(fixture, '   ');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(false);
    await submitAndSettle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Enter a name');
    expect(document.activeElement).toBe(input(fixture));
    expect(updateProfile).not.toHaveBeenCalled();

    enterName(fixture, 'x'.repeat(256));
    await submitAndSettle(fixture);

    expect(fixture.nativeElement.textContent).toContain('The name must be 255 characters or fewer');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('keeps an unchanged name open and does not write', async () => {
    const updateProfile = vi.fn();
    const { fixture } = setup(updateProfile as unknown as AuthService['updateProfile']);

    click(fixture, 'Edit name');
    enterName(fixture, '  Ada Lovelace  ');
    await submitAndSettle(fixture);

    expect(updateProfile).not.toHaveBeenCalled();
    expect(input(fixture)).not.toBeNull();
  });

  it('keeps the editor stable while saving and updates the signed-in identity on success', async () => {
    const response = new Subject<Profile>();
    const { fixture, applyProfileWriteUpdate } = setup(() => response.asObservable());

    click(fixture, 'Edit name');
    enterName(fixture, '  Augusta Ada King  ');
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#profile-name') as HTMLInputElement;
    const cancel = fixture.nativeElement.querySelector('button[type="button"]') as HTMLButtonElement;
    const save = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(input).not.toBeNull();
    expect(save).not.toBeNull();
    expect(input.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(save.disabled).toBe(true);

    response.next({ ...ADA, name: 'Augusta Ada King' });
    response.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(applyProfileWriteUpdate).toHaveBeenCalledWith({ ...ADA, name: 'Augusta Ada King' }, expect.anything(), [
      'name',
    ]);
    expect(fixture.nativeElement.textContent).toContain('Name updated');
    expect(document.activeElement?.textContent).toContain('Edit name');
  });

  it('maps server validation onto the name field', async () => {
    const { fixture } = setup(() =>
      throwError(
        () =>
          new ApiError('Please correct the highlighted fields and try again.', 400, {
            name: ['Choose a name with fewer characters.'],
          }),
      ),
    );

    click(fixture, 'Edit name');
    enterName(fixture, 'Ada Byron');
    await submitAndSettle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Choose a name with fewer characters.');
    expect(input(fixture).value).toBe('Ada Byron');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#profile-name'));
  });

  it('asks before discarding a changed name and keeps the draft when requested', async () => {
    const { fixture } = setup();

    click(fixture, 'Edit name');
    enterName(fixture, 'Augusta Ada King');
    click(fixture, 'Cancel');
    await fixture.whenStable();

    const prompt = overlay().querySelector('[role="alertdialog"]');
    expect(prompt?.textContent).toContain('Discard changes?');
    expect(document.activeElement?.textContent).toContain('Keep editing');

    const keepEditing = Array.from(overlay().querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Keep editing',
    );
    if (!keepEditing) {
      throw new Error('No Keep editing button');
    }
    keepEditing.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(input(fixture).value).toBe('Augusta Ada King');
  });

  it('cancels on Escape, returns focus to Edit name, and clears stale success feedback', async () => {
    const { fixture } = setup(() => of({ ...ADA, name: 'Ada Byron' }));

    click(fixture, 'Edit name');
    enterName(fixture, 'Ada Byron');
    await submitAndSettle(fixture);
    expect(fixture.nativeElement.textContent).toContain('Name updated');

    click(fixture, 'Edit name');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Name updated');

    const input = fixture.nativeElement.querySelector('#profile-name') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('#profile-name')).toBeNull();
    expect(document.activeElement?.textContent).toContain('Edit name');
  });
});
