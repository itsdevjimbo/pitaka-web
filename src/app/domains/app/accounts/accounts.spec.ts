import { Signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { Account } from './account';
import {
  AccountDeleteBlockedError,
  AccountModifiedError,
} from './account-errors';
import Accounts from './accounts';
import { AccountsService } from './accounts.service';

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
  startRename(account: Account): void;
  onRenamed(): void;
  toggleActive(account: Account): void;
  askDelete(account: Account): void;
  confirmDelete(account: Account): void;
  cancelDelete(): void;
  readonly renamingId: Signal<number | null>;
  readonly confirmingDeleteId: Signal<number | null>;
  readonly busyId: Signal<number | null>;
  readonly notice: Signal<RowNotice | null>;
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

describe('Accounts', () => {
  function setup(
    list: AccountsService['list'],
    overrides: Partial<AccountsService> = {}
  ) {
    TestBed.configureTestingModule({
      imports: [Accounts],
      providers: [
        provideIcons(),
        { provide: AccountsService, useValue: { list, ...overrides } },
      ],
    });

    const fixture = TestBed.createComponent(Accounts);
    const cmp = fixture.componentInstance as unknown as AccountsInternals;
    fixture.detectChanges();

    return {
      fixture,
      cmp,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    };
  }

  function clickButton(fixture: ComponentFixture<Accounts>, label: string) {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    ).find((element) => (element.textContent ?? '').includes(label));
    if (!button) {
      throw new Error(`No button labelled "${label}"`);
    }
    button.click();
    fixture.detectChanges();
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

  describe('rename', () => {
    it('opens an inline editor for the row and closes it on cancel', () => {
      const { fixture, cmp, text } = setup(() => of([CASH, BANK]));

      cmp.startRename(CASH);
      fixture.detectChanges();

      expect(cmp.renamingId()).toBe(1);
      expect(text()).toContain('Save');

      clickButton(fixture, 'Cancel');
      expect(cmp.renamingId()).toBeNull();
    });

    it('re-reads the list once a rename saved, so the new name shows everywhere', () => {
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1
          ? of([CASH, BANK])
          : of([{ ...CASH, name: 'Everyday cash' }, BANK]);
      });
      const { fixture, cmp, text } = setup(
        list as unknown as AccountsService['list']
      );

      cmp.startRename(CASH);
      cmp.onRenamed();
      fixture.detectChanges();

      expect(list).toHaveBeenCalledTimes(2);
      expect(cmp.renamingId()).toBeNull();
      expect(text()).toContain('Everyday cash');
      expect(text()).not.toContain('Cash on hand');
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
