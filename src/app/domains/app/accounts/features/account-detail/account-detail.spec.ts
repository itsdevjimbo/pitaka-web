import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MATERIAL_ANIMATIONS,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import {
  Transaction,
  TransactionsService,
} from '@/app/domains/app/transactions';
import { pressEscape, withOverlayContainer } from '@/testing/overlay';
import { Account } from '../../data/account';
import { AccountsService } from '../../data/accounts.service';
import AccountDetail from './account-detail';

/** The slice of the component a few tests reach into. */
type AccountDetailInternals = {
  openRecordDialog(): void;
  openRefileDialog(transaction: Transaction): void;
  onRecorded(): void;
  onRefiled(): void;
  onRemoved(): void;
};

const ACCOUNT: Account = {
  id: 3,
  name: 'Everyday cash',
  type: 'Cash',
  currentBalance: 4200,
  isActive: true,
};

const NAMES = new Map<number, string>([
  [1, 'Groceries'],
  [2, 'Salary'],
]);

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    amount: 120.5,
    direction: 'expense',
    date: new Date('2026-08-29T00:00:00'),
    accountId: 3,
    transferToAccountId: null,
    categoryId: 1,
    generated: false,
    description: null,
    tags: [],
    ...over,
  };
}

describe('AccountDetail', () => {
  const overlay = withOverlayContainer();

  function setup(over: {
    get?: AccountsService['get'];
    accountsList?: AccountsService['list'];
    list?: TransactionsService['list'];
    names?: CategoriesService['names'];
    record?: TransactionsService['record'];
    refile?: TransactionsService['refile'];
    remove?: TransactionsService['remove'];
    categoryList?: CategoriesService['list'];
  }) {
    const get = over.get ?? (() => of(ACCOUNT));
    const accountsList = over.accountsList ?? (() => of([ACCOUNT]));
    const list = over.list ?? (() => of<Transaction[]>([]));
    const names = over.names ?? (() => of(NAMES));
    const record = over.record ?? (() => of({} as Transaction));
    const refile = over.refile ?? (() => of({} as Transaction));
    const remove = over.remove ?? (() => of(undefined));
    const categoryList = over.categoryList ?? (() => of([]));

    TestBed.configureTestingModule({
      imports: [AccountDetail],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        provideRouter([]),
        provideDialogDefaults(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AccountsService, useValue: { get, list: accountsList } },
        {
          provide: TransactionsService,
          useValue: { list, record, refile, remove },
        },
        { provide: CategoriesService, useValue: { names, list: categoryList } },
      ],
    });

    const fixture = TestBed.createComponent(AccountDetail);
    fixture.componentRef.setInput('id', '3');
    fixture.detectChanges();

    return {
      fixture,
      cmp: fixture.componentInstance as unknown as AccountDetailInternals,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      button: (label: string) =>
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button')
        ).find((b) => (b.textContent ?? '').includes(label)),
      dialog: () => overlay().querySelector<HTMLElement>('[role="dialog"]'),
      dialogText: () => overlay().textContent ?? '',
    };
  }

  /** Push change detection through the component and the overlay, and drain microtasks. */
  async function settle(fixture: ComponentFixture<unknown>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Find a button by its trimmed text, anywhere in the open overlay. */
  function overlayButton(label: string): HTMLButtonElement {
    const button = Array.from(
      overlay().querySelectorAll('button')
    ).find((b) => (b.textContent ?? '').trim() === label);
    if (!button) {
      throw new Error(`No overlay button labelled "${label}"`);
    }
    return button;
  }

  function typeIntoOverlay(selector: string, value: string) {
    const input = overlay().querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error(`No overlay input matching "${selector}"`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /** Pick the option with the given text from a `mat-select` in the overlay. */
  async function pickFromSelect(
    fixture: ComponentFixture<unknown>,
    selector: string,
    optionText: string
  ) {
    overlay().querySelector<HTMLElement>(selector)!.click();
    await settle(fixture);
    const option = Array.from(
      overlay().querySelectorAll<HTMLElement>('mat-option')
    ).find((el) => (el.textContent ?? '').trim() === optionText);
    if (!option) {
      throw new Error(`No option "${optionText}" in "${selector}"`);
    }
    option.click();
    await settle(fixture);
  }

  it('shows progress while the load is in flight, then the list', () => {
    const pending = new Subject<Transaction[]>();
    const { fixture, text } = setup({ list: () => pending.asObservable() });

    expect(text()).toContain('Loading transactions…');

    pending.next([tx({ id: 9, description: 'Coffee' })]);
    pending.complete();
    fixture.detectChanges();

    expect(text()).not.toContain('Loading transactions…');
    expect(text()).toContain('Coffee');
  });

  it('heads the page with the Account, its type, and its current balance', () => {
    const { text } = setup({ list: () => of([tx()]) });

    expect(text()).toContain('Everyday cash');
    expect(text()).toContain('Cash');
    expect(text()).toContain(formatPeso(4200));
  });

  it('shows each row with a local date and time, an amount, a direction, and the Category name', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            amount: 120.5,
            categoryId: 1,
            date: new Date('2026-08-29T14:05:00'),
          }),
        ]),
    });

    expect(text()).toContain('29 Aug 2026');
    expect(text()).toContain('2:05');
    expect(text()).toContain('PM');
    expect(text()).toContain(formatPeso(-120.5));
    expect(text()).toContain('Expense');
    expect(text()).toContain('Groceries');
  });

  it('resolves Category names through the shared cache, not once per row', () => {
    const names = vi.fn(() => of(NAMES));
    const { text } = setup({
      names: names as unknown as CategoriesService['names'],
      list: () =>
        of([
          tx({ id: 1, categoryId: 1 }),
          tx({ id: 2, categoryId: 1 }),
          tx({ id: 3, categoryId: 2, direction: 'income' }),
        ]),
    });

    expect(names).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Groceries');
    expect(text()).toContain('Salary');
  });

  it('labels an uncategorised income or expense rather than leaving it blank', () => {
    const { text } = setup({
      list: () => of([tx({ direction: 'expense', categoryId: null })]),
    });

    expect(text()).toContain('Uncategorised');
  });

  it('marks a generated transaction as one, and shows only its wall-clock day', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            generated: true,
            description: 'Rent',
            date: new Date('2026-08-29T00:00:00'),
          }),
        ]),
    });

    expect(text()).toContain('Generated');
    expect(text()).toContain('29 Aug 2026');
    expect(text()).not.toContain('12:00');
  });

  it('tells income and expense apart by sign, not only by a label', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({ id: 1, direction: 'income', amount: 1000, categoryId: 2 }),
          tx({ id: 2, direction: 'expense', amount: 250, categoryId: 1 }),
        ]),
    });

    expect(text()).toContain(`+${formatPeso(1000)}`);
    expect(text()).toContain(formatPeso(-250));
  });

  it('signs a Transfer leaving the viewed Account as outgoing', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            id: 1,
            direction: 'transfer',
            amount: 500,
            accountId: 3, // the Account on screen — the money leaves here
            transferToAccountId: 9,
            categoryId: null,
            description: 'Move to savings',
          }),
        ]),
    });

    expect(text()).toContain('Transfer');
    expect(text()).toContain(formatPeso(-500));
    expect(text()).not.toContain(`+${formatPeso(500)}`);
  });

  it('signs a Transfer arriving in the viewed Account as incoming', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            id: 1,
            direction: 'transfer',
            amount: 500,
            accountId: 9,
            transferToAccountId: 3, // the Account on screen — the money lands here
            categoryId: null,
            description: 'Move from everyday',
          }),
        ]),
    });

    expect(text()).toContain('Transfer');
    expect(text()).toContain(`+${formatPeso(500)}`);
    expect(text()).not.toContain(formatPeso(-500));
  });

  it('names the Account a landed Transfer was recorded against, and links there', () => {
    const { fixture, text } = setup({
      accountsList: () =>
        of([
          ACCOUNT,
          {
            id: 9,
            name: 'Everyday savings',
            type: 'Bank',
            currentBalance: 10000,
            isActive: true,
          } as Account,
        ]),
      list: () =>
        of([
          tx({
            id: 1,
            direction: 'transfer',
            amount: 500,
            accountId: 9, // recorded against another Account…
            transferToAccountId: 3, // …and it landed here
            categoryId: null,
            description: 'Move from savings',
          }),
        ]),
    });

    expect(text()).toContain('Recorded against');
    const link = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('a')
    ).find((a) => (a.textContent ?? '').includes('Everyday savings'));
    expect(link?.getAttribute('href')).toBe('/app/accounts/9');
  });

  it('never heads a Transfer with a Category label, even with no note', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            id: 1,
            direction: 'transfer',
            categoryId: null,
            description: null,
          }),
        ]),
    });

    expect(text()).toContain('Transfer');
    expect(text()).not.toContain('Uncategorised');
  });

  it('shows the Tags on a Transaction', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            description: 'Lunch',
            tags: [
              { id: 1, name: 'work' },
              { id: 2, name: 'reimbursable' },
            ],
          }),
        ]),
    });

    expect(text()).toContain('#work');
    expect(text()).toContain('#reimbursable');
  });

  it('shows an empty state that is not the failed-load state', () => {
    const { fixture, text } = setup({ list: () => of([]) });

    expect(text()).toContain('No transactions yet');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
    ).toBeNull();
  });

  it('explains a failed load and retries from the top when asked', () => {
    let attempt = 0;
    const list = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? throwError(
            () => new ApiError('Something went wrong on the server.', 500)
          )
        : of<Transaction[]>([tx({ description: 'Coffee' })]);
    });
    const { fixture, text } = setup({
      list: list as unknown as TransactionsService['list'],
    });

    expect(text()).toContain('Something went wrong on the server.');

    const retry = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    ).find((b) => (b.textContent ?? '').includes('Try again'));
    retry?.click();
    fixture.detectChanges();

    expect(list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Something went wrong on the server.');
    expect(text()).toContain('Coffee');
  });

  it('drops "Try again" for a 404 and points back to the list instead', () => {
    const { fixture, text } = setup({
      list: () =>
        throwError(
          () =>
            new ApiError(
              "We couldn't find that. It may have been deleted, or it may not be yours.",
              404
            )
        ),
    });

    expect(text()).toContain("We couldn't find that");

    const host = fixture.nativeElement as HTMLElement;
    const retry = Array.from(host.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Try again')
    );
    expect(retry).toBeUndefined();

    const back = Array.from(host.querySelectorAll('a')).find((a) =>
      (a.textContent ?? '').includes('Back to accounts')
    );
    expect(back?.getAttribute('href')).toBe('/app/accounts');
  });

  it('falls back to a plain message when the failure is not an ApiError', () => {
    const { text } = setup({ list: () => throwError(() => new Error('boom')) });

    expect(text()).toContain(
      'Something went wrong loading this account. Please try again.'
    );
  });

  it('opens the record dialog from a control on an active Account, without reflowing the balance or list', async () => {
    const { fixture, text, button, dialog, dialogText } = setup({
      list: () => of([tx({ description: 'Coffee' })]),
    });
    const before = text();

    expect(dialog()).toBeNull();

    button('Record')?.click();
    await settle(fixture);

    expect(dialog()).not.toBeNull();
    expect(dialogText()).toContain('Record a transaction');
    // The screen behind the dialog is untouched — nothing reflowed.
    expect(text()).toContain(before);
  });

  it('offers no record control on a retired Account, and points at reactivating it', () => {
    const { fixture, text, button } = setup({
      get: () => of({ ...ACCOUNT, isActive: false }),
      list: () => of([tx()]),
    });

    expect(button('Record')).toBeUndefined();
    expect(text()).toContain('retired');

    const link = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('a')
    ).find((a) => (a.textContent ?? '').includes('accounts list'));
    expect(link?.getAttribute('href')).toBe('/app/accounts');
  });

  it('re-reads the balance and list in place after a record — no full-page spinner', () => {
    const get = vi
      .fn()
      .mockReturnValueOnce(of(ACCOUNT))
      .mockReturnValueOnce(of({ ...ACCOUNT, currentBalance: 4079.5 }));
    const list = vi
      .fn()
      .mockReturnValueOnce(of<Transaction[]>([]))
      .mockReturnValueOnce(of([tx({ id: 7, description: 'Coffee' })]));
    const names = vi.fn(() => of(NAMES));

    const { fixture, cmp, text } = setup({
      get: get as unknown as AccountsService['get'],
      list: list as unknown as TransactionsService['list'],
      names: names as unknown as CategoriesService['names'],
    });

    cmp.onRecorded();
    fixture.detectChanges();

    expect(get).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);
    expect(names).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Loading transactions…');
    expect(text()).toContain(formatPeso(4079.5));
    expect(text()).toContain('Coffee');
  });

  it('keeps the screen as it was when the post-record re-read fails', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const get = vi
      .fn()
      .mockReturnValueOnce(of(ACCOUNT))
      .mockReturnValueOnce(throwError(() => new Error('offline')));
    const list = vi
      .fn()
      .mockReturnValueOnce(of([tx({ description: 'Lunch' })]))
      .mockReturnValueOnce(throwError(() => new Error('offline')));

    const { fixture, cmp, text } = setup({
      get: get as unknown as AccountsService['get'],
      list: list as unknown as TransactionsService['list'],
    });

    cmp.onRecorded();
    fixture.detectChanges();

    expect(text()).toContain('Lunch');
    expect(text()).not.toContain('Please try again');
    consoleError.mockRestore();
  });

  describe('record, in a dialog', () => {
    const SAVINGS: Account = {
      id: 9,
      name: 'Savings',
      type: 'Bank',
      currentBalance: 10000,
      isActive: true,
    };
    const RETIRED: Account = {
      id: 10,
      name: 'Old wallet',
      type: 'Wallet',
      currentBalance: 0,
      isActive: false,
    };
    const EXPENSE_CATEGORIES: Category[] = [
      { id: 1, name: 'Groceries', kind: 'expense' },
    ];

    async function openRecordDialog(
      fixture: ComponentFixture<unknown>,
      button: (label: string) => HTMLButtonElement | undefined
    ) {
      button('Record')!.click();
      await settle(fixture);
    }

    it('follows the app-wide dialog behaviour — closes on Escape, stays on a backdrop click', async () => {
      const { fixture, button, dialog } = setup({ list: () => of([tx()]) });

      await openRecordDialog(fixture, button);
      expect(dialog()).not.toBeNull();

      overlay().querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
      await settle(fixture);
      expect(dialog()).not.toBeNull();

      pressEscape();
      await settle(fixture);
      expect(dialog()).toBeNull();
    });

    it('moves focus into the dialog on open and back to the opener on close', async () => {
      const { fixture, button, dialog } = setup({ list: () => of([tx()]) });

      const record = button('Record')!;
      record.focus();
      record.click();
      await settle(fixture);

      expect(overlay().contains(document.activeElement)).toBe(true);

      pressEscape();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(record);
    });

    it('hands the form only valid Transfer destinations — the Account in view and retired ones excluded', async () => {
      const { fixture, button } = setup({
        get: () => of(ACCOUNT),
        accountsList: () => of([ACCOUNT, SAVINGS, RETIRED]),
        list: () => of([tx()]),
      });

      await openRecordDialog(fixture, button);

      // Choose Transfer so the destination picker is the field on show.
      overlayButton('Transfer').click();
      await settle(fixture);

      overlay().querySelector<HTMLElement>('mat-select')!.click();
      await settle(fixture);
      const options = Array.from(
        overlay().querySelectorAll<HTMLElement>('mat-option')
      ).map((el) => (el.textContent ?? '').trim());

      expect(options).toEqual(['Savings']);
    });

    it('on a successful record, closes the dialog and re-reads the balance and list (ADR 0006)', async () => {
      const get = vi
        .fn()
        .mockReturnValueOnce(of(ACCOUNT))
        .mockReturnValueOnce(of({ ...ACCOUNT, currentBalance: 4079.5 }));
      const list = vi
        .fn()
        .mockReturnValueOnce(of<Transaction[]>([]))
        .mockReturnValueOnce(of([tx({ id: 7, description: 'Coffee' })]));
      const record = vi.fn(() => of(tx({ id: 7 })));

      const { fixture, button, text, dialog } = setup({
        get: get as unknown as AccountsService['get'],
        list: list as unknown as TransactionsService['list'],
        record: record as unknown as TransactionsService['record'],
        categoryList: () => of(EXPENSE_CATEGORIES),
      });

      await openRecordDialog(fixture, button);
      typeIntoOverlay('#transaction-amount', '120.5');
      await pickFromSelect(fixture, 'mat-select', 'Groceries');
      overlayButton('Record').click();
      await settle(fixture);

      expect(record).toHaveBeenCalledTimes(1);
      expect(dialog()).toBeNull();
      expect(get).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).toContain(formatPeso(4079.5));
      expect(text()).toContain('Coffee');
      expect(text()).not.toContain('Loading transactions…');
    });

    it('on a failed record, leaves the dialog open with the input intact and the reason shown', async () => {
      const record = vi.fn(() => throwError(() => new Error('offline')));
      const list = vi.fn(() => of<Transaction[]>([]));

      const { fixture, button, dialog, dialogText } = setup({
        list: list as unknown as TransactionsService['list'],
        record: record as unknown as TransactionsService['record'],
        categoryList: () => of(EXPENSE_CATEGORIES),
      });

      await openRecordDialog(fixture, button);
      typeIntoOverlay('#transaction-amount', '120.5');
      await pickFromSelect(fixture, 'mat-select', 'Groceries');
      overlayButton('Record').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(
        overlay().querySelector<HTMLInputElement>('#transaction-amount')!.value
      ).toBe('120.5');
      expect(dialogText()).toContain(
        'Something went wrong recording this transaction'
      );
      // A failed record does not re-read.
      expect(list).toHaveBeenCalledTimes(1);
    });

    it('closes with no record on Cancel, without calling the service', async () => {
      const record = vi.fn();
      const { fixture, button, dialog } = setup({
        list: () => of([tx()]),
        record: record as unknown as TransactionsService['record'],
      });

      await openRecordDialog(fixture, button);
      overlayButton('Cancel').click();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe('refile, in a dialog', () => {
    const CATEGORIES: Category[] = [
      { id: 1, name: 'Groceries', kind: 'expense' },
      { id: 2, name: 'Salary', kind: 'income' },
      { id: 3, name: 'Rent', kind: 'expense' },
    ];

    /** A filed, noted, tagged expense — the row the menu's Refile acts on. */
    function filed(over: Partial<Transaction> = {}): Transaction {
      return tx({
        id: 7,
        description: 'Coffee',
        categoryId: 1,
        tags: [{ id: 9, name: 'treats' }],
        date: new Date('2026-08-29T09:30:00'),
        ...over,
      });
    }

    /** Open the row's menu and choose Refile, the way a person would. */
    async function refileFromRowMenu(
      fixture: ComponentFixture<unknown>,
      host: HTMLElement
    ) {
      const trigger = Array.from(host.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-label') === 'Transaction actions'
      );
      trigger!.click();
      await settle(fixture);
      overlayButton('Refile').click();
      await settle(fixture);
    }

    it('opens from the Refile menu entry, seeded with the transaction, and leaves the row legible behind it', async () => {
      const { fixture, text, dialog, dialogText } = setup({
        list: () => of([filed()]),
        categoryList: () => of(CATEGORIES),
      });
      const host = fixture.nativeElement as HTMLElement;
      const before = text();

      expect(dialog()).toBeNull();
      await refileFromRowMenu(fixture, host);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Refile transaction');
      // Seeded from the row's own moment (2026-08-29 09:30), Category, and note.
      expect(
        overlay().querySelector<HTMLInputElement>('#refile-transaction-note')!
          .value
      ).toBe('Coffee');
      expect(dialogText()).toContain('Groceries');
      expect(
        overlay().querySelector<HTMLInputElement>('#refile-transaction-date')!
          .value
      ).toContain('2026');
      expect(
        overlay().querySelector<HTMLInputElement>('#refile-transaction-date')!
          .value
      ).toContain('29');
      expect(
        overlay().querySelector<HTMLInputElement>('#refile-transaction-time')!
          .value
      ).toContain('9:30');
      // The screen behind the dialog is untouched — nothing reflowed.
      expect(text()).toContain(before);
    });

    it('follows the app-wide dialog behaviour — closes on Escape, stays on a backdrop click', async () => {
      const { fixture, cmp, dialog } = setup({ list: () => of([filed()]) });

      cmp.openRefileDialog(filed());
      await settle(fixture);
      expect(dialog()).not.toBeNull();

      overlay().querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
      await settle(fixture);
      expect(dialog()).not.toBeNull();

      pressEscape();
      await settle(fixture);
      expect(dialog()).toBeNull();
    });

    it('moves focus into the dialog on open and back to the opener on close', async () => {
      const { fixture, cmp, dialog } = setup({ list: () => of([filed()]) });
      const host = fixture.nativeElement as HTMLElement;
      const trigger = Array.from(host.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-label') === 'Transaction actions'
      )!;

      trigger.focus();
      cmp.openRefileDialog(filed());
      await settle(fixture);

      expect(overlay().contains(document.activeElement)).toBe(true);

      pressEscape();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('shows the amount and direction as text, not as fields, and still points at removing to fix an amount', async () => {
      const { fixture, cmp, dialogText } = setup({
        list: () => of([filed({ amount: 120.5 })]),
      });

      cmp.openRefileDialog(filed({ amount: 120.5 }));
      await settle(fixture);

      expect(dialogText()).toContain('Expense');
      expect(dialogText()).toContain('120.50');
      expect(overlay().querySelector('input[type="number"]')).toBeNull();
      expect(overlay().querySelector('mat-button-toggle-group')).toBeNull();
      expect(dialogText().toLowerCase()).toContain(
        'remove this transaction and record it again'
      );
    });

    it('offers nothing that removes the transaction', async () => {
      const { fixture, cmp } = setup({ list: () => of([filed()]) });

      cmp.openRefileDialog(filed());
      await settle(fixture);

      const removeButton = Array.from(
        overlay().querySelectorAll('button')
      ).find((b) => (b.textContent ?? '').trim() === 'Remove');
      expect(removeButton).toBeUndefined();
      expect(overlay().querySelector('[aria-label="Confirm remove"]')).toBeNull();
    });

    it('refiles a Transfer from the Account it was recorded against, with no Category field', async () => {
      const transfer = filed({
        direction: 'transfer',
        categoryId: null,
        transferToAccountId: 9,
        description: 'Move to savings',
      });
      const { fixture, cmp, dialog, dialogText } = setup({
        list: () => of([transfer]),
      });

      cmp.openRefileDialog(transfer);
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Transfer');
      expect(overlay().querySelector('mat-select')).toBeNull();
    });

    it('on a successful refile, closes the dialog and re-reads the balance and list (ADR 0006)', async () => {
      const get = vi
        .fn()
        .mockReturnValueOnce(of(ACCOUNT))
        .mockReturnValueOnce(of({ ...ACCOUNT, currentBalance: 4200 }));
      const list = vi
        .fn()
        .mockReturnValueOnce(of([filed({ description: 'Coffee' })]))
        .mockReturnValueOnce(of([filed({ description: 'Flat white' })]));
      const refile = vi.fn(() => of(filed()));

      const { fixture, cmp, text, dialog } = setup({
        get: get as unknown as AccountsService['get'],
        list: list as unknown as TransactionsService['list'],
        refile: refile as unknown as TransactionsService['refile'],
        categoryList: () => of(CATEGORIES),
      });

      cmp.openRefileDialog(filed());
      await settle(fixture);
      overlayButton('Save').click();
      await settle(fixture);

      expect(refile).toHaveBeenCalledTimes(1);
      expect(dialog()).toBeNull();
      expect(get).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).not.toContain('Loading transactions…');
      expect(text()).toContain('Flat white');
    });

    it('fixing the Category alone leaves the note and Tags on the row', async () => {
      const original = filed({ tags: [{ id: 9, name: 'treats' }] });
      const refile = vi.fn(() => of(original));
      // The server re-read after the refile: same note and Tag, new Category.
      const list = vi
        .fn()
        .mockReturnValueOnce(of([original]))
        .mockReturnValueOnce(
          of([filed({ categoryId: 3, tags: [{ id: 9, name: 'treats' }] })])
        );

      const { fixture, cmp, text } = setup({
        refile: refile as unknown as TransactionsService['refile'],
        list: list as unknown as TransactionsService['list'],
        names: () => of(new Map([...NAMES, [3, 'Rent']])),
        categoryList: () => of(CATEGORIES),
      });

      cmp.openRefileDialog(original);
      await settle(fixture);
      await pickFromSelect(fixture, 'mat-select', 'Rent');
      overlayButton('Save').click();
      await settle(fixture);

      // The change went in, and nothing else was quietly dropped.
      expect(refile).toHaveBeenCalledWith(
        original,
        expect.objectContaining({ categoryId: 3 })
      );
      expect(text()).toContain('Rent');
      expect(text()).toContain('Coffee');
      expect(text()).toContain('#treats');
    });

    it('on a failed refile, leaves the dialog open with the input intact and the reason shown', async () => {
      const refile = vi.fn(() => throwError(() => new Error('offline')));
      const list = vi.fn(() => of([filed()]));

      const { fixture, cmp, dialog, dialogText } = setup({
        list: list as unknown as TransactionsService['list'],
        refile: refile as unknown as TransactionsService['refile'],
        categoryList: () => of(CATEGORIES),
      });

      cmp.openRefileDialog(filed());
      await settle(fixture);
      typeIntoOverlay('#refile-transaction-note', 'Flat white');
      await settle(fixture);
      overlayButton('Save').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(
        overlay().querySelector<HTMLInputElement>('#refile-transaction-note')!
          .value
      ).toBe('Flat white');
      expect(dialogText()).toContain(
        'Something went wrong refiling this transaction'
      );
      // A failed refile does not re-read.
      expect(list).toHaveBeenCalledTimes(1);
    });

    it('closes with no refile on Cancel, without calling the service', async () => {
      const refile = vi.fn();
      const { fixture, cmp, dialog } = setup({
        list: () => of([filed()]),
        refile: refile as unknown as TransactionsService['refile'],
      });

      cmp.openRefileDialog(filed());
      await settle(fixture);
      overlayButton('Cancel').click();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(refile).not.toHaveBeenCalled();
    });
  });

  it('re-reads the balance and list in place after a refile, reordering a corrected row — no full-page spinner', () => {
    const get = vi
      .fn()
      .mockReturnValueOnce(of(ACCOUNT))
      .mockReturnValueOnce(of({ ...ACCOUNT, currentBalance: 4200 }));
    const list = vi
      .fn()
      .mockReturnValueOnce(
        of([
          tx({ id: 7, description: 'Coffee', categoryId: 1 }),
          tx({ id: 8, description: 'Lunch', categoryId: 1 }),
        ])
      )
      // The corrected row's new date drops it below Lunch on the server re-read.
      .mockReturnValueOnce(
        of([
          tx({ id: 8, description: 'Lunch', categoryId: 1 }),
          tx({ id: 7, description: 'Coffee', categoryId: 2 }),
        ])
      );
    const names = vi.fn(() => of(NAMES));

    const { fixture, cmp, text } = setup({
      get: get as unknown as AccountsService['get'],
      list: list as unknown as TransactionsService['list'],
      names: names as unknown as CategoriesService['names'],
    });

    cmp.onRefiled();
    fixture.detectChanges();

    expect(get).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Loading transactions…');
    expect(text()).toContain('Salary');
    // Coffee now sits after Lunch — the row moved to where its new date belongs.
    expect(text().indexOf('Lunch')).toBeLessThan(text().indexOf('Coffee'));
  });

  it('re-reads the balance and list in place after a removal — the row is gone, no spinner', () => {
    const get = vi
      .fn()
      .mockReturnValueOnce(of(ACCOUNT))
      .mockReturnValueOnce(of({ ...ACCOUNT, currentBalance: 4320.5 }));
    const list = vi
      .fn()
      .mockReturnValueOnce(
        of([
          tx({ id: 7, description: 'Coffee' }),
          tx({ id: 8, description: 'Lunch' }),
        ])
      )
      .mockReturnValueOnce(of([tx({ id: 8, description: 'Lunch' })]));

    const { fixture, cmp, text } = setup({
      get: get as unknown as AccountsService['get'],
      list: list as unknown as TransactionsService['list'],
    });

    cmp.onRemoved();
    fixture.detectChanges();

    expect(get).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Loading transactions…');
    expect(text()).toContain(formatPeso(4320.5));
    expect(text()).toContain('Lunch');
    expect(text()).not.toContain('Coffee');
  });

  it('drives a removal end to end from the row menu, then re-reads with the row gone', async () => {
    const remove = vi.fn(() => of(undefined));
    const list = vi
      .fn()
      .mockReturnValueOnce(of([tx({ id: 7, description: 'Coffee' })]))
      .mockReturnValueOnce(of<Transaction[]>([]));

    const { fixture, text } = setup({
      list: list as unknown as TransactionsService['list'],
      remove: remove as unknown as TransactionsService['remove'],
    });

    const host = fixture.nativeElement as HTMLElement;
    const menuTrigger = Array.from(host.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Transaction actions'
    );
    menuTrigger?.click();
    fixture.detectChanges();

    Array.from(overlay().querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => (b.textContent ?? '').trim() === 'Remove')
      ?.click();
    fixture.detectChanges();

    Array.from(host.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === 'Remove')
      ?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(remove).toHaveBeenCalledWith(7);
    expect(list).toHaveBeenCalledTimes(2);
    // The list re-reads in place — it never blanks back to the spinner.
    expect(text()).not.toContain('Loading transactions…');
    expect(text()).toContain('No transactions yet');
    expect(text()).not.toContain('Coffee');
  });

  it('offers no actions menu on a Transfer seen from where it landed', () => {
    const { fixture } = setup({
      accountsList: () =>
        of([
          ACCOUNT,
          { id: 9, name: 'Savings', type: 'Bank', currentBalance: 0, isActive: true } as Account,
        ]),
      list: () =>
        of([
          tx({
            id: 1,
            direction: 'transfer',
            accountId: 9,
            transferToAccountId: 3,
            categoryId: null,
            description: 'Move from savings',
          }),
        ]),
    });

    const menuTrigger = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    ).find((b) => b.getAttribute('aria-label') === 'Transaction actions');
    expect(menuTrigger).toBeUndefined();
  });
});
