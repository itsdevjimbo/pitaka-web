import { Signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { pressEscape, withOverlayContainer } from '@/testing/overlay';
import { Account } from '../../data/account';
import {
  AccountDeleteBlockedError,
  AccountModifiedError,
} from '../../data/account-errors';
import { AccountsService } from '../../data/accounts.service';
import AccountList from './account-list';

type RowNotice = {
  id: number;
  message: string;
  retry?: () => void;
  retire?: () => void;
};

/** The slice of the component the tests reach into. */
type AccountsInternals = {
  toggleRetired(): void;
  load(): void;
  openNewAccountDialog(): void;
  openRenameDialog(account: Account): void;
  toggleActive(account: Account): void;
  askDelete(account: Account): void;
  confirmDelete(account: Account): void;
  cancelDelete(): void;
  readonly confirmingDeleteId: Signal<number | null>;
  readonly busyId: Signal<number | null>;
  readonly notice: Signal<RowNotice | null>;
  readonly errorMessage: Signal<string | null>;
};

const CASH: Account = {
  id: 1,
  name: 'Cash on hand',
  type: 'Cash',
  currentBalance: 1500,
  isActive: true,
};
const BANK: Account = {
  id: 2,
  name: 'BPI Savings',
  type: 'Bank',
  currentBalance: 8500,
  isActive: true,
};
const OLD_WALLET: Account = {
  id: 3,
  name: 'Old GCash',
  type: 'Wallet',
  currentBalance: 300,
  isActive: false,
};

describe('AccountList', () => {
  const overlay = withOverlayContainer();

  function setup(
    list: AccountsService['list'],
    overrides: Partial<AccountsService> = {}
  ) {
    TestBed.configureTestingModule({
      imports: [AccountList],
      providers: [
        provideIcons(),
        provideRouter([]),
        provideDialogDefaults(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AccountsService, useValue: { list, ...overrides } },
      ],
    });

    const fixture = TestBed.createComponent(AccountList);
    const cmp = fixture.componentInstance as unknown as AccountsInternals;
    fixture.detectChanges();

    return {
      fixture,
      cmp,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      dialog: () => overlay().querySelector<HTMLElement>('[role="dialog"]'),
      dialogText: () => overlay().textContent ?? '',
    };
  }

  /**
   * Push change detection through the component and the overlay, and let any
   * pending form-submit microtasks resolve.
   */
  async function settle(fixture: ComponentFixture<AccountList>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function clickButton(fixture: ComponentFixture<AccountList>, label: string) {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    ).find((element) => (element.textContent ?? '').includes(label));
    if (!button) {
      throw new Error(`No button labelled "${label}"`);
    }
    button.click();
    fixture.detectChanges();
  }

  /** Find a button by its text, anywhere in the open overlay. */
  function overlayButton(label: string): HTMLButtonElement {
    const button = Array.from(
      overlay().querySelectorAll('button')
    ).find((element) => (element.textContent ?? '').includes(label));
    if (!button) {
      throw new Error(`No overlay button labelled "${label}"`);
    }
    return button;
  }

  /** Type a value into a text/number input in the open overlay. */
  function typeInto(selector: string, value: string) {
    const input = overlay().querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error(`No overlay input matching "${selector}"`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /**
   * Fill and submit the new-account form the dialog renders. Mirrors what a
   * person does: a name, a type from the picker, a starting balance, then the
   * submit button.
   */
  async function submitNewAccount(
    fixture: ComponentFixture<AccountList>,
    values: { name: string; type: string; balance: string }
  ) {
    typeInto('#account-name', values.name);
    typeInto('#account-initial-balance', values.balance);

    overlay().querySelector<HTMLElement>('mat-select')!.click();
    await settle(fixture);
    const option = Array.from(
      overlay().querySelectorAll<HTMLElement>('mat-option')
    ).find((element) => (element.textContent ?? '').trim() === values.type);
    if (!option) {
      throw new Error(`No type option "${values.type}"`);
    }
    option.click();
    await settle(fixture);

    overlayButton('Add account').click();
    await settle(fixture);
  }

  it('shows that it is working while the load is in flight, then the list', () => {
    const pending = new Subject<Account[]>();
    const { fixture, text } = setup(() => pending.asObservable());

    expect(text()).toContain('Loading your accounts…');

    pending.next([CASH, BANK]);
    pending.complete();
    fixture.detectChanges();

    expect(text()).not.toContain('Loading your accounts…');
    expect(text()).toContain('Cash on hand');
    expect(text()).toContain('BPI Savings');
  });

  it('lists each Account with its name, its type, and its current balance', () => {
    const { text } = setup(() => of([CASH, BANK]));

    expect(text()).toContain('Cash on hand');
    expect(text()).toContain('Cash');
    expect(text()).toContain(formatPeso(1500));
    expect(text()).toContain('BPI Savings');
    expect(text()).toContain('Bank');
    expect(text()).toContain(formatPeso(8500));
  });

  it('shows a plainly-labelled total when nothing is retired', () => {
    const { text } = setup(() => of([CASH, BANK]));

    expect(text()).toContain('Total');
    expect(text()).not.toContain('Total across');
    expect(text()).toContain(formatPeso(10000));
  });

  it('adds money without floating-point drift', () => {
    const { text } = setup(() =>
      of([
        { ...CASH, currentBalance: 0.1 },
        { ...BANK, currentBalance: 0.2 },
      ])
    );

    expect(text()).toContain(formatPeso(0.3));
  });

  it('hides retired Accounts and their balance from the headline total, without a confusing extra total', () => {
    const { text } = setup(() => of([CASH, BANK, OLD_WALLET]));

    expect(text()).not.toContain('Old GCash');
    expect(text()).toContain('Total across active accounts');
    // Headline is 1500 + 8500; the retired-inclusive total stays hidden until asked for.
    expect(text()).toContain(formatPeso(10000));
    expect(text()).not.toContain('Including retired:');
  });

  it('reveals retired Accounts on request and confirms the total now covers them all', () => {
    const { fixture, cmp, text } = setup(() => of([CASH, BANK, OLD_WALLET]));

    cmp.toggleRetired();
    fixture.detectChanges();

    expect(text()).toContain('Old GCash');
    expect(text()).toContain('Retired');
    expect(text()).toContain('Total across all accounts');
    expect(text()).toContain('Including retired:');
    expect(text()).toContain(formatPeso(10300));
  });

  it('offers no retired toggle when nothing is retired', () => {
    const { text } = setup(() => of([CASH, BANK]));

    expect(text()).not.toContain('Show retired');
  });

  it('tells a Profile with no Accounts what to do next', () => {
    const { text } = setup(() => of([]));

    expect(text()).toContain('No accounts yet');
    expect(text()).toContain('Add your first account');
  });

  it('explains a failed load and retries from the top when asked', () => {
    let attempt = 0;
    const list = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? throwError(
            () =>
              new ApiError(
                'Could not reach the server. Check your connection and try again.',
                0
              )
          )
        : of([CASH, BANK]);
    });
    const { fixture, text } = setup(list as unknown as AccountsService['list']);

    expect(text()).toContain('Could not reach the server.');

    clickButton(fixture, 'Try again');

    expect(list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Could not reach the server.');
    expect(text()).toContain('Cash on hand');
  });

  it('falls back to a plain message when the failure is not an ApiError', () => {
    const { text } = setup(() => throwError(() => new Error('boom')));

    expect(text()).toContain(
      'Something went wrong loading your accounts. Please try again.'
    );
  });

  describe('create, in a dialog', () => {
    const SERVER_SAVINGS: Account = {
      id: 4,
      name: 'New Savings',
      type: 'Bank',
      // Deliberately not the balance the person will type — the row must show
      // the server's figure, not the entered one.
      currentBalance: 250,
      isActive: true,
    };

    async function openAddDialog(fixture: ComponentFixture<AccountList>) {
      clickButton(fixture, 'Add account');
      await settle(fixture);
    }

    it('opens the new-account form in a dialog from the heading, without reflowing the list', async () => {
      const { fixture, text, dialog, dialogText } = setup(() =>
        of([CASH, BANK])
      );
      const before = text();

      await openAddDialog(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('New account');
      expect(dialogText()).toContain('Name');
      // The list behind the dialog is untouched.
      expect(text()).toContain(before);
    });

    it('opens the same dialog from the empty state', async () => {
      const { fixture, text, dialog, dialogText } = setup(() => of([]));

      expect(text()).toContain('No accounts yet');
      await openAddDialog(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('New account');
    });

    it('offers nothing destructive inside the dialog', async () => {
      const { fixture, dialogText } = setup(() => of([CASH]));

      await openAddDialog(fixture);

      expect(dialogText()).not.toContain('Delete');
      expect(dialogText()).not.toContain('Retire');
      expect(dialogText()).not.toContain('Reactivate');
    });

    it('moves focus into the dialog on open and back to the opener on close', async () => {
      const { fixture, dialog } = setup(() => of([CASH]));

      const addButton = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button')
      ).find((element) => (element.textContent ?? '').includes('Add account'))!;
      addButton.focus();
      addButton.click();
      await settle(fixture);

      expect(overlay().contains(document.activeElement)).toBe(true);

      pressEscape();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(addButton);
    });

    it('closes on Escape', async () => {
      const { fixture, dialog } = setup(() => of([CASH]));

      await openAddDialog(fixture);
      pressEscape();
      await settle(fixture);

      expect(dialog()).toBeNull();
    });

    it('stays open on a backdrop click', async () => {
      const { fixture, dialog } = setup(() => of([CASH]));

      await openAddDialog(fixture);
      overlay().querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
    });

    it('dismisses on Cancel without calling the service', async () => {
      const create = vi.fn();
      const { fixture, dialog } = setup(() => of([CASH]), {
        create: create as unknown as AccountsService['create'],
      });

      await openAddDialog(fixture);
      overlayButton('Cancel').click();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(create).not.toHaveBeenCalled();
    });

    it('dismisses on the close control without calling the service', async () => {
      const create = vi.fn();
      const { fixture, dialog } = setup(() => of([CASH]), {
        create: create as unknown as AccountsService['create'],
      });

      await openAddDialog(fixture);
      overlay()
        .querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
        .click();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(create).not.toHaveBeenCalled();
    });

    it('on a successful create, closes the dialog and shows the Account at the server balance, then re-reads (ADR 0006)', async () => {
      const reReadPending = new Subject<Account[]>();
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of([CASH]) : reReadPending.asObservable();
      });
      const create = vi.fn(() => of(SERVER_SAVINGS));
      const { fixture, text, dialog } = setup(
        list as unknown as AccountsService['list'],
        { create: create as unknown as AccountsService['create'] }
      );

      await openAddDialog(fixture);
      await submitNewAccount(fixture, {
        name: 'New Savings',
        type: 'Bank',
        balance: '0',
      });

      expect(create).toHaveBeenCalledWith({
        name: 'New Savings',
        type: 'Bank',
        initialBalance: 0,
      });
      expect(dialog()).toBeNull();
      expect(text()).toContain('New Savings');
      expect(text()).toContain(formatPeso(250));
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('on a failed create, keeps the dialog open with the input intact and the reason shown', async () => {
      const create = vi.fn(() => throwError(() => new Error('offline')));
      const { fixture, dialog, dialogText } = setup(() => of([CASH]), {
        create: create as unknown as AccountsService['create'],
      });

      await openAddDialog(fixture);
      await submitNewAccount(fixture, {
        name: 'Brokerage',
        type: 'Investment',
        balance: '0',
      });

      expect(dialog()).not.toBeNull();
      expect(
        overlay().querySelector<HTMLInputElement>('#account-name')!.value
      ).toBe('Brokerage');
      expect(dialogText()).toContain(
        'Something went wrong creating your account'
      );
    });

    it('shows a server-rejected field its own message, in the still-open dialog', async () => {
      const create = vi.fn(() =>
        throwError(
          () =>
            new ApiError('An account with this name already exists.', 409, {
              name: ['An account with this name already exists.'],
            })
        )
      );
      const { fixture, dialog, dialogText } = setup(() => of([CASH]), {
        create: create as unknown as AccountsService['create'],
      });

      await openAddDialog(fixture);
      await submitNewAccount(fixture, {
        name: 'Cash on hand',
        type: 'Cash',
        balance: '0',
      });

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain(
        'An account with this name already exists.'
      );
    });

    it('keeps the optimistic row when the re-read fails, rather than flipping to an error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1
          ? of([CASH])
          : throwError(() => new ApiError('Internal Server Error', 500));
      });
      const create = vi.fn(() => of(SERVER_SAVINGS));
      const { fixture, cmp, text } = setup(
        list as unknown as AccountsService['list'],
        { create: create as unknown as AccountsService['create'] }
      );

      await openAddDialog(fixture);
      await submitNewAccount(fixture, {
        name: 'New Savings',
        type: 'Bank',
        balance: '0',
      });

      expect(text()).toContain('Cash on hand');
      expect(text()).toContain('New Savings');
      expect(cmp.errorMessage()).toBeNull();
    });
  });

  describe('rename, in a dialog', () => {
    it('opens the rename form in a dialog seeded with the current name', async () => {
      const { fixture, cmp, dialog, dialogText } = setup(() => of([CASH, BANK]));

      cmp.openRenameDialog(CASH);
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Rename account');
      expect(
        overlay().querySelector<HTMLInputElement>('#rename-account-name')!.value
      ).toBe('Cash on hand');
    });

    it('leaves the row showing name, type, balance and retired badge while it is open', async () => {
      const { fixture, cmp, text } = setup(() => of([OLD_WALLET]));

      cmp.toggleRetired();
      fixture.detectChanges();
      cmp.openRenameDialog(OLD_WALLET);
      await settle(fixture);

      expect(text()).toContain('Old GCash');
      expect(text()).toContain('Wallet');
      expect(text()).toContain(formatPeso(300));
      expect(text()).toContain('Retired');
    });

    it('offers nothing destructive inside the dialog', async () => {
      const { fixture, cmp, dialogText } = setup(() => of([CASH]));

      cmp.openRenameDialog(CASH);
      await settle(fixture);

      expect(dialogText()).not.toContain('Delete');
      expect(dialogText()).not.toContain('Retire');
      expect(dialogText()).not.toContain('Reactivate');
    });

    it('dismisses on Cancel, the close control, and Escape without calling the service', async () => {
      const rename = vi.fn();
      const { fixture, cmp, dialog } = setup(() => of([CASH]), {
        rename: rename as unknown as AccountsService['rename'],
      });

      cmp.openRenameDialog(CASH);
      await settle(fixture);
      overlayButton('Cancel').click();
      await settle(fixture);
      expect(dialog()).toBeNull();

      cmp.openRenameDialog(CASH);
      await settle(fixture);
      overlay()
        .querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
        .click();
      await settle(fixture);
      expect(dialog()).toBeNull();

      cmp.openRenameDialog(CASH);
      await settle(fixture);
      pressEscape();
      await settle(fixture);
      expect(dialog()).toBeNull();

      expect(rename).not.toHaveBeenCalled();
    });

    it('on a successful rename, closes the dialog and the new name shows everywhere, after a re-read', async () => {
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1
          ? of([CASH, BANK])
          : of([{ ...CASH, name: 'Everyday cash' }, BANK]);
      });
      const rename = vi.fn((_id: number, _name: string) =>
        of({ ...CASH, name: 'Everyday cash' })
      );
      const { fixture, cmp, text, dialog } = setup(
        list as unknown as AccountsService['list'],
        { rename: rename as unknown as AccountsService['rename'] }
      );

      cmp.openRenameDialog(CASH);
      await settle(fixture);
      typeInto('#rename-account-name', 'Everyday cash');
      overlayButton('Save').click();
      await settle(fixture);

      expect(rename).toHaveBeenCalledWith(1, 'Everyday cash');
      expect(dialog()).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).toContain('Everyday cash');
      expect(text()).not.toContain('Cash on hand');
    });

    it('on a failed rename, keeps the dialog open with the reason shown', async () => {
      const rename = vi.fn(() =>
        throwError(
          () =>
            new AccountModifiedError(
              'This account was updated by another request. Please try again.'
            )
        )
      );
      const { fixture, cmp, dialog, dialogText } = setup(() => of([CASH]), {
        rename: rename as unknown as AccountsService['rename'],
      });

      cmp.openRenameDialog(CASH);
      await settle(fixture);
      typeInto('#rename-account-name', 'Everyday cash');
      overlayButton('Save').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('updated by another request');
    });

    it('shows a server-rejected name its own message, in the still-open dialog', async () => {
      const rename = vi.fn(() =>
        throwError(
          () =>
            new ApiError('An account with this name already exists.', 409, {
              name: ['An account with this name already exists.'],
            })
        )
      );
      const { fixture, cmp, dialog, dialogText } = setup(() => of([CASH, BANK]), {
        rename: rename as unknown as AccountsService['rename'],
      });

      cmp.openRenameDialog(CASH);
      await settle(fixture);
      typeInto('#rename-account-name', 'BPI Savings');
      overlayButton('Save').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain(
        'An account with this name already exists.'
      );
    });
  });

  describe('retire and reactivate', () => {
    it('retires an active Account through the service and re-reads the list', () => {
      const setActive = vi.fn(() => of({ ...CASH, isActive: false }));
      const list = vi.fn(() => of([CASH]));
      const { cmp } = setup(list as unknown as AccountsService['list'], {
        setActive,
      });

      cmp.toggleActive(CASH);

      expect(setActive).toHaveBeenCalledWith(1, false);
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('reactivates a retired Account by asking for isActive true', () => {
      const setActive = vi.fn(() => of({ ...OLD_WALLET, isActive: true }));
      const { cmp } = setup(() => of([OLD_WALLET]), { setActive });

      cmp.toggleActive(OLD_WALLET);

      expect(setActive).toHaveBeenCalledWith(3, true);
    });

    it('reports a retire that lost a concurrency race and offers a retry', () => {
      const setActive = vi.fn(() =>
        throwError(
          () =>
            new AccountModifiedError(
              'This account was updated by another request. Please try again.'
            )
        )
      );
      const { fixture, cmp, text } = setup(() => of([CASH]), { setActive });

      cmp.toggleActive(CASH);
      fixture.detectChanges();

      expect(cmp.notice()?.id).toBe(1);
      expect(text()).toContain('updated by another request');
      expect(text()).toContain('Try again');
    });
  });

  describe('delete', () => {
    it('asks for confirmation and does not call the service until confirmed', () => {
      const remove = vi.fn(() => of(undefined));
      const { fixture, cmp, text } = setup(() => of([CASH]), { remove });

      cmp.askDelete(CASH);
      fixture.detectChanges();

      expect(cmp.confirmingDeleteId()).toBe(1);
      expect(text()).toContain('This can’t be undone');
      expect(remove).not.toHaveBeenCalled();

      cmp.confirmDelete(CASH);
      expect(remove).toHaveBeenCalledWith(1);
    });

    it('deletes an empty Account and re-reads the list and total', () => {
      const remove = vi.fn(() => of(undefined));
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of([CASH, BANK]) : of([BANK]);
      });
      const { fixture, cmp, text } = setup(
        list as unknown as AccountsService['list'],
        { remove }
      );

      cmp.confirmDelete(CASH);
      fixture.detectChanges();

      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).not.toContain('Cash on hand');
      expect(text()).toContain(formatPeso(8500));
    });

    it('explains a delete refused for Transaction history and points at retiring', () => {
      const remove = vi.fn(() =>
        throwError(
          () =>
            new AccountDeleteBlockedError(
              'transaction-history',
              'This account has transaction history and cannot be deleted.'
            )
        )
      );
      const { fixture, cmp, text } = setup(() => of([CASH]), { remove });

      cmp.confirmDelete(CASH);
      fixture.detectChanges();

      expect(text()).toContain('transaction history');
      expect(text()).toContain('Retire instead');
      expect(cmp.notice()?.retire).toBeTypeOf('function');
    });

    it('explains a delete refused for Goal-allocated money, distinctly from history', () => {
      const remove = vi.fn(() =>
        throwError(
          () =>
            new AccountDeleteBlockedError(
              'goal-allocation',
              'This account contains funds allocated toward a specific goal.'
            )
        )
      );
      const { fixture, cmp, text } = setup(() => of([CASH]), { remove });

      cmp.confirmDelete(CASH);
      fixture.detectChanges();

      expect(text()).toContain('allocated toward a specific goal');
      expect(text()).not.toContain('transaction history');
      expect(text()).not.toContain('Retire instead');
    });

    it('reports a delete that lost a concurrency race and offers a retry', () => {
      const remove = vi.fn(() =>
        throwError(
          () =>
            new AccountModifiedError(
              'This account was updated by another request. Please try again.'
            )
        )
      );
      const { fixture, cmp, text } = setup(() => of([CASH]), { remove });

      cmp.confirmDelete(CASH);
      fixture.detectChanges();

      expect(text()).toContain('updated by another request');
      expect(text()).toContain('Try again');
      expect(text()).not.toContain('Retire instead');
    });
  });
});
