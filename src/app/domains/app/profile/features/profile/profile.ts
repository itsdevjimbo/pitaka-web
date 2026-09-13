import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Session } from '@/app/core/session';

/**
 * The Profile dashboard reads the Session's live identity. Its actions become
 * inline editors in the succeeding Profile tickets; this first screen gives
 * each action a stable, responsive home without duplicating Profile state.
 */
@Component({
  selector: 'app-profile',
  imports: [MatButton, MatIcon],
  templateUrl: './profile.html',
  host: { class: 'flex flex-auto flex-col' },
})
export default class AppProfile {
  private readonly session = inject(Session);

  protected readonly profile = this.session.profile;
}
