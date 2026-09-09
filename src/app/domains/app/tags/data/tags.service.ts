import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  catchError,
  map,
  Observable,
  shareReplay,
  tap,
  throwError,
} from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import { Tag } from './tag';

/**
 * Wire shape of one Tag from the API (read 2026-09-08 from `TagsController.cs`,
 * `TagService.cs`, `Models/Tag.cs`). `GET /api/tags` returns a collection of
 * these — the person's own Tags, nothing seeded — and `POST` and `PUT /{id}`
 * each return one. It is `{ id, name }` and nothing else, so it *is* the domain
 * {@link Tag}; there is no field to lift and none to drop.
 */
type TagResource = {
  id: number;
  name: string;
};

/**
 * The hand-written resource service over the API's Tags endpoints (ADR 0002). It
 * holds the one collection this client caches across navigations and reads it
 * two ways — `all()` through the cache, `readAll()` cold — where the reader a
 * call site picks *is* its rule (ADR 0017).
 *
 * ADR 0017's discipline applies but its stated warrant does not. That ADR caches
 * Categories so "a hundred rows resolve their labels from one request"; nothing
 * here does that, because a Transaction carries its Tags whole (`transaction.ts`
 * holds `tags: readonly Tag[]` with names embedded) and nothing in the app ever
 * resolves a Tag id to a name. The warrant here is the **autocomplete on the two
 * transaction forms**: it filters the whole set locally on every keystroke, and
 * a dialog opened, closed and reopened must not re-fetch. So the collection is
 * fetched once, multicast, and replayed — bought against that, not against row
 * rendering.
 *
 * Because nothing narrows, the readers are `all()` / `readAll()` and
 * deliberately not `list()` / `readAll()`: on Categories `list()` earns its name
 * by meaning *active-only*, and a `list()` here would signal a filtering rule
 * that does not exist. There is no `names()` (no id-to-name lookup exists) and
 * no active-only reader (no such axis is on the wire).
 *
 * Every write drops the cache from inside this service, unconditionally — never
 * a second call a caller can forget, and never gated on there being a live
 * subscriber, because a write that checks first is the silent failure 0017
 * exists to prevent. This holds even though the only renames and deletes come
 * from the Tags screen, which invalidates but never reads through the cache: one
 * direction of dependency, not two. Nothing is patched in place — `POST` and
 * `PUT` return the bare resource, `DELETE` returns nothing, and reconstructing
 * the collection from a fragment is what 0017 forbids.
 *
 * A successful fetch is kept for the session; a failed one is discarded, so a
 * caller that offers a retry actually re-fetches.
 *
 * Failures arrive already normalised to `ApiError` by the interceptor. The
 * duplicate-name `409` on `POST` and `PUT` is re-filed here at the seam as a
 * `name` field error. There is no in-use `409` on `DELETE` — it has no guard and
 * strips the Tag off every Transaction carrying it — and no optimistic-concurrency
 * rejection anywhere, so there is no `TagInUseError` and no `TagModifiedError`.
 */
@Injectable({ providedIn: 'root' })
export class TagsService {
  // Dependencies
  private http = inject(HttpClient);
  private baseUrl = inject(API_BASE_URL);

  /** The in-flight-or-settled shared request, or `null` before the first read and after a write or a failure. */
  private cached: Observable<Tag[]> | null = null;

  /**
   * The **whole set**, through the cache — for the Tag entry control on the two
   * transaction forms, which filters it locally on every keystroke and must not
   * re-fetch each time its dialog reopens. Shares the one multicast request.
   */
  all(): Observable<Tag[]> {
    return this.tags();
  }

  /**
   * The **whole set**, on a **cold** request that never touches the cache — for
   * the Tags screen, which manages the collection and so re-reads on entry and
   * after every write. That screen invalidates the cache (through the writes
   * below) but never reads through it: one direction of dependency, not two.
   * `read` is already this repo's word for a fresh trip to the API
   * (`TransactionsService.list`, `CategoriesService.readAll`).
   */
  readAll(): Observable<Tag[]> {
    return this.fetch();
  }

  /**
   * Create a Tag. On success the created row comes back and the cache is
   * dropped, so the next reader re-fetches — the row is not patched in, because
   * `POST` returns the bare resource (ADR 0017). A caller that needs the row
   * right away (the form's inline-create path) takes it from this stream.
   *
   * This endpoint's only `409` means the name is already taken — per person, by
   * the `(UserId, Name)` index. That is a fact about the resource, not a
   * transport shape the normaliser should know (ADR 0002), so it is re-attached
   * here as a `name` field error the caller surfaces under the name control.
   */
  create(name: string): Observable<Tag> {
    return this.http
      .post<TagResource>(`${this.baseUrl}/api/tags`, { name })
      .pipe(
        tap(() => this.invalidate()),
        catchError((error: unknown) => throwError(() => asNameConflict(error)))
      );
  }

  /**
   * Rename a Tag. On success the whole row comes back and the cache is dropped.
   * The `409` here means the same thing it does on {@link create} — duplicate
   * name — and is re-filed the same way, as a `name` field error.
   */
  rename(id: number, name: string): Observable<Tag> {
    return this.http
      .put<TagResource>(`${this.baseUrl}/api/tags/${id}`, { name })
      .pipe(
        tap(() => this.invalidate()),
        catchError((error: unknown) => throwError(() => asNameConflict(error)))
      );
  }

  /**
   * Delete a Tag. On success (`204`, no body) the cache is dropped. This
   * endpoint has **no in-use guard**: it succeeds and strips the Tag off every
   * Transaction carrying it, so there is no in-use `409` to catch — a failure
   * passes straight through as the interceptor's `ApiError`. A `403` (someone
   * else's Tag) and a `404` (unknown id) arrive on that `ApiError`'s `status`,
   * distinguishable from a generic failure without any re-filing.
   */
  remove(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/api/tags/${id}`)
      .pipe(
        map(() => undefined),
        tap(() => this.invalidate())
      );
  }

  /** Drop the cache so the next reader re-fetches. Called from inside every write. */
  private invalidate(): void {
    this.cached = null;
  }

  /** The shared collection: one request, multicast and replayed — rebuilt after a write or a failure. */
  private tags(): Observable<Tag[]> {
    this.cached ??= this.fetch().pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      catchError((error: unknown) => {
        this.cached = null;
        return throwError(() => error);
      })
    );
    return this.cached;
  }

  /** One cold `GET /api/tags`. The wire row is the domain shape, so no adapter. */
  private fetch(): Observable<Tag[]> {
    return this.http.get<TagResource[]>(`${this.baseUrl}/api/tags`);
  }
}

/** Re-file a duplicate-name `409` as a `name` field error; pass anything else on. */
function asNameConflict(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409) {
    return new ApiError(error.message, error.status, {
      name: [error.message],
    });
  }
  return error;
}
