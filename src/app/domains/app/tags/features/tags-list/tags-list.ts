import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  Signal,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  disabled,
  form,
  FormField,
  maxLength,
  PathKind,
  SchemaPath,
  SchemaPathRules,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { NavigationStart, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { focusFirstInvalidField, partitionServerError } from '@/app/core/forms';
import { ResourceState, RowNotice } from '@/app/core/notices';
import { SIGN_IN_REASON_PARAM, SIGN_IN_ROUTE } from '@/app/core/session';
import { Tag } from '../../data/tag';
import { TagUnavailableError } from '../../data/tag-errors';
import { TagsService } from '../../data/tags.service';

/** The longest a Tag name may be — mirrors the API's `[MaxLength(255)]`. */
const NAME_MAX = 255;

const LOAD_FAILED = 'Something went wrong loading your tags. Please try again.';
const REFRESH_FAILED = 'Your change was saved, but this list may be out of date. Refresh before making another change.';
const READ_FAILED = 'This list may be out of date. Refresh before making another change.';
const CREATE_FAILED = 'Something went wrong adding the tag. Please try again.';
const RENAME_FAILED = 'Something went wrong renaming the tag. Please try again.';
const ACTION_FAILED = 'Something went wrong. Please try again.';
type RefreshFailure = { message: string; writeSucceeded: boolean };
type RowNoticeState = { id: number; message: string; retry: () => void };

/** Manage the person's Tags: one searchable list, inline creation and renaming, and deletion. */
@Component({
  selector: 'tags-list',
  templateUrl: './tags-list.html',
  imports: [FormField, MatButtonModule, MatIconModule, MatMenuModule, ResourceState, RowNotice],
  host: {
    class: 'flex flex-auto flex-col',
  },
})
export default class TagsList {
  private service = inject(TagsService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private router = inject(Router);

  protected readonly fieldClass =
    'min-h-12 w-full min-w-0 rounded-xl border border-divider bg-surface py-2 pr-3 pl-11 text-base text-text placeholder:text-secondary focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:outline-none dark:focus-visible:ring-primary-200';

  protected readonly tags = signal<readonly Tag[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshing = signal(false);
  protected readonly refreshError = signal<RefreshFailure | null>(null);
  protected readonly staleMessage = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly addModel = signal({ name: '' });
  protected readonly editModel = signal({ name: '' });
  protected readonly adding = signal(false);
  protected readonly busyId = signal<number | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly confirmingDeleteId = signal<number | null>(null);
  protected readonly confirmingRenameDiscard = signal(false);
  protected readonly confirmingNavigationDiscard = signal(false);
  protected readonly navigationMessage = signal<string | null>(null);
  protected readonly notice = signal<RowNoticeState | null>(null);
  protected readonly successMessage = signal<string | null>(null);

  private successTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly addForm = form(this.addModel, (path) => {
    applyTagNameValidation(path.name);
    disabled(path.name, { when: () => this.writesBlocked() });
  });

  protected readonly editForm = form(this.editModel, (path) => {
    applyTagNameValidation(path.name);
    disabled(path.name, { when: () => this.writesBlocked() });
  });

  protected readonly addErrorMessage = linkedSignal<{ name: string }, string | null>({
    source: this.addModel,
    computation: () => null,
  });
  protected readonly editErrorMessage = linkedSignal<{ name: string }, string | null>({
    source: this.editModel,
    computation: () => null,
  });

  private readonly sorted = computed(() =>
    [...(this.tags() ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  );
  protected readonly trimmedSearch = computed(() => this.search().trim());
  protected readonly visible = computed(() => {
    const query = this.trimmedSearch().toLocaleLowerCase();
    if (!query) {
      return this.sorted();
    }
    return this.sorted().filter((tag) => tag.name.toLocaleLowerCase().includes(query));
  });
  protected readonly hasTags = computed(() => this.sorted().length > 0);
  protected readonly count = computed(() => this.sorted().length);
  protected readonly hasSearch = computed(() => this.trimmedSearch().length > 0);
  protected readonly noMatch = computed(() => this.hasSearch() && this.visible().length === 0);
  protected readonly addDirty = computed(() => this.addModel().name.length > 0);
  private readonly editingTag = computed(() => (this.tags() ?? []).find((tag) => tag.id === this.editingId()) ?? null);
  protected readonly editDirty = computed(() => {
    const tag = this.editingTag();
    return tag !== null && this.editModel().name !== tag.name;
  });
  protected readonly hasUnsavedChanges = computed(() => this.addDirty() || this.editDirty());
  protected readonly writesBlocked = computed(
    () => this.refreshing() || this.refreshError() !== null || this.adding() || this.busyId() !== null,
  );
  protected readonly searchDisabled = computed(
    () => this.editingId() !== null || this.confirmingDeleteId() !== null || this.writesBlocked(),
  );

  private readonly addInput = viewChild<ElementRef<HTMLInputElement>>('addInput');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');

  private readVersion = 0;
  private pendingNavigationUrl: string | null = null;
  private resumedNavigationUrl: string | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.successTimer) {
        clearTimeout(this.successTimer);
      }
    });
    this.load();
    this.router.events
      .pipe(
        filter((event): event is NavigationStart => event instanceof NavigationStart),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => this.protectNavigation(event));
  }

  /** Read the whole set cold. Bound to the failed initial-load retry. */
  protected load(): void {
    const version = ++this.readVersion;
    this.loading.set(true);
    this.errorMessage.set(null);
    this.refreshError.set(null);
    this.staleMessage.set(null);

    this.service
      .readAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => {
          if (version !== this.readVersion) {
            return;
          }
          const firstLoad = this.tags() === null;
          this.tags.set(tags);
          this.loading.set(false);
          if (firstLoad && tags.length === 0) {
            this.focusAfterRender(this.addInput);
          }
        },
        error: (error: unknown) => {
          if (version !== this.readVersion) {
            return;
          }
          this.errorMessage.set(error instanceof ApiError ? error.message : LOAD_FAILED);
          this.loading.set(false);
        },
      });
  }

  protected retryRefresh(): void {
    const writeSucceeded = this.refreshError()?.writeSucceeded ?? true;
    this.readAfterWrite(writeSucceeded);
  }

  protected onSearch(value: string): void {
    this.search.set(value);
  }

  protected clearSearch(): void {
    this.search.set('');
  }

  protected createTag(event: Event): void {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;

    submit(this.addForm, {
      action: async () => {
        if (this.writesBlocked()) {
          return undefined;
        }

        const name = this.addModel().name.trim();
        this.adding.set(true);
        this.navigationMessage.set(null);
        this.addErrorMessage.set(null);

        try {
          await firstValueFrom(this.service.create(name).pipe(takeUntilDestroyed(this.destroyRef)));
          this.addForm().reset({ name: '' });
          this.revealTag(name);
          this.readAfterWrite(true, 'add', () => this.announceSuccess(`Tag “${name}” added.`));
          return undefined;
        } catch (error) {
          const { boundErrors: serverErrors, bannerMessage } = partitionServerError(
            error,
            { name: this.addForm.name },
            CREATE_FAILED,
          );
          if (serverErrors.length > 0) {
            this.addForm().markAsTouched();
            this.focusAfterRender(this.addInput);
          }
          if (bannerMessage !== null) {
            this.addErrorMessage.set(bannerMessage);
          }
          return serverErrors.length > 0 ? serverErrors : undefined;
        } finally {
          this.adding.set(false);
          this.finishBlockedNavigationMessage();
        }
      },
    });

    if (this.addForm().invalid()) {
      this.addForm().markAsTouched();
      focusFirstInvalidField(formElement);
    }
  }

  protected startRename(tag: Tag): void {
    if (this.writesBlocked()) {
      return;
    }
    this.notice.set(null);
    this.confirmingDeleteId.set(null);
    this.confirmingRenameDiscard.set(false);
    this.editErrorMessage.set(null);
    this.staleMessage.set(null);
    this.editForm().reset({ name: tag.name });
    this.editingId.set(tag.id);
    this.focusAfterRender(this.editInput);
  }

  protected requestCancelRename(event?: Event): void {
    event?.preventDefault();
    if (this.editDirty()) {
      this.confirmingRenameDiscard.set(true);
      const id = this.editingId();
      if (id !== null) {
        this.focusById(`keep-editing-rename-tag-${id}`);
      }
      return;
    }
    this.closeRename(true);
  }

  protected keepRename(): void {
    this.confirmingRenameDiscard.set(false);
    this.focusAfterRender(this.editInput);
  }

  protected discardRename(): void {
    const id = this.editingId();
    this.closeRename(false);
    if (id !== null) {
      this.focusRowAction(id);
    }
  }

  protected renameTag(tag: Tag, event: Event): void {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;

    submit(this.editForm, {
      action: async () => {
        if (this.editingId() !== tag.id || this.writesBlocked()) {
          return undefined;
        }

        const name = this.editModel().name.trim();
        if (name === tag.name) {
          this.closeRename(false);
          this.focusRowAction(tag.id);
          return undefined;
        }

        this.busyId.set(tag.id);
        this.navigationMessage.set(null);
        this.editErrorMessage.set(null);

        try {
          await firstValueFrom(this.service.rename(tag.id, name).pipe(takeUntilDestroyed(this.destroyRef)));
          this.closeRename(false);
          this.revealTag(name);
          this.readAfterWrite(true, tag.id, () => this.announceSuccess(`Tag “${name}” renamed.`));
          return undefined;
        } catch (error) {
          if (this.isStale(error)) {
            this.closeRename(false);
            this.goStale(tag.id);
            return undefined;
          }
          const { boundErrors: serverErrors, bannerMessage } = partitionServerError(
            error,
            { name: this.editForm.name },
            RENAME_FAILED,
          );
          if (serverErrors.length > 0) {
            this.editForm().markAsTouched();
            this.focusAfterRender(this.editInput);
          }
          if (bannerMessage !== null) {
            this.editErrorMessage.set(bannerMessage);
          }
          return serverErrors.length > 0 ? serverErrors : undefined;
        } finally {
          this.busyId.set(null);
          this.finishBlockedNavigationMessage();
        }
      },
    });

    if (this.editForm().invalid()) {
      this.editForm().markAsTouched();
      focusFirstInvalidField(formElement);
    }
  }

  protected askDelete(tag: Tag): void {
    if (this.writesBlocked()) {
      return;
    }
    this.notice.set(null);
    this.staleMessage.set(null);
    this.confirmingDeleteId.set(tag.id);
    this.focusById(`cancel-delete-tag-${tag.id}`);
  }

  protected cancelDelete(tag: Tag): void {
    this.confirmingDeleteId.set(null);
    this.focusRowAction(tag.id);
  }

  protected confirmDelete(tag: Tag): void {
    if (this.writesBlocked()) {
      return;
    }
    const previousVisible = this.visible();
    const deletedIndex = previousVisible.findIndex((item) => item.id === tag.id);
    const nextFocusId = previousVisible[deletedIndex + 1]?.id ?? previousVisible[deletedIndex - 1]?.id ?? null;
    this.confirmingDeleteId.set(null);
    this.notice.set(null);
    this.busyId.set(tag.id);
    this.navigationMessage.set(null);

    this.service
      .remove(tag.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.readAfterWrite(true, nextFocusId, () => this.announceSuccess(`Tag “${tag.name}” deleted.`));
        },
        error: (error: unknown) => {
          this.busyId.set(null);
          this.finishBlockedNavigationMessage();
          if (this.isStale(error)) {
            this.goStale(nextFocusId);
          } else {
            this.notice.set({
              id: tag.id,
              message: error instanceof ApiError ? error.message : ACTION_FAILED,
              retry: () => this.confirmDelete(tag),
            });
            this.focusRowAction(tag.id);
          }
        },
      });
  }

  protected keepNavigation(): void {
    this.pendingNavigationUrl = null;
    this.confirmingNavigationDiscard.set(false);
    this.focusAfterRender(this.editingId() === null ? this.addInput : this.editInput);
  }

  protected discardAndNavigate(): void {
    const destination = this.pendingNavigationUrl;
    this.pendingNavigationUrl = null;
    this.confirmingNavigationDiscard.set(false);
    this.closeRename(false);
    this.addForm().reset({ name: '' });
    if (destination !== null) {
      this.resumedNavigationUrl = destination;
      queueMicrotask(() => void this.router.navigateByUrl(destination));
    }
  }

  private closeRename(focus: boolean): void {
    const id = this.editingId();
    this.editingId.set(null);
    this.confirmingRenameDiscard.set(false);
    this.editErrorMessage.set(null);
    this.editForm().reset({ name: '' });
    if (focus && id !== null) {
      this.focusRowAction(id);
    }
  }

  private readAfterWrite(
    writeSucceeded: boolean,
    focusTarget: number | 'add' | null = null,
    onSuccess?: () => void,
  ): void {
    const version = ++this.readVersion;
    this.refreshing.set(true);
    this.refreshError.set(null);

    this.service
      .readAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => {
          if (version !== this.readVersion) {
            return;
          }
          this.tags.set(tags);
          this.refreshing.set(false);
          this.refreshError.set(null);
          onSuccess?.();
          this.focusAfterRead(focusTarget);
        },
        error: () => {
          if (version !== this.readVersion) {
            return;
          }
          this.refreshing.set(false);
          this.refreshError.set({ message: writeSucceeded ? REFRESH_FAILED : READ_FAILED, writeSucceeded });
          this.focusAfterRead(focusTarget);
        },
      });
  }

  private goStale(focusTagId: number | null): void {
    this.notice.set(null);
    this.editingId.set(null);
    this.confirmingDeleteId.set(null);
    this.staleMessage.set('That tag is no longer there.');
    this.readAfterWrite(false, focusTagId);
  }

  private isStale(error: unknown): boolean {
    return error instanceof TagUnavailableError;
  }

  private protectNavigation(event: NavigationStart): void {
    if (event.url === this.resumedNavigationUrl) {
      this.resumedNavigationUrl = null;
      this.navigationMessage.set(null);
      return;
    }
    const navigation = this.router.currentNavigation();
    if (!navigation) {
      return;
    }
    if (this.isSessionExpiryRedirect(event.url)) {
      this.discardDrafts();
      this.navigationMessage.set(null);
      return;
    }
    if (this.adding() || this.busyId() !== null) {
      navigation.abort();
      this.navigationMessage.set('A tag change is saving. Wait for it to finish before leaving.');
      return;
    }
    if (this.hasUnsavedChanges()) {
      this.navigationMessage.set(null);
      navigation.abort();
      this.pendingNavigationUrl = event.url;
      this.confirmingNavigationDiscard.set(true);
      this.focusById('keep-navigation-editing');
      return;
    }
    this.navigationMessage.set(null);
  }

  private isSessionExpiryRedirect(url: string): boolean {
    return (
      url.split('?')[0] === SIGN_IN_ROUTE &&
      this.router.parseUrl(url).queryParams[SIGN_IN_REASON_PARAM] === 'session-expired'
    );
  }

  private discardDrafts(): void {
    this.pendingNavigationUrl = null;
    this.confirmingNavigationDiscard.set(false);
    this.closeRename(false);
    this.addForm().reset({ name: '' });
  }

  private revealTag(name: string): void {
    const query = this.trimmedSearch().toLocaleLowerCase();
    if (query && !name.toLocaleLowerCase().includes(query)) {
      this.search.set('');
    }
  }

  private announceSuccess(message: string): void {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
    }
    this.successMessage.set(message);
    this.successTimer = setTimeout(() => {
      this.successMessage.set(null);
      this.successTimer = null;
    }, 5_000);
  }

  private finishBlockedNavigationMessage(): void {
    if (this.navigationMessage() !== null) {
      this.navigationMessage.set('The tag action finished. You can leave this page now.');
    }
  }

  private focusAfterRead(target: number | 'add' | null): void {
    if (target === 'add') {
      this.focusAddInput();
    } else if (target !== null) {
      this.focusRowAction(target);
    } else if (this.hasTags()) {
      this.focusAfterRender(this.searchInput);
    } else {
      this.focusAddInput();
    }
  }

  private focusAddInput(): void {
    afterNextRender(
      () => {
        if (this.refreshError() !== null) {
          this.host.nativeElement.querySelector<HTMLButtonElement>('#retry-tags-refresh')?.focus();
          return;
        }
        this.addInput()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  private focusRowAction(id: number): void {
    afterNextRender(
      () => {
        const target = this.host.nativeElement.querySelector<HTMLButtonElement>(`#tag-actions-${id}`);
        if (target && !target.disabled) {
          target.focus();
        } else if (this.refreshError() !== null) {
          this.host.nativeElement.querySelector<HTMLButtonElement>('#retry-tags-refresh')?.focus();
        } else if (this.hasTags()) {
          this.searchInput()?.nativeElement.focus();
        } else {
          this.addInput()?.nativeElement.focus();
        }
      },
      { injector: this.injector },
    );
  }

  private focusById(id: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${id}`)?.focus(), {
      injector: this.injector,
    });
  }

  private focusAfterRender<T extends HTMLElement>(ref: Signal<ElementRef<T> | undefined>): void {
    afterNextRender(() => ref()?.nativeElement?.focus(), { injector: this.injector });
  }
}

function applyTagNameValidation<TPathKind extends PathKind = PathKind.Root>(
  name: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
): void {
  validate(name, (context) =>
    context.value().trim() ? undefined : { kind: 'required', message: 'Enter a tag name.' },
  );
  maxLength(name, NAME_MAX, { message: `A tag name must be ${NAME_MAX} characters or fewer.` });
}
