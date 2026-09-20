// Throwaway token study: A component sheet, B dense Account, C welcome form.
// Shared tokens; layouts demonstrate contexts, not competing navigation proposals.
import { Component, computed, HostListener, signal, ViewEncapsulation } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'token-prototype',
  imports: [MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  templateUrl: './token-prototype.html',
  styleUrl: './token-prototype.css',
  encapsulation: ViewEncapsulation.None,
})
export default class TokenPrototype {
  readonly variant = signal(new URLSearchParams(location.search).get('variant') || 'A');
  readonly appearance = signal(new URLSearchParams(location.search).get('scheme') || 'system');
  readonly osDark = signal(matchMedia('(prefers-color-scheme: dark)').matches);
  readonly dark = computed(() => this.appearance() === 'dark' || (this.appearance() === 'system' && this.osDark()));
  readonly narrow = signal(new URLSearchParams(location.search).get('width') === 'phone');
  readonly menuOpen = signal(false);
  readonly error = new FormControl('', Validators.required);
  readonly notice = signal('');
  readonly variants = ['A', 'B', 'C'];
  readonly names: Record<string, string> = { A: 'Components', B: 'Dense Account', C: 'Welcome' };
  readonly rows = [
    { name: 'Monthly salary', detail: 'Income · Salary · Today', amount: '+₱48,000.00', direction: 'income' },
    { name: 'Groceries for the week', detail: 'Expense · Food · Today', amount: '−₱2,840.75', direction: 'expense' },
    {
      name: 'Everyday Bank → Cash',
      detail: 'Transfer · Leaving this Account · Yesterday',
      amount: '−₱2,000.00',
      direction: 'transfer',
    },
    {
      name: 'Electricity and water',
      detail: 'Expense · Utilities · Yesterday',
      amount: '−₱1,625.50',
      direction: 'expense',
    },
    { name: 'Project payment', detail: 'Income · Freelance · 18 Sep', amount: '+₱12,500.00', direction: 'income' },
  ];
  readonly swatches = [
    'canvas',
    'surface',
    'raised',
    'soft',
    'text',
    'muted',
    'primary',
    'outline',
    'divider',
    'income',
    'expense',
    'transfer',
  ];
  constructor() {
    this.error.setErrors({ required: true });
    this.error.markAsTouched();
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', (e) => this.osDark.set(e.matches));
  }
  set(key: string, value: string) {
    if (key === 'variant') this.variant.set(value);
    if (key === 'scheme') this.appearance.set(value);
    if (key === 'width') this.narrow.set(value === 'phone');
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    history.replaceState(null, '', url);
  }
  cycle(offset: number) {
    this.set('variant', this.variants[(this.variants.indexOf(this.variant()) + offset + 3) % 3]);
  }
  @HostListener('window:keydown', ['$event']) key(event: KeyboardEvent) {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable],dialog')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.cycle(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
}
