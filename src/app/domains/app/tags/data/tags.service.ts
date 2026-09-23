import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, shareReplay, tap, throwError } from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import { Tag } from './tag';
import { TagUnavailableError } from './tag-errors';

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
 * Hand-written adapter for the Tags endpoints (ADR 0002). `all()` serves
 * the cached autocomplete collection and `readAll()` stays cold for the
 * management screen; invalidation and failure behavior are in ADR 0017.
 * Duplicate-name `409`s are re-filed as `name` errors. Delete has no in-use
 * guard, so there is no `TagInUseError`; Tags also have no optimistic-concurrency
 * rejection, so there is no `TagModifiedError`.
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
   * Create a Tag. `POST` returns the created row, which the inline-create caller
   * can use immediately; the shared collection follows ADR 0017.
   *
   * This endpoint's only `409` means the name is already taken — per person, by
   * the `(UserId, Name)` index. That is a fact about the resource, not a
   * transport shape the normaliser should know (ADR 0002), so it is re-attached
   * here as a `name` field error the caller surfaces under the name control.
   */
  create(name: string): Observable<Tag> {
    return this.http.post<TagResource>(`${this.baseUrl}/api/tags`, { name }).pipe(
      tap(() => this.invalidate()),
      catchError((error: unknown) => throwError(() => asNameConflict(error))),
    );
  }

  /**
   * Rename a Tag. The `409` means the same thing it does on {@link create}:
   * duplicate name, re-filed as a `name` field error.
   */
  rename(id: number, name: string): Observable<Tag> {
    return this.http.put<TagResource>(`${this.baseUrl}/api/tags/${id}`, { name }).pipe(
      tap(() => this.invalidate()),
      catchError((error: unknown) => throwError(() => asRenameError(error))),
    );
  }

  /**
   * Delete a Tag (`204`, no body). This endpoint has **no in-use guard**: it
   * succeeds and strips the Tag off every Transaction carrying it, so there is
   * no in-use `409` to catch. `403` and `404` become a resource-level
   * unavailable error so the screen does not interpret HTTP status codes.
   */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/api/tags/${id}`).pipe(
      map(() => undefined),
      tap(() => this.invalidate()),
      catchError((error: unknown) => throwError(() => asUnavailable(error))),
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
      }),
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

/** Normalize endpoint-specific ownership or missing-row failures for callers. */
function asRenameError(error: unknown): unknown {
  return asUnavailable(asNameConflict(error));
}

function asUnavailable(error: unknown): unknown {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return new TagUnavailableError();
  }
  return error;
}
