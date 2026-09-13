import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Session } from '@/app/core/session';
import { ProfileIdentity } from '../../ui/profile-identity/profile-identity';

/** The Profile dashboard groups identity, email, and password settings. */
@Component({
  selector: 'app-profile',
  imports: [MatButton, MatIcon, ProfileIdentity],
  templateUrl: './profile.html',
  host: { class: 'flex flex-auto flex-col' },
})
export default class AppProfile {
  private readonly session = inject(Session);

  protected readonly profile = this.session.profile;
}
