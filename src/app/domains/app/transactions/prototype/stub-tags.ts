/**
 * PROTOTYPE — throwaway. Not production code, no tests, no error handling.
 *
 * An in-memory stand-in for the Tags a person has, so the variants can be
 * judged without a running API. Mimics the two wire facts that matter to the
 * control's shape: a Tag is `{ id, name }` and nothing else, and a duplicate
 * name comes back 409.
 */
import { Injectable, signal } from '@angular/core';

export type StubTag = { id: number; name: string };

const SEED = [
  'groceries', 'coffee', 'rent', 'utilities', 'transport', 'fuel', 'dining out',
  'work lunch', 'subscriptions', 'streaming', 'gifts', 'birthday', 'travel',
  'flights', 'hotel', 'medical', 'pharmacy', 'pets', 'vet', 'household',
  'repairs', 'clothes', 'shoes', 'books', 'hobbies', 'gym', 'charity',
  'reimbursable', 'shared with anna', 'tax deductible',
];

@Injectable({ providedIn: 'root' })
export class StubTagsService {
  /** The collection the variants read. Flip to empty with `useEmpty()`. */
  readonly tags = signal<readonly StubTag[]>(
    SEED.map((name, index) => ({ id: index + 1, name }))
  );

  private nextId = SEED.length + 1;

  useEmpty(): void {
    this.tags.set([]);
  }

  useSeeded(): void {
    this.tags.set(SEED.map((name, index) => ({ id: index + 1, name })));
    this.nextId = SEED.length + 1;
  }

  /**
   * Create, with the API's duplicate rule: same name for the same person is a
   * 409. Rejects after a beat so the variants have to show a pending moment.
   */
  async create(name: string): Promise<StubTag> {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const trimmed = name.trim();
    const clash = this.tags().find(
      (tag) => tag.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (clash) {
      throw { status: 409, existing: clash };
    }
    const created = { id: this.nextId++, name: trimmed };
    this.tags.update((tags) => [...tags, created]);
    return created;
  }
}
