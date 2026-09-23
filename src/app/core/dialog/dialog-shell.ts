import { hasModifierKey } from '@angular/cdk/keycodes';
import { Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * The frame every app dialog renders inside. It supplies the chrome the dialogs
 * share — one heading, wired to the panel's `aria-labelledby`, and one close
 * control — and projects the dialog's own content (a form, usually) beneath it.
 *
 * It also puts Escape back. The app turns Material's close-on-Escape off
 * wholesale (`provideDialogDefaults`) because that is the only switch that also
 * makes a backdrop click inert, and a stray click must not discard a half-typed
 * form. Escape must still close the dialog — it is the exit keyboard and
 * screen-reader users rely on — so the shell listens for it on the dialog's own
 * key events. See ADR 0013.
 */
@Component({
  selector: 'app-dialog-shell',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="flex items-start justify-between gap-x-4 p-4 sm:p-6">
      <h2
        mat-dialog-title
        class="text-lg font-semibold tracking-tight"
      >
        {{ heading() }}
      </h2>
      <button
        matIconButton
        type="button"
        aria-label="Close"
        (click)="requestClose()"
        #closeButton
      >
        <mat-icon svgIcon="x" />
      </button>
    </div>

    <mat-dialog-content>
      <ng-content />

      @if (confirmingDiscard()) {
        <section
          class="mt-4 rounded-2xl bg-warning-container p-4 text-warning"
          role="alertdialog"
          aria-labelledby="discard-heading"
        >
          <h3
            id="discard-heading"
            class="text-base"
          >
            Discard changes?
          </h3>
          <p class="mt-1 text-sm">Your changes will not be saved.</p>
          <div class="mt-4 flex justify-end gap-3">
            <button
              matButton
              class="min-h-11"
              type="button"
              (click)="keepEditing()"
              #keepEditingButton
            >
              Keep editing
            </button>
            <button
              matButton="filled"
              class="min-h-11"
              type="button"
              (click)="discard()"
            >
              Discard changes
            </button>
          </div>
        </section>
      }

      @if (pendingFeedback()) {
        <p
          class="mt-4 rounded-2xl bg-soft p-4 text-sm text-text"
          role="status"
        >
          Saving in progress. Wait for it to finish before closing.
        </p>
      }
    </mat-dialog-content>
  `,
})
export class DialogShell {
  // Dependencies
  private dialogRef = inject<MatDialogRef<unknown>>(MatDialogRef);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private router = inject(Router);

  /** The dialog's title, announced with it and shown at the top of the panel. */
  readonly heading = input.required<string>();
  /** Explicit dirty state for non-form editors; Angular dirty forms are detected automatically. */
  readonly dirty = input(false);
  readonly pending = input(false);

  protected readonly confirmingDiscard = signal(false);
  protected readonly pendingFeedback = signal(false);
  private readonly closeButton = viewChild('closeButton', { read: ElementRef<HTMLButtonElement> });
  private readonly keepEditingButton = viewChild('keepEditingButton', { read: ElementRef<HTMLButtonElement> });
  private pendingNavigationUrl: string | null = null;
  private resumedNavigationUrl: string | null = null;

  constructor() {
    this.dialogRef
      .afterOpened()
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.host.nativeElement.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus());
    this.dialogRef
      .keydownEvents()
      .pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event.key === 'Escape' && !hasModifierKey(event)) {
          event.preventDefault();
          this.requestClose();
        }
      });
    this.router.events
      .pipe(
        filter((event): event is NavigationStart => event instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.requestNavigation(event));
  }

  requestClose(): void {
    if (this.pending()) {
      this.pendingFeedback.set(true);
      return;
    }
    if (this.hasChanges()) {
      this.confirmingDiscard.set(true);
      queueMicrotask(() => this.keepEditingButton()?.nativeElement.focus());
      return;
    }
    this.dialogRef.close();
  }

  protected keepEditing(): void {
    this.pendingNavigationUrl = null;
    this.confirmingDiscard.set(false);
    queueMicrotask(() => this.closeButton()?.nativeElement.focus());
  }

  protected discard(): void {
    const destination = this.pendingNavigationUrl;
    this.pendingNavigationUrl = null;
    this.dialogRef.close();
    if (destination) {
      this.resumedNavigationUrl = destination;
      queueMicrotask(() => void this.router.navigateByUrl(destination));
    }
  }

  private requestNavigation(event: NavigationStart): void {
    if (event.url === this.resumedNavigationUrl) {
      this.resumedNavigationUrl = null;
      return;
    }
    const navigation = this.router.currentNavigation();
    if (!navigation) {
      return;
    }
    if (this.pending()) {
      navigation.abort();
      this.pendingFeedback.set(true);
      return;
    }
    if (this.hasChanges()) {
      navigation.abort();
      this.pendingNavigationUrl = event.url;
      this.confirmingDiscard.set(true);
      queueMicrotask(() => this.keepEditingButton()?.nativeElement.focus());
      return;
    }
    this.dialogRef.close();
  }

  private hasChanges(): boolean {
    return Boolean(this.dirty() || this.host.nativeElement.querySelector('form.ng-dirty, [data-editor-dirty="true"]'));
  }
}
