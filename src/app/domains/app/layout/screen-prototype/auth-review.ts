import { Component, computed, input, output, signal } from '@angular/core';
@Component({ selector: 'auth-review', templateUrl: './auth-review.html' })
export default class AuthReview {
  readonly screen = input.required<string>();
  readonly scenario = input('everyday');
  readonly navigate = output<string>();
  readonly sent = signal(false);
  readonly reveal = signal(false);
  readonly email = signal('');
  readonly titles: Record<string, string> = {
    signup: 'Create your profile',
    forgot: 'Forgot your password?',
    reset: 'Set a new password',
    confirm: 'Confirming your email',
    emailchange: 'Confirm your new email',
  };
  readonly authTitle = computed(() => this.titles[this.screen()] || 'Continue');
  submit(event: Event) {
    event.preventDefault();
    this.sent.set(true);
  }
}
