import { Component, computed, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Session } from '@/app/core/session';

type ProfilePictureAppearance = 'profile' | 'profile-editor' | 'user-menu';

const AVATAR_STYLES: Record<ProfilePictureAppearance, { image: string; fallback: string; icon: string }> = {
  profile: {
    image: 'size-14 shrink-0 rounded-full bg-soft object-cover',
    fallback:
      'flex size-14 shrink-0 items-center justify-center rounded-full bg-soft text-primary-700 dark:text-primary-200',
    icon: 'size-7',
  },
  'profile-editor': {
    image: 'size-full object-cover',
    fallback: 'flex size-full items-center justify-center rounded-full bg-soft text-primary-700 dark:text-primary-200',
    icon: 'size-12! text-5xl!',
  },
  'user-menu': {
    image: 'size-9 shrink-0 rounded-lg bg-soft object-cover',
    fallback: 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-soft',
    icon: 'size-5',
  },
};

/** Renders the signed-in Profile picture with its shared person-icon fallback. */
@Component({
  selector: 'profile-picture-avatar',
  imports: [MatIcon],
  templateUrl: './profile-picture-avatar.html',
  host: { class: 'flex shrink-0' },
})
export class ProfilePictureAvatar {
  private readonly session = inject(Session);

  readonly appearance = input.required<ProfilePictureAppearance>();
  protected readonly pictureUrl = computed(() => this.session.profilePictureUrl());
  protected readonly avatarStyles = computed(() => AVATAR_STYLES[this.appearance()]);

  protected profilePictureDecodeFailed(url: string): void {
    this.session.profilePictureDecodeFailed(url);
  }
}
