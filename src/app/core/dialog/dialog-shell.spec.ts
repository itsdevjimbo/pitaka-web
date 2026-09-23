import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { NavigationStart, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { provideIcons } from '@/app/core/icons';
import { DialogShell } from './dialog-shell';

@Component({
  imports: [DialogShell],
  template: `
    <app-dialog-shell heading="Rename account">
      <p>projected body</p>
    </app-dialog-shell>
  `,
})
class Host {}

@Component({
  imports: [DialogShell],
  template: `
    <app-dialog-shell
      heading="Rename account"
      [dirty]="true"
    >
      <p>changed form</p>
    </app-dialog-shell>
  `,
})
class DirtyHost {}

@Component({
  imports: [DialogShell],
  template: `
    <app-dialog-shell heading="Rename account">
      <form class="ng-dirty"><input /></form>
    </app-dialog-shell>
  `,
})
class NativeDirtyHost {}

@Component({
  imports: [DialogShell],
  template: `
    <app-dialog-shell
      heading="Rename account"
      [pending]="true"
    >
      <p>saving form</p>
    </app-dialog-shell>
  `,
})
class PendingHost {}

describe('DialogShell', () => {
  const keydown = new Subject<KeyboardEvent>();
  let close: ReturnType<typeof vi.fn>;
  let abortNavigation: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let routerEvents: Subject<NavigationStart>;

  function routerProvider() {
    abortNavigation = vi.fn();
    navigateByUrl = vi.fn();
    routerEvents = new Subject<NavigationStart>();
    return {
      provide: Router,
      useValue: {
        events: routerEvents.asObservable(),
        currentNavigation: () => ({ abort: abortNavigation }),
        navigateByUrl,
      },
    };
  }

  function setup() {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideIcons(),
        routerProvider(),
        {
          provide: MatDialogRef,
          useValue: { afterOpened: () => of(undefined), close, keydownEvents: () => keydown.asObservable() },
        },
      ],
    });

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return {
      fixture,
      host: fixture.nativeElement as HTMLElement,
    };
  }

  function setupHost(component: typeof DirtyHost | typeof NativeDirtyHost | typeof PendingHost) {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideIcons(),
        routerProvider(),
        {
          provide: MatDialogRef,
          useValue: { afterOpened: () => of(undefined), close, keydownEvents: () => keydown.asObservable() },
        },
      ],
    });
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('shows the heading it was given and the content projected into it', () => {
    const { host } = setup();

    expect(host.querySelector('h2')?.textContent).toContain('Rename account');
    expect(host.textContent).toContain('projected body');
  });

  it('offers one close control, labelled for assistive tech', () => {
    const { host } = setup();

    const closeButton = host.querySelector('button[aria-label="Close"]');
    expect(closeButton).not.toBeNull();
  });

  it('closes the dialog when its close control is pressed', () => {
    const { host } = setup();

    host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog on Escape', () => {
    setup();

    keydown.next(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape held with a modifier, and other keys', () => {
    setup();

    keydown.next(new KeyboardEvent('keydown', { key: 'Escape', altKey: true }));
    keydown.next(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(close).not.toHaveBeenCalled();
  });

  it('asks before discarding a changed editor and initially focuses Keep editing', async () => {
    const { fixture, host } = setupHost(DirtyHost);
    navigateByUrl.mockImplementation((url: string) => {
      routerEvents.next(new NavigationStart(9, url));
      return Promise.resolve(true);
    });

    host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Discard changes?');
    const keepEditing = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Keep editing',
    );
    expect(document.activeElement).toBe(keepEditing);
  });

  it('recognizes Angular dirty forms without per-dialog wiring', () => {
    const { fixture, host } = setupHost(NativeDirtyHost);

    host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Discard changes?');
  });

  it('blocks ordinary dismissal while an editor is saving', () => {
    const { fixture, host } = setupHost(PendingHost);

    keydown.next(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Saving in progress');
  });

  it('asks before dirty app navigation and resumes the destination only after discard', async () => {
    const { fixture, host } = setupHost(DirtyHost);

    routerEvents.next(new NavigationStart(7, '/app/goals'));
    fixture.detectChanges();

    expect(abortNavigation).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Discard changes?');

    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Discard changes')
      ?.click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledOnce();
    expect(navigateByUrl).toHaveBeenCalledWith('/app/goals');
    expect(abortNavigation).toHaveBeenCalledOnce();
  });

  it('closes an untouched editor when app navigation starts', () => {
    setup();

    routerEvents.next(new NavigationStart(8, '/app/accounts'));

    expect(abortNavigation).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('blocks app navigation while a save is pending', () => {
    const { fixture, host } = setupHost(PendingHost);

    routerEvents.next(new NavigationStart(10, '/app/goals'));
    fixture.detectChanges();

    expect(abortNavigation).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Saving in progress');
  });
});
