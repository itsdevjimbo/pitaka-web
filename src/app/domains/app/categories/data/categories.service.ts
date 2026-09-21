import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, shareReplay, tap, throwError } from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import { Category, CategoryKind, NewCategory } from './category';
import { CategoryInUseError } from './category-errors';

/**
 * Wire shape of one Category from the API (`e8b8c6e`). `GET /api/categories`
 * returns a collection of these — the person's own Categories plus the ones
 * Pitaka supplies, active and retired mixed together — and `POST`, `PUT /{id}`
 * and `PATCH /{id}/status` each return one. `id`, `name`, `type`, `isActive` and
 * `isDefault` are lifted into {@link Category}.
 */
type CategoryResource = {
  id: number;
  name: string;
  type: 'Income' | 'Expense';
  isDefault: boolean;
  isActive: boolean;
};

/**
 * Hand-written adapter for the Categories endpoints (ADR 0002). Its readers
 * encode their filtering rules and share one reference-data cache except for
 * `readAll()`; `refreshList()` explicitly invalidates it. The full invalidation
 * and failure behavior is in ADR 0017. Endpoint-specific `409`s are re-filed
 * here from normalised `ApiError`s.
 */
@Injectable({ providedIn: 'root' })
export class CategoriesService {
  // Dependencies
  private http = inject(HttpClient);
  private baseUrl = inject(API_BASE_URL);

  /** The in-flight-or-settled shared request, or `null` before the first read and after a write or a failure. */
  private cached: Observable<Category[]> | null = null;

  /**
   * Category id to name, resolved once for a whole list — the **whole set**,
   * retired included, because a Transaction filed under a since-retired Category
   * must still render its label. An id with no match — unknown, or a Transaction
   * filed under none — simply returns `undefined`. Cached.
   */
  names(): Observable<ReadonlyMap<number, string>> {
    return this.categories().pipe(
      map((categories) => new Map(categories.map((category) => [category.id, category.name]))),
    );
  }

  /**
   * The **active** Categories only, each carrying its income/expense `kind` —
   * for the write pickers (record, refile, new-budget, adjust-budget), which
   * offer only what a new Transaction or Budget may be filed under. The API
   * enforces none of this — it accepts a retired Category as a fresh reference
   * with no error (#98) — so this client-side narrowing is the only guard.
   * Shares the one cached request with {@link names} and {@link all}.
   */
  list(): Observable<Category[]> {
    return this.categories().pipe(map((categories) => categories.filter((category) => category.isActive)));
  }

  /**
   * Re-read active Categories after the server rejects a formerly eligible
   * selection. This exceptional refresh drops the shared cache first so a form
   * cannot immediately offer the same stale choice again.
   */
  refreshList(): Observable<Category[]> {
    this.invalidate();
    return this.list();
  }

  /**
   * The **whole set**, retired included, each carrying `kind` and `isActive` —
   * for the places that must show a retired Category *marked* rather than
   * hidden: the Transactions filter, which governs finding rather than filing
   * (ADR 0016), and a form editing a record whose saved Category has since been
   * retired. {@link names} has no `isActive` to give and {@link list} has
   * already dropped the row, so neither can serve these. Shares the one cached
   * request; it differs from {@link readAll} only by reading through the cache.
   */
  all(): Observable<Category[]> {
    return this.categories();
  }

  /**
   * The whole set, retired included, on a **cold** request that never touches
   * the cache — for the Categories screen, which manages the collection and so
   * re-reads on entry and after every write. That screen invalidates the cache
   * (through the writes below) but never reads through it: one direction of
   * dependency, not two. `read` is already this repo's word for a fresh trip to
   * the API (`TransactionsService.list`).
   */
  readAll(): Observable<Category[]> {
    return this.fetch();
  }

  /**
   * Create a Category of the pane's `kind`; `POST` returns the created row.
   *
   * This endpoint's only `409` means the name is already taken — per person,
   * across both kinds, ignoring Pitaka-supplied names. That is a fact about the
   * resource, not a transport shape the normaliser should know (ADR 0002), so it
   * is re-attached here as a `name` field error the caller surfaces under the
   * name control.
   */
  create(category: NewCategory): Observable<Category> {
    return this.http
      .post<CategoryResource>(`${this.baseUrl}/api/categories`, {
        name: category.name,
        type: API_TYPE[category.kind],
      })
      .pipe(
        map(toCategory),
        tap(() => this.invalidate()),
        catchError((error: unknown) => throwError(() => asNameConflict(error))),
      );
  }

  /**
   * Rename a Category. The kind is settled at creation and `PUT` will not move
   * it, so only the name goes. The `409` means the same thing it does on
   * {@link create}: duplicate name, re-filed as a `name` field error.
   */
  rename(id: number, name: string): Observable<Category> {
    return this.http.put<CategoryResource>(`${this.baseUrl}/api/categories/${id}`, { name }).pipe(
      map(toCategory),
      tap(() => this.invalidate()),
      catchError((error: unknown) => throwError(() => asNameConflict(error))),
    );
  }

  /**
   * Retire a Category (`isActive: false`) or bring it back (`isActive: true`).
   * Retiring never erases the Category or the Transactions filed under it — it
   * stops being offered when filing (see {@link list}) while staying offered
   * when finding. This endpoint cannot `409`: there is no duplicate-name check
   * and no optimistic-concurrency rejection anywhere on Categories (ADR 0017), so no
   * `catchError` — a failure passes straight through as the interceptor's
   * `ApiError`.
   */
  setActive(id: number, isActive: boolean): Observable<Category> {
    return this.http
      .patch<CategoryResource>(`${this.baseUrl}/api/categories/${id}/status`, {
        isActive,
      })
      .pipe(
        map(toCategory),
        tap(() => this.invalidate()),
      );
  }

  /**
   * Delete a Category (`204`, no body). A `409` means something still files
   * under or narrows to it — a Transaction, a Budget, or a Schedule; the API
   * returns one undifferentiated
   * string and cannot say which — re-filed as a {@link CategoryInUseError} the
   * caller words as a dead end with *Retire* as the way out.
   */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/api/categories/${id}`).pipe(
      map(() => undefined),
      tap(() => this.invalidate()),
      catchError((error: unknown) => throwError(() => asInUse(error))),
    );
  }

  /** Drop the cache so the next reader re-fetches. Called from inside every write. */
  private invalidate(): void {
    this.cached = null;
  }

  /** The shared collection: one request, multicast and replayed — rebuilt after a write or a failure. */
  private categories(): Observable<Category[]> {
    this.cached ??= this.fetch().pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      catchError((error: unknown) => {
        this.cached = null;
        return throwError(() => error);
      }),
    );
    return this.cached;
  }

  /** One cold `GET /api/categories`, wire rows lifted to the domain shape. */
  private fetch(): Observable<Category[]> {
    return this.http
      .get<CategoryResource[]>(`${this.baseUrl}/api/categories`)
      .pipe(map((resources) => resources.map(toCategory)));
  }
}

/** The API's `CategoryType`, lowered to a {@link Category}'s `kind`. */
const KIND: Record<CategoryResource['type'], Category['kind']> = {
  Income: 'income',
  Expense: 'expense',
};

/** A {@link Category}'s `kind` raised back to the API's `CategoryType`. */
const API_TYPE: Record<CategoryKind, CategoryResource['type']> = {
  income: 'Income',
  expense: 'Expense',
};

/** Keep id, name, `kind`, `isActive` and `isDefault`; the API sends nothing else the app reads. */
function toCategory(resource: CategoryResource): Category {
  return {
    id: resource.id,
    name: resource.name,
    kind: KIND[resource.type],
    isActive: resource.isActive,
    isDefault: resource.isDefault,
  };
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

/** Re-file an in-use `409` on `DELETE` as a `CategoryInUseError`; pass anything else on. */
function asInUse(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409) {
    return new CategoryInUseError(error.message);
  }
  return error;
}
