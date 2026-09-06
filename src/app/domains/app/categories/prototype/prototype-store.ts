// PROTOTYPE — throwaway. In-memory stand-in for CategoriesService's writes.
import { computed, Injectable, signal } from '@angular/core';
import { newId, ordered, PrototypeCategory, seed } from './prototype-data';

@Injectable()
export class PrototypeStore {
  private rows = signal<PrototypeCategory[]>(seed());

  readonly expense = computed(() =>
    ordered(this.rows().filter((c) => c.kind === 'expense'))
  );
  readonly income = computed(() =>
    ordered(this.rows().filter((c) => c.kind === 'income'))
  );
  readonly hasRetired = computed(() => this.rows().some((c) => !c.isActive));

  create(name: string, kind: PrototypeCategory['kind']): void {
    this.rows.update((rows) => [
      ...rows,
      { id: newId(), name, kind, isDefault: false, isActive: true },
    ]);
  }

  rename(id: number, name: string): void {
    this.patch(id, { name });
  }

  toggleActive(id: number): void {
    this.rows.update((rows) =>
      rows.map((c) => (c.id === id ? { ...c, isActive: !c.isActive } : c))
    );
  }

  delete(id: number): void {
    this.rows.update((rows) => rows.filter((c) => c.id !== id));
  }

  private patch(id: number, change: Partial<PrototypeCategory>): void {
    this.rows.update((rows) =>
      rows.map((c) => (c.id === id ? { ...c, ...change } : c))
    );
  }
}
