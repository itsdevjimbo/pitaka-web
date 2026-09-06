import { Provider, Signal, signal, WritableSignal } from '@angular/core';
import { Media } from '@/app/core/media';

/**
 * A {@link Media} stand-in for tests. The real one reaches through the CDK's
 * `MediaMatcher` to `window.matchMedia`, which the jsdom test environment does
 * not implement — so any component that injects {@link Media} needs this in its
 * `TestBed`.
 *
 * Every query is answered from one writable signal, {@link FakeMedia.matches}
 * — enough for a component that watches a single breakpoint. Flip it to move
 * the viewport across that breakpoint mid-test:
 *
 * ```ts
 * const media = new FakeMedia(true); // start below the breakpoint
 * // ...provide it, render...
 * media.matches.set(false); // grow past it
 * fixture.detectChanges();
 * ```
 */
export class FakeMedia {
  readonly matches: WritableSignal<boolean>;

  constructor(initial = false) {
    this.matches = signal(initial);
  }

  match(): Signal<boolean> {
    return this.matches.asReadonly();
  }
}

/**
 * Provide a {@link FakeMedia} for {@link Media}. Pass the initial match state;
 * reach the instance back through `TestBed.inject(Media)` when a test needs to
 * change it.
 */
export function provideFakeMedia(initial = false): Provider {
  return { provide: Media, useValue: new FakeMedia(initial) };
}
