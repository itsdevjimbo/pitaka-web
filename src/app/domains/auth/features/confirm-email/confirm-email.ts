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
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService } from '@/app/core/auth';
import { APP_HOME_ROUTE, reasonQueryParams, Session, SIGN_IN_ROUTE } from '@/app/core/session';
import { DeadLink } from '../../ui/dead-link/dead-link';

type ConfirmationState = 'pending' | 'success' | 'invalid' | 'retry';

/**
 * The screen a confirmation email links to (ADR 0015). It spends the link as
 * soon as it opens, then gives the person a clear result and the right next
 * step for their current session. The success action preserves a live session
 * and sends a signed-out visitor to sign-in with the confirmation reason.
 *
 * Deliberately outside `guestGuard`: confirming is an operation on a Profile
 * reached by link, not a guest action a live session makes meaningless, and
 * the guard would silently destroy the token before this screen saw it.
 *
 * The API call starts from script rather than waiting for a click, so a mail
 * scanner or link previewer's `GET`/`HEAD` cannot spend the token.
 */
@Component({
  selector: 'auth-confirm-email',
  templateUrl: './confirm-email.html',
  imports: [MatButtonModule, MatIconModule, DeadLink],
})
export default class AuthConfirmEmail implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');

  protected readonly state = signal<ConfirmationState>('pending');
  protected readonly isAuthenticated = computed(() => this.session.isAuthenticated());
  protected readonly continuing = signal(false);
  protected readonly retrying = signal(false);

  private initialRequestStarted = false;
  private requestInFlight = false;
  private userId: number | null = null;
  private token: string | null = null;

  constructor() {
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }

  async ngOnInit(): Promise<void> {
    if (this.initialRequestStarted) {
      return;
    }
    this.initialRequestStarted = true;

    const params = this.route.snapshot.queryParamMap;
    this.userId = parseUserId(params.get('userId'));
    this.token = params.get('token');

    if (this.token === null || this.token === '' || this.userId === null) {
      this.state.set('invalid');
      return;
    }

    await this.confirm();
  }

  protected async retry(): Promise<void> {
    if (this.state() !== 'retry' || this.retrying()) {
      return;
    }
    this.retrying.set(true);
    try {
      await this.confirm();
    } finally {
      this.retrying.set(false);
    }
  }

  protected async continue(): Promise<void> {
    if (this.state() !== 'success' || this.continuing()) {
      return;
    }

    this.continuing.set(true);
    try {
      if (this.isAuthenticated()) {
        await this.router.navigateByUrl(APP_HOME_ROUTE);
      } else {
        await this.router.navigate([SIGN_IN_ROUTE], {
          queryParams: reasonQueryParams('email-confirmed'),
        });
      }
    } catch (error) {
      // Confirmation already succeeded. A navigation error must not turn the
      // spent link into an invalid-link result or invite another POST.
      console.error('[confirm-email] navigation after confirmation failed', error);
    } finally {
      this.continuing.set(false);
    }
  }

  private async confirm(): Promise<void> {
    if (this.requestInFlight || this.userId === null || this.token === null) {
      return;
    }

    this.requestInFlight = true;
    this.state.set('pending');

    try {
      await firstValueFrom(this.auth.confirmEmail(this.userId, this.token));
      this.state.set('success');
    } catch (error) {
      console.error('[confirm-email] confirmation failed', error);
      this.state.set(error instanceof ApiError && error.status === 400 ? 'invalid' : 'retry');
    } finally {
      this.requestInFlight = false;
    }
  }
}

/**
 * `userId` arrives as a query-string value but `ConfirmEmailRequest.UserId` is
 * an `int` with no `AllowReadingFromString` on the API, so a string body would
 * come back as a `400` and look like a dead link. Coerce and validate here
 * before sending it, then use the same recovery state as an invalid token.
 */
function parseUserId(raw: string | null): number | null {
  if (raw === null || raw === '') {
    return null;
  }
  const userId = Number(raw);
  return Number.isInteger(userId) ? userId : null;
}
