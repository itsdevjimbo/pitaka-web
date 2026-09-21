import { Component, inject, OnInit, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, EmailChangeAddressTakenError, EmailChangeLinkInvalidError } from '@/app/core/auth';
import { reasonQueryParams, Session, SIGN_IN_ROUTE } from '@/app/core/session';

type ConfirmationState = 'ready' | 'confirming' | 'retry' | 'success' | 'invalid' | 'taken' | 'refresh-failed';

@Component({
  selector: 'auth-confirm-email-change',
  templateUrl: './confirm-email-change.html',
  imports: [MatButton],
})
export default class AuthConfirmEmailChange implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(Session);

  protected readonly state = signal<ConfirmationState>('ready');
  protected userId: number | null = null;
  private token: string | null = null;
  private submitted = false;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.userId = parseUserId(params.get('userId'));
    this.token = params.get('token');
    if (this.userId === null || !this.token) this.state.set('invalid');
  }

  protected async confirm(): Promise<void> {
    if (this.submitted || this.userId === null || this.token === null) return;
    this.submitted = true;
    this.state.set('confirming');
    try {
      await firstValueFrom(this.auth.confirmEmailChange(this.userId, this.token));
    } catch (error) {
      this.submitted = false;
      this.state.set(
        error instanceof EmailChangeAddressTakenError
          ? 'taken'
          : error instanceof EmailChangeLinkInvalidError
            ? 'invalid'
            : 'retry',
      );
      return;
    }
    await this.continueAfterSuccess();
  }

  protected notNow(): void {
    if (this.session.isAuthenticated()) {
      void this.router.navigateByUrl('/app/profile');
    } else {
      void this.router.navigate([SIGN_IN_ROUTE]);
    }
  }

  protected continue(): void {
    void this.continueAfterSuccess();
  }

  protected goToProfile(): void {
    void this.router.navigateByUrl('/app/profile');
  }

  protected signIn(): void {
    void this.router.navigate([SIGN_IN_ROUTE]);
  }

  private async continueAfterSuccess(): Promise<void> {
    if (!this.session.isAuthenticated()) {
      await this.router.navigate([SIGN_IN_ROUTE], { queryParams: reasonQueryParams('email-changed') });
      return;
    }
    if (this.session.profile()?.id !== this.userId) {
      this.state.set('success');
      return;
    }
    try {
      this.session.applyProfileUpdate(await firstValueFrom(this.auth.me()));
      await this.router.navigateByUrl('/app/profile', { state: { emailChangeConfirmed: true } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.session.expire();
        return;
      }
      this.state.set('refresh-failed');
    }
  }
}

function parseUserId(raw: string | null): number | null {
  if (!raw) return null;
  const userId = Number(raw);
  return Number.isInteger(userId) ? userId : null;
}
