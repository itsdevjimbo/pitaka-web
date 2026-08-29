import { OutputEmitterRef, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { Account } from './account';
import { AccountModifiedError } from './account-errors';
import { AccountsService } from './accounts.service';
import { RenameAccountForm } from './rename-account-form';

/** The slice of the component the tests reach into. */
type RenameInternals = {
  model: WritableSignal<{ name: string }>;
  renameForm: { name: FieldTree<string> };
  errorMessage: () => string | null;
  renamed: OutputEmitterRef<Account>;
  save(event: Event): void;
};

const CASH: Account = {
  id: 9,
  name: 'Cash on hand',
  type: 'Cash',
  currentBalance: 1500,
  isActive: true,
};

describe('RenameAccountForm', () => {
  function setup(rename: AccountsService['rename']) {
    TestBed.configureTestingModule({
      imports: [RenameAccountForm],
      providers: [
        provideIcons(),
        { provide: AccountsService, useValue: { rename } },
      ],
    });

    const fixture = TestBed.createComponent(RenameAccountForm);
    fixture.componentRef.setInput('account', CASH);
    const cmp = fixture.componentInstance as unknown as RenameInternals;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: RenameInternals
  ) {
    cmp.save(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
  }

  it('starts pre-filled with the current name', () => {
    const { cmp } = setup(() => of(CASH));

    expect(cmp.model().name).toBe('Cash on hand');
  });

  it('sends the trimmed name and emits the renamed Account', async () => {
    const rename = vi.fn((_id: number, _name: string) =>
      of({ ...CASH, name: 'Everyday cash' })
    );
    const { fixture, cmp } = setup(
      rename as unknown as AccountsService['rename']
    );
    const emitted: Account[] = [];
    cmp.renamed.subscribe((account) => emitted.push(account));

    cmp.model.set({ name: '  Everyday cash  ' });
    await submitAndSettle(fixture, cmp);

    expect(rename).toHaveBeenCalledWith(9, 'Everyday cash');
    expect(emitted).toEqual([{ ...CASH, name: 'Everyday cash' }]);
    expect(cmp.errorMessage()).toBeNull();
  });

  it('binds a duplicate-name conflict onto the name control', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError('An account with this name already exists.', 409, {
            name: ['An account with this name already exists.'],
          })
      )
    );

    cmp.model.set({ name: 'Savings' });
    await submitAndSettle(fixture, cmp);

    const messages = cmp.renameForm
      .name()
      .errors()
      .map((error) => error.message);
    expect(messages).toContain('An account with this name already exists.');
    expect(cmp.errorMessage()).toBeNull();
  });

  it('shows a concurrency rejection as a banner the person can retry from', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new AccountModifiedError(
            'This account was updated by another request. Please try again.'
          )
      )
    );

    cmp.model.set({ name: 'Everyday cash' });
    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe(
      'This account was updated by another request. Please try again.'
    );
    expect(cmp.renameForm.name().errors()).toEqual([]);
  });
});
