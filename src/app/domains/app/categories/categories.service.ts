import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, shareReplay, throwError } from 'rxjs';
import { API_BASE_URL } from '@/app/core/api';
import { Category } from './category';

/**
 * Wire shape of one Category from the API. `GET /api/categories` returns a
 * collection of these — the person's own Categories plus the ones Pitaka
 * supplies. Only `id` and `name` are lifted into {@link Category}.
 */
type CategoryResource = {
  id: number;
  name: string;
  type: 'Income' | 'Expense';
  isDefault: boolean;
  parentId: number | null;
};

/**
 * The shared reference cache for Categories (ADR 0002 for the hand-written
 * adapter). Unlike an Account's balance, which is re-read on every entry and
 * never held (ADR 0006), Categories are reference data: a small, slow-changing
 * set whose names label Transactions across many screens. So the collection is
 * fetched once, multicast, and replayed to every later reader — a screen
 * showing a hundred Transaction rows resolves their Category names from one
 * request, not one per row. A successful fetch is kept for the session; a
 * failed one is discarded, so a caller that offers a retry actually re-fetches.
 */
@Injectable({ providedIn: 'root' })
export class CategoriesService {
  // Dependencies
  private http = inject(HttpClient);
  private baseUrl = inject(API_BASE_URL);

  /** The in-flight-or-settled shared request, or `null` before the first read and after a failure. */
  private cached: Observable<Category[]> | null = null;

  /**
   * Category id to name, resolved once for a whole list. An id with no match —
   * unknown, or a Transaction filed under none — simply returns `undefined`.
   */
  names(): Observable<ReadonlyMap<number, string>> {
    return this.categories().pipe(
      map(
        (categories) =>
          new Map(categories.map((category) => [category.id, category.name]))
      )
    );
  }

  /**
   * The whole set, each carrying its income/expense `kind` — for a picker that
   * offers only the Categories of a chosen direction (ADR 0010). Shares the one
   * cached request with {@link names}.
   */
  list(): Observable<Category[]> {
    return this.categories();
  }

  /** The shared collection: one request, replayed — rebuilt after a failure. */
  private categories(): Observable<Category[]> {
    this.cached ??= this.http
      .get<CategoryResource[]>(`${this.baseUrl}/api/categories`)
      .pipe(
        map((resources) => resources.map(toCategory)),
        shareReplay({ bufferSize: 1, refCount: false }),
        catchError((error: unknown) => {
          this.cached = null;
          return throwError(() => error);
        })
      );
    return this.cached;
  }
}

/** The API's `CategoryType`, lowered to a {@link Category}'s `kind`. */
const KIND: Record<CategoryResource['type'], Category['kind']> = {
  Income: 'income',
  Expense: 'expense',
};

/** Keep id, name, and `kind`; drop what nothing above the adapter reads (`isDefault`, `parentId`). */
function toCategory(resource: CategoryResource): Category {
  return { id: resource.id, name: resource.name, kind: KIND[resource.type] };
}
