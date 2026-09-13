import { Component, inject } from '@angular/core';
import { Session } from '@/app/core/session';
import { ProfileEmail } from '../../ui/profile-email/profile-email';
import { ProfileIdentity } from '../../ui/profile-identity/profile-identity';

/** The Profile dashboard groups identity, email, and password settings. */
@Component({
  selector: 'app-profile',
  imports: [ProfileEmail, ProfileIdentity],
  templateUrl: './profile.html',
  host: { class: 'flex flex-auto flex-col' },
})
export default class AppProfile {
  private readonly session = inject(Session);

  protected readonly profile = this.session.profile;
}
