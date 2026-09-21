import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { pressEscape, withOverlayContainer } from '@/testing/overlay';
import { Account } from '../../data/account';
import { AccountDeleteBlockedError, AccountModifiedError } from '../../data/account-errors';
import { AccountsService } from '../../data/accounts.service';
import AccountList from './account-list';

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
    all: AccountsService['all'],
    overrides: Partial<AccountsService> = {},
    routeParams = new BehaviorSubject<ParamMap>(convertToParamMap({})),
  ) {
    TestBed.configureTestingModule({
      imports: [AccountList],
      providers: [
        provideIcons(),
        provideRouter([]),
        provideDialogDefaults(),
        {
          provide: MATERIAL_ANIMATIONS,
          useValue: { animationsDisabled: true },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: routeParams.value },
            queryParamMap: routeParams,
          },
        },
        { provide: AccountsService, useValue: { all, ...overrides } },
      ],
    });

    const fixture = TestBed.createComponent(AccountList);
    fixture.detectChanges();

    return {
      fixture,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      dialog: () => overlay().querySelector<HTMLElement>('[role="dialog"]'),
      dialogText: () => overlay().querySelector<HTMLElement>('[role="dialog"]')?.textContent ?? '',
      routeParams,
    };
  }

  function row(fixture: ComponentFixture<AccountList>, accountName: string) {
    const item = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('li')).find((candidate) =>
      candidate.textContent?.includes(accountName),
    );
    if (!item) {
      throw new Error(`No Account row named "${accountName}"`);
    }
    return item;
  }

  async function chooseRowAction(fixture: ComponentFixture<AccountList>, accountName: string, action: string) {
    row(fixture, accountName).querySelector<HTMLButtonElement>('button[aria-label="Account actions"]')!.click();
    await settle(fixture);
    overlayButton(action).click();
    await settle(fixture);
  }

  async function confirmDelete(fixture: ComponentFixture<AccountList>, accountName: string) {
    await chooseRowAction(fixture, accountName, 'Delete');
    const confirm = Array.from(row(fixture, accountName).querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete',
    );
    if (!confirm) {
      throw new Error('No delete confirmation button');
    }
    confirm.click();
    await settle(fixture);
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
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((element) =>
      (element.textContent ?? '').includes(label),
    );
    if (!button) {
      throw new Error(`No button labelled "${label}"`);
    }
    button.click();
    fixture.detectChanges();
  }

  /** Find a button by its text, anywhere in the open overlay. */
  function overlayButton(label: string): HTMLButtonElement {
    const button = Array.from(overlay().querySelectorAll('button')).find((element) =>
      (element.textContent ?? '').includes(label),
    );
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
    values: { name: string; type: string; balance: string },
  ) {
    typeInto('#account-name', values.name);
    typeInto('#account-initial-balance', values.balance);

    overlay().querySelector<HTMLElement>('mat-select')!.click();
    await settle(fixture);
    const option = Array.from(overlay().querySelectorAll<HTMLElement>('mat-option')).find(
      (element) => (element.textContent ?? '').trim() === values.type,
    );
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

  it('names the lifecycle constraint in the total', () => {
    const { text } = setup(() => of([CASH, BANK]));

    expect(text()).toContain('Total');
    expect(text()).toContain('Total across active accounts');
    expect(text()).toContain(formatPeso(10000));
  });

  it('adds money without floating-point drift', () => {
    const { text } = setup(() =>
      of([
        { ...CASH, currentBalance: 0.1 },
        { ...BANK, currentBalance: 0.2 },
      ]),
    );

    expect(text()).toContain(formatPeso(0.3));
  });

  it('keeps the lifecycle controls visible when the Profile owns Accounts', () => {
    const { text } = setup(() => of([CASH, BANK, OLD_WALLET]));

    expect(text()).toContain('Old GCash');
    expect(text()).toContain('Active');
    expect(text()).toContain('Retired');
    expect(text()).toContain('All');
    expect(text()).toContain('Total across active accounts');
    // Headline is 1500 + 8500; the retired-inclusive total stays hidden until asked for.
    expect(text()).toContain(formatPeso(10300));
  });

  it('offers a status control even when no Account is retired', () => {
    const { text } = setup(() => of([CASH, BANK, OLD_WALLET]));

    expect(text()).toContain('Old GCash');
    expect(text()).toContain('Retired');
    expect(text()).toContain('Total across active accounts');
    expect(text()).toContain(formatPeso(10300));
  });

  it('offers status choices when nothing is retired', () => {
    const { text } = setup(() => of([CASH, BANK]));

    expect(text()).not.toContain('Show retired');
  });

  it('tells a Profile with no Accounts what to do next', () => {
    const { text } = setup(() => of([]));

    expect(text()).toContain('No accounts yet');
    expect(text()).toContain('Add your first account');
  });

  it('returns to the true-empty state after deleting the final Account', async () => {
    const all = vi
      .fn()
      .mockReturnValueOnce(of([CASH]))
      .mockReturnValueOnce(of([]));
    const list = vi
      .fn()
      .mockReturnValueOnce(of([CASH]))
      .mockReturnValueOnce(of([]));
    const { fixture, text } = setup(all, {
      list: list as unknown as AccountsService['list'],
      remove: (() => of(undefined)) as AccountsService['remove'],
    });

    await confirmDelete(fixture, 'Cash on hand');

    expect(all).toHaveBeenCalledTimes(2);
    expect(text()).toContain('No accounts yet');
    expect(text()).not.toContain('Account filters');
  });

  it('keeps the current rows and their total constraint until the newer URL criteria succeeds', () => {
    const retired = new Subject<Account[]>();
    const all = new Subject<Account[]>();
    const list = vi
      .fn()
      .mockReturnValueOnce(of([CASH]))
      .mockReturnValueOnce(retired)
      .mockReturnValueOnce(all);
    const { fixture, routeParams, text } = setup(() => of([CASH, OLD_WALLET]), {
      list: list as unknown as AccountsService['list'],
    });

    routeParams.next(convertToParamMap({ status: 'retired' }));
    fixture.detectChanges();
    expect(text()).toContain('Cash on hand');
    expect(text()).toContain('Total across active accounts');

    routeParams.next(convertToParamMap({ status: 'all' }));
    retired.next([OLD_WALLET]);
    fixture.detectChanges();
    expect(text()).toContain('Cash on hand');
    expect(text()).not.toContain('Old GCash');

    all.next([CASH, OLD_WALLET]);
    fixture.detectChanges();
    expect(text()).toContain('Total across all accounts');
    expect(text()).toContain('Old GCash');
  });

  it('keeps the previous result and its constraint when a URL-filtered read fails', () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(of([CASH]))
      .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)))
      .mockReturnValueOnce(of([OLD_WALLET]));
    const { fixture, routeParams, text } = setup(() => of([CASH, OLD_WALLET]), {
      list: list as unknown as AccountsService['list'],
    });

    routeParams.next(convertToParamMap({ status: 'retired' }));
    fixture.detectChanges();

    expect(text()).toContain('Cash on hand');
    expect(text()).toContain('Total across active accounts');
    expect(text()).toContain('Offline');

    clickButton(fixture, 'Try again');

    expect(list).toHaveBeenLastCalledWith({ isActive: false });
    expect(text()).toContain('Old GCash');
    expect(text()).toContain('Total across retired accounts');
  });

  it('explains a failed load and retries from the top when asked', () => {
    let attempt = 0;
    const list = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? throwError(() => new ApiError('Could not reach the server. Check your connection and try again.', 0))
        : of([CASH, BANK]);
    });
    const { fixture, text } = setup(list as unknown as AccountsService['all']);

    expect(text()).toContain('Could not reach the server.');

    clickButton(fixture, 'Try again');

    expect(list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Could not reach the server.');
    expect(text()).toContain('Cash on hand');
  });

  it('falls back to a plain message when the failure is not an ApiError', () => {
    const { text } = setup(() => throwError(() => new Error('boom')));

    expect(text()).toContain('Something went wrong loading your accounts. Please try again.');
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
      const { fixture, text, dialog, dialogText } = setup(() => of([CASH, BANK]));
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

      const addButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((element) =>
        (element.textContent ?? '').includes('Add account'),
      )!;
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
      overlay().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
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
      const { fixture, text, dialog } = setup(list as unknown as AccountsService['all'], {
        create: create as unknown as AccountsService['create'],
      });

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
      expect(text()).toContain('Updating…');
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
      expect(overlay().querySelector<HTMLInputElement>('#account-name')!.value).toBe('Brokerage');
      expect(dialogText()).toContain('Something went wrong creating your account');
    });

    it('shows a server-rejected field its own message, in the still-open dialog', async () => {
      const create = vi.fn(() =>
        throwError(
          () =>
            new ApiError('An account with this name already exists.', 409, {
              name: ['An account with this name already exists.'],
            }),
        ),
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
      expect(dialogText()).toContain('An account with this name already exists.');
    });

    it('keeps the optimistic row when the re-read fails, rather than flipping to an error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of([CASH]) : throwError(() => new ApiError('Internal Server Error', 500));
      });
      const create = vi.fn(() => of(SERVER_SAVINGS));
      const { fixture, text } = setup(list as unknown as AccountsService['all'], {
        create: create as unknown as AccountsService['create'],
      });

      await openAddDialog(fixture);
      await submitNewAccount(fixture, {
        name: 'New Savings',
        type: 'Bank',
        balance: '0',
      });

      expect(text()).toContain('Cash on hand');
      expect(text()).toContain('New Savings');
      expect(text()).not.toContain('We could not load your accounts');
    });
  });

  describe('rename, in a dialog', () => {
    it('opens the rename form in a dialog seeded with the current name', async () => {
      const { fixture, dialog, dialogText } = setup(() => of([CASH, BANK]));

      await chooseRowAction(fixture, 'Cash on hand', 'Rename');

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Rename account');
      expect(overlay().querySelector<HTMLInputElement>('#rename-account-name')!.value).toBe('Cash on hand');
    });

    it('leaves the row showing name, type, balance and retired badge while it is open', async () => {
      const { fixture, text } = setup(() => of([OLD_WALLET]));

      await chooseRowAction(fixture, 'Old GCash', 'Rename');

      expect(text()).toContain('Old GCash');
      expect(text()).toContain('Wallet');
      expect(text()).toContain(formatPeso(300));
      expect(text()).toContain('Retired');
    });

    it('offers nothing destructive inside the dialog', async () => {
      const { fixture, dialogText } = setup(() => of([CASH]));

      await chooseRowAction(fixture, 'Cash on hand', 'Rename');

      expect(dialogText()).not.toContain('Delete');
      expect(dialogText()).not.toContain('Retire');
      expect(dialogText()).not.toContain('Reactivate');
    });

    it('dismisses on Cancel, the close control, and Escape without calling the service', async () => {
      const rename = vi.fn();
      const { fixture, dialog } = setup(() => of([CASH]), {
        rename: rename as unknown as AccountsService['rename'],
      });

      await chooseRowAction(fixture, 'Cash on hand', 'Rename');
      overlayButton('Cancel').click();
      await settle(fixture);
      expect(dialog()).toBeNull();

      await chooseRowAction(fixture, 'Cash on hand', 'Rename');
      overlay().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(fixture);
      expect(dialog()).toBeNull();

      await chooseRowAction(fixture, 'Cash on hand', 'Rename');
      pressEscape();
      await settle(fixture);
      expect(dialog()).toBeNull();

      expect(rename).not.toHaveBeenCalled();
    });

    it('on a successful rename, closes the dialog and the new name shows everywhere, after a re-read', async () => {
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of([CASH, BANK]) : of([{ ...CASH, name: 'Everyday cash' }, BANK]);
      });
      const rename = vi.fn((_id: number, _name: string) => of({ ...CASH, name: 'Everyday cash' }));
      const { fixture, text, dialog } = setup(list as unknown as AccountsService['all'], {
        rename: rename as unknown as AccountsService['rename'],
      });

      await chooseRowAction(fixture, 'Cash on hand', 'Rename');
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
        throwError(() => new AccountModifiedError('This account was updated by another request. Please try again.')),
      );
      const { fixture, dialog, dialogText } = setup(() => of([CASH]), {
        rename: rename as unknown as AccountsService['rename'],
      });

      await chooseRowAction(fixture, 'Cash on hand', 'Rename');
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
            }),
        ),
      );
      const { fixture, dialog, dialogText } = setup(() => of([CASH, BANK]), {
        rename: rename as unknown as AccountsService['rename'],
      });

      await chooseRowAction(fixture, 'Cash on hand', 'Rename');
      typeInto('#rename-account-name', 'BPI Savings');
      overlayButton('Save').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('An account with this name already exists.');
    });
  });

  describe('retire and reactivate', () => {
    it('retires an active Account through the service and re-reads the list', async () => {
      const setActive = vi.fn(() => of({ ...CASH, isActive: false }));
      const list = vi.fn(() => of([CASH]));
      const { fixture } = setup(list as unknown as AccountsService['all'], {
        setActive,
      });

      await chooseRowAction(fixture, 'Cash on hand', 'Retire');

      expect(setActive).toHaveBeenCalledWith(1, false);
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('reactivates a retired Account by asking for isActive true', async () => {
      const setActive = vi.fn(() => of({ ...OLD_WALLET, isActive: true }));
      const { fixture } = setup(() => of([OLD_WALLET]), { setActive });

      await chooseRowAction(fixture, 'Old GCash', 'Reactivate');

      expect(setActive).toHaveBeenCalledWith(3, true);
    });

    it('reports a retire that lost a concurrency race and offers a retry', async () => {
      const setActive = vi.fn(() =>
        throwError(() => new AccountModifiedError('This account was updated by another request. Please try again.')),
      );
      const { fixture, text } = setup(() => of([CASH]), { setActive });

      await chooseRowAction(fixture, 'Cash on hand', 'Retire');

      expect(text()).toContain('updated by another request');
      expect(text()).toContain('Try again');
    });
  });

  describe('delete', () => {
    it('asks for confirmation and does not call the service until confirmed', async () => {
      const remove = vi.fn(() => of(undefined));
      const { fixture, text } = setup(() => of([CASH]), { remove });

      await chooseRowAction(fixture, 'Cash on hand', 'Delete');

      expect(text()).toContain('This can’t be undone');
      expect(remove).not.toHaveBeenCalled();

      const confirm = Array.from(row(fixture, 'Cash on hand').querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Delete',
      );
      if (!confirm) {
        throw new Error('No delete confirmation button');
      }
      confirm.click();
      expect(remove).toHaveBeenCalledWith(1);
    });

    it('deletes an empty Account and re-reads the list and total', async () => {
      const remove = vi.fn(() => of(undefined));
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of([CASH, BANK]) : of([BANK]);
      });
      const { fixture, text } = setup(list as unknown as AccountsService['all'], { remove });

      await confirmDelete(fixture, 'Cash on hand');

      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).not.toContain('Cash on hand');
      expect(text()).toContain(formatPeso(8500));
    });

    it('explains a delete refused for Transaction history and points at retiring', async () => {
      const remove = vi.fn(() =>
        throwError(
          () =>
            new AccountDeleteBlockedError(
              'transaction-history',
              'This account has transaction history and cannot be deleted.',
            ),
        ),
      );
      const { fixture, text } = setup(() => of([CASH]), { remove });

      await confirmDelete(fixture, 'Cash on hand');

      expect(text()).toContain('transaction history');
      expect(text()).toContain('Retire instead');
      expect(text()).toContain('Retire instead');
    });

    it('explains a delete refused for Goal earmarks and links to Goals', async () => {
      const remove = vi.fn(() =>
        throwError(
          () =>
            new AccountDeleteBlockedError(
              'goal-allocation',
              'This account contains funds allocated toward a specific goal.',
            ),
        ),
      );
      const { fixture, text } = setup(() => of([CASH]), { remove });

      await confirmDelete(fixture, 'Cash on hand');

      expect(text()).toContain(
        'This Account can’t be deleted while Contributions earmark money in it. Remove those Contributions or delete their Goals, then try again.',
      );
      expect(text()).not.toContain('allocated toward a specific goal');
      expect(text()).not.toContain('transaction history');
      expect(text()).not.toContain('Retire instead');
      const viewGoals = [...fixture.nativeElement.querySelectorAll('a')].find(
        (element: HTMLAnchorElement) => element.textContent?.trim() === 'View goals',
      ) as HTMLAnchorElement | undefined;
      expect(viewGoals?.getAttribute('href')).toBe('/app/goals');
    });

    it('reports a delete that lost a concurrency race and offers a retry', async () => {
      const remove = vi.fn(() =>
        throwError(() => new AccountModifiedError('This account was updated by another request. Please try again.')),
      );
      const { fixture, text } = setup(() => of([CASH]), { remove });

      await confirmDelete(fixture, 'Cash on hand');

      expect(text()).toContain('updated by another request');
      expect(text()).toContain('Try again');
      expect(text()).not.toContain('Retire instead');
    });
  });
});
