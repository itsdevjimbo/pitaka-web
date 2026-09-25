import { Component, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { map, type Observable } from 'rxjs';
import { EditorDismissal } from '@/app/core/dialog';
import { Session } from '@/app/core/session';
import { ProfileEmail } from '../../ui/profile-email/profile-email';
import { ProfileIdentity } from '../../ui/profile-identity/profile-identity';
import { ProfilePassword } from '../../ui/profile-password/profile-password';
import { ProfilePictureEditor } from '../../ui/profile-picture-editor/profile-picture-editor';

/** The Profile dashboard groups identity, email, and password settings. */
@Component({
  selector: 'app-profile',
  imports: [ProfileEmail, ProfileIdentity, ProfilePassword, ProfilePictureEditor],
  templateUrl: './profile.html',
  host: { class: 'flex flex-auto flex-col' },
})
export default class AppProfile {
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly editorDismissal = inject(EditorDismissal);

  private readonly identityEditor = viewChild(ProfileIdentity);
  private readonly pictureEditor = viewChild(ProfilePictureEditor);
  private readonly emailEditor = viewChild(ProfileEmail);
  private readonly passwordEditor = viewChild(ProfilePassword);

  protected readonly profile = this.session.profile;
  protected readonly emailChangeConfirmed =
    this.router.getCurrentNavigation()?.extras.state?.['emailChangeConfirmed'] === true;

  canDeactivate(): boolean | Observable<boolean> {
    if (this.session.profile() === null) {
      return true;
    }

    const editors = [this.identityEditor(), this.pictureEditor(), this.emailEditor(), this.passwordEditor()].filter(
      (editor): editor is Exclude<typeof editor, undefined> => editor !== undefined,
    );
    const pending = editors.find((editor) => editor.isWritePending());
    if (pending) {
      pending.notifyWritePending();
      return false;
    }

    const changed = editors.filter((editor) => editor.hasUnsavedChanges());
    if (changed.length === 0) {
      return true;
    }

    return this.editorDismissal.confirmDiscard().pipe(
      map((discard) => {
        if (discard) {
          for (const editor of changed) {
            editor.discardUnsavedChanges();
          }
        }
        return discard;
      }),
    );
  }
}
