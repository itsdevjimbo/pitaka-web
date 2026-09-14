import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Session } from '@/app/core/session';
import { ProfileEmail } from '../../ui/profile-email/profile-email';
import { ProfileIdentity } from '../../ui/profile-identity/profile-identity';
import { ProfilePassword } from '../../ui/profile-password/profile-password';

/** The Profile dashboard groups identity, email, and password settings. */
@Component({
  selector: 'app-profile',
  imports: [ProfileEmail, ProfileIdentity, ProfilePassword],
  templateUrl: './profile.html',
  host: { class: 'flex flex-auto flex-col' },
})
export default class AppProfile {
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  protected readonly profile = this.session.profile;
  protected readonly emailChangeConfirmed =
    this.router.getCurrentNavigation()?.extras.state?.['emailChangeConfirmed'] === true;
}
