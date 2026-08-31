import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';

/**
 * Reach the CDK overlay container — the detached element dialogs, menus and
 * other popups render into — and guarantee it is removed after every test in
 * the enclosing `describe`, so a dialog one spec left open cannot leak its DOM
 * (or its focus trap) into the next.
 *
 * A spec-support seam alongside `withPinnedTimezone` and `TEST_API_BASE_URL`:
 * call it once per `describe` and use the returned getter inside a test to read
 * what is currently on screen in the overlay.
 *
 * ```ts
 * const overlay = withOverlayContainer();
 * // ...
 * expect(overlay().textContent).toContain('New account');
 * ```
 */
export function withOverlayContainer(): () => HTMLElement {
  afterEach(() => {
    // `ngOnDestroy` detaches the container element and drops the cached
    // reference, so the next test's first overlay builds a fresh one.
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  return () => TestBed.inject(OverlayContainer).getContainerElement();
}

/**
 * Send the Escape keydown a dialog listens for. Dispatched on `document.body`
 * rather than a specific element because `DialogShell` subscribes through the
 * `MatDialogRef`'s own key-event stream, which is document-scoped.
 */
export function pressEscape(): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
}
