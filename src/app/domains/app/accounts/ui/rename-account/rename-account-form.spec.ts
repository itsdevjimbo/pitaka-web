import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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
    input.dispatchEvent(new Event('input'));
  }

  function text(fixture: ComponentFixture<RenameAccountForm>) {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('starts pre-filled with the current name', () => {
    const { fixture } = setup(() => of(CASH));

    expect(nameInput(fixture).value).toBe('Cash on hand');
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
