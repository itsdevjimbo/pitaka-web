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

    host
      .querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
      .click();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog on Escape', () => {
    setup();

    keydown.next(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape held with a modifier, and other keys', () => {
    setup();

    keydown.next(
      new KeyboardEvent('keydown', { key: 'Escape', altKey: true })
    );
    keydown.next(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(close).not.toHaveBeenCalled();
  });
});
