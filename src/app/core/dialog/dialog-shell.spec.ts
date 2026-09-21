import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
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

  function setup() {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideIcons(),
        {
          provide: MatDialogRef,
          useValue: { close, keydownEvents: () => keydown.asObservable() },
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
        {
          provide: MatDialogRef,
          useValue: { close, keydownEvents: () => keydown.asObservable() },
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
});
