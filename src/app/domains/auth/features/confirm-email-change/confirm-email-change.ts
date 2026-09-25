import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, EmailChangeAddressTakenError, EmailChangeLinkInvalidError } from '@/app/core/auth';
import { reasonQueryParams, Session, SIGN_IN_ROUTE } from '@/app/core/session';

type ConfirmationState =
  'ready' | 'confirming' | 'retry' | 'refreshing-profile' | 'success' | 'invalid' | 'taken' | 'refresh-failed';

@Component({
  selector: 'auth-confirm-email-change',
  templateUrl: './confirm-email-change.html',
  imports: [MatButton],
})
export default class AuthConfirmEmailChange implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('stateHeading');
  protected readonly session = inject(Session);

  protected readonly state = signal<ConfirmationState>('ready');
  protected readonly pageTitle = computed(() => confirmationTitles[this.state()]);
  protected readonly refreshing = signal(false);
  protected readonly linkedProfileIsActive = computed(
    () => this.session.isAuthenticated() && this.session.profile()?.id === this.userId,
  );
  protected userId: number | null = null;
  private token: string | null = null;
  private submitted = false;

  constructor() {
    this.focusHeadingAfterRender();
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.userId = parseUserId(params.get('userId'));
    this.token = params.get('token');
    if (this.userId === null || !this.token) {
      this.state.set('invalid');
    }
  }

  protected async confirm(): Promise<void> {
    if (this.submitted || this.userId === null || this.token === null) {
      return;
    }
    this.submitted = true;
    this.state.set('confirming');
    try {
      await firstValueFrom(this.auth.confirmEmailChange(this.userId, this.token));
    } catch (error) {
      this.submitted = false;
      const failureState =
        error instanceof EmailChangeAddressTakenError
          ? 'taken'
          : error instanceof EmailChangeLinkInvalidError
            ? 'invalid'
            : 'retry';
      this.state.set(failureState);
      if (failureState === 'taken' || failureState === 'invalid') {
        this.focusHeadingAfterRender();
      }
      return;
    }
    await this.continueAfterSuccess(true);
  }

  protected notNow(): void {
    if (this.session.isAuthenticated()) {
      void this.router.navigateByUrl('/app/profile');
    } else {
      void this.router.navigate([SIGN_IN_ROUTE]);
    }
  }

  protected async continue(): Promise<void> {
    if (this.refreshing()) {
      return;
    }
    this.refreshing.set(true);
    try {
      await this.continueAfterSuccess();
    } finally {
      this.refreshing.set(false);
    }
  }

  protected goToProfile(): void {
    void this.router.navigateByUrl('/app/profile');
  }

  protected signIn(): void {
    void this.router.navigate([SIGN_IN_ROUTE]);
  }

  protected signOut(): void {
    this.session.signOut();
  }

  private async continueAfterSuccess(showRefreshState = false): Promise<void> {
    if (!this.session.isAuthenticated()) {
      await this.router.navigate([SIGN_IN_ROUTE], { queryParams: reasonQueryParams('email-changed') });
      return;
    }
    if (this.session.profile()?.id !== this.userId) {
      this.state.set('success');
      this.focusHeadingAfterRender();
      return;
    }
    if (showRefreshState) {
      this.state.set('refreshing-profile');
      this.focusHeadingAfterRender();
    }
    try {
      const revision = this.session.beginProfileRead();
      const profile = await firstValueFrom(this.auth.me());
      if (!this.session.applyProfileUpdate(profile, revision)) {
        if (!this.session.isAuthenticated()) {
          await this.router.navigate([SIGN_IN_ROUTE], { queryParams: reasonQueryParams('email-changed') });
          return;
        }
        if (this.session.profile()?.id !== this.userId) {
          this.state.set('success');
          this.focusHeadingAfterRender();
          return;
        }
        this.state.set('refresh-failed');
        this.focusHeadingAfterRender();
        return;
      }
      await this.router.navigateByUrl('/app/profile', { state: { emailChangeConfirmed: true } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.session.expire();
        return;
      }
      this.state.set('refresh-failed');
      this.focusHeadingAfterRender();
    }
  }

  private focusHeadingAfterRender(): void {
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }
}

function parseUserId(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  const userId = Number(raw);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

const confirmationTitles: Record<ConfirmationState, string> = {
  ready: 'Confirm email change',
  confirming: 'Confirm email change',
  retry: 'Confirm email change',
  'refreshing-profile': 'Email change confirmed',
  'refresh-failed': 'Email change confirmed',
  success: 'Email change confirmed for the linked Profile.',
  taken: 'This email address is no longer available',
  invalid: 'This email change link is no longer valid',
};
