import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { Account } from '../../data/account';
import { AccountModifiedError } from '../../data/account-errors';
import { AccountsService } from '../../data/accounts.service';
import { RenameAccountForm } from './rename-account-form';

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
      providers: [provideIcons(), { provide: AccountsService, useValue: { rename } }],
    });

    const fixture = TestBed.createComponent(RenameAccountForm);
    fixture.componentRef.setInput('account', CASH);
    fixture.detectChanges();
    return { fixture };
  }

  async function submitAndSettle(fixture: ComponentFixture<RenameAccountForm>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function nameInput(fixture: ComponentFixture<RenameAccountForm>) {
    return fixture.nativeElement.querySelector('#rename-account-name') as HTMLInputElement;
  }

  function enterName(fixture: ComponentFixture<RenameAccountForm>, value: string) {
    const input = nameInput(fixture);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function text(fixture: ComponentFixture<RenameAccountForm>) {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('starts pre-filled with the current name', () => {
    const { fixture } = setup(() => of(CASH));

    expect(nameInput(fixture).value).toBe('Cash on hand');
  });

  it('keeps Save available while invalid and focuses the invalid name on submit', async () => {
    const rename = vi.fn(() => of(CASH));
    const { fixture } = setup(rename);

    enterName(fixture, '');
    fixture.detectChanges();
    const save = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Save',
    );
    expect(save?.disabled).toBe(false);

    await submitAndSettle(fixture);

    expect(rename).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(nameInput(fixture));
    expect(text(fixture)).toContain('You must enter a name');
  });

  it('reports edits and an in-flight save to its dialog shell', async () => {
    const response = new Subject<Account>();
    const { fixture } = setup(() => response);
    const dirty: boolean[] = [];
    const pending: boolean[] = [];
    fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
    fixture.componentInstance.pendingChange.subscribe((value) => pending.push(value));

    enterName(fixture, 'Everyday cash');
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(dirty).toEqual([true]);
    expect(pending).toEqual([true]);

    response.next({ ...CASH, name: 'Everyday cash' });
    response.complete();
    await fixture.whenStable();

    expect(pending).toEqual([true, false]);
  });

  it('sends the trimmed name and emits the renamed Account', async () => {
    const rename = vi.fn((_id: number, _name: string) => of({ ...CASH, name: 'Everyday cash' }));
    const { fixture } = setup(rename as unknown as AccountsService['rename']);
    const emitted: Account[] = [];
    fixture.componentInstance.renamed.subscribe((account) => emitted.push(account));

    enterName(fixture, '  Everyday cash  ');
    await submitAndSettle(fixture);

    expect(rename).toHaveBeenCalledWith(9, 'Everyday cash');
    expect(emitted).toEqual([{ ...CASH, name: 'Everyday cash' }]);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('binds a duplicate-name conflict onto the name control', async () => {
    const { fixture } = setup(() =>
      throwError(
        () =>
          new ApiError('An account with this name already exists.', 409, {
            name: ['An account with this name already exists.'],
          }),
      ),
    );

    enterName(fixture, 'Savings');
    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('An account with this name already exists.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a concurrency rejection as a banner the person can retry from', async () => {
    const { fixture } = setup(() =>
      throwError(() => new AccountModifiedError('This account was updated by another request. Please try again.')),
    );

    enterName(fixture, 'Everyday cash');
    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('This account was updated by another request. Please try again.');
    expect(text(fixture)).not.toContain('You must enter a name');
  });
});
