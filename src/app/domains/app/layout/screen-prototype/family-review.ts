// Throwaway second-stage compositions. Actions are in-memory layout previews only.
import { Component, computed, input, output, signal } from '@angular/core';

@Component({ selector: 'family-review', templateUrl: './family-review.html' })
export default class FamilyReview {
  readonly screen = input.required<string>();
  readonly variant = input('A');
  readonly scenario = input('everyday');
  readonly navigate = output<string>();
  readonly edit = output<string>();
  readonly tab = signal('');
  readonly search = signal('');
  readonly confirmation = signal('');
  readonly feedback = signal('');
  readonly pendingEmail = signal(true);
  readonly renamingTag = signal<number | null>(null);
  readonly categoryStatus = signal<Record<string, string>>({ Expense: 'Active', Income: 'Active' });
  readonly categorySearch = signal<Record<string, string>>({ Expense: '', Income: '' });
  categoryRows(direction: string) {
    return Array.from({ length: this.count() }, (_, i) => i).filter(
      (i) =>
        !(this.categoryStatus()[direction] === 'Retired' && i === 0) &&
        this.categoryName(direction, i).toLowerCase().includes(this.categorySearch()[direction].toLowerCase()),
    );
  }
  categoryName(direction: string, i: number) {
    return direction === 'Income' ? ['Salary', 'Freelance', 'Gifts'][i % 3] : this.name(i);
  }
  setCategory(direction: string, key: 'status' | 'search', value: string) {
    const target = key === 'status' ? this.categoryStatus : this.categorySearch;
    target.update((current) => ({ ...current, [direction]: value }));
  }
  finishRename() {
    this.renamingTag.set(null);
    this.feedback.set('Inline rename preview complete. Sample data has not changed.');
  }
  readonly tabs = computed(() =>
    this.screen() === 'budgets'
      ? ['Current', 'Future', 'Finished']
      : this.screen() === 'goals'
        ? ['Active', 'Completed', 'Abandoned']
        : this.screen() === 'schedules'
          ? ['Upcoming', 'Paused', 'Past']
          : ['Active', 'Retired', 'All'],
  );
  readonly activeTab = computed(() => (this.tabs().includes(this.tab()) ? this.tab() : this.tabs()[0]));
  readonly count = computed(() =>
    this.scenario() === 'empty' ? 0 : this.scenario() === 'stress' ? 9 : this.screen() === 'goals' ? 4 : 3,
  );
  readonly items = computed(() =>
    Array.from({ length: this.count() }, (_, i) => i).filter((i) =>
      this.name(i).toLowerCase().includes(this.search().toLowerCase()),
    ),
  );
  name(i: number): string {
    const names: Record<string, string[]> = {
      budgets: ['Groceries and household supplies', 'All spending', 'Meals out'],
      goals: ['Rainy day fund', 'Trip to Kyoto', 'A new laptop', 'Home improvements'],
      schedules: ['Monthly rent', 'Salary', 'Home internet'],
      categories: ['Food', 'Transport', 'Utilities'],
      tags: ['Home', 'Work', 'Reimbursable'],
    };
    const familyNames = names[this.screen()] || ['Item'];
    return (
      familyNames[i % familyNames.length] +
      (this.scenario() === 'stress' ? ` — family and long-term plans ${i + 1}` : '')
    );
  }
  money(value: number) {
    return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  goalAmount(i: number) {
    return [50000, 52000, 35000, 35000][i % 4];
  }
  goalOverdue(i: number) {
    // Match existing behavior: an Active Goal's date can be overdue even when funded.
    return this.activeTab() === 'Active' && (i % 4 === 2 || i === 8);
  }
  ask(action: string, name: string) {
    this.confirmation.set(`${action} ${name}?`);
  }
  confirm() {
    this.feedback.set('Confirmation preview complete. Sample data has not changed.');
    this.confirmation.set('');
  }
}
