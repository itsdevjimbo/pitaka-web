// Throwaway review app: real route shapes, deterministic fixtures, no API/session writes.
// Three structural compositions of the agreed screen families, selected by ?variant=A|B|C.
import { bootstrapApplication } from '@angular/platform-browser';
import { Component, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { provideRouter, RouterOutlet } from '@angular/router';
import ScreenPrototype from './screens';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    @if (phone) {
      <div class="phone-review">
        <header>
          {{ frameWidth }}px viewport · layout study
          <a [href]="fullUrl">Open full width</a>
        </header>
        <iframe
          [style.width.px]="frameWidth"
          [src]="frameUrl"
          title="Pocket Pop phone layout"
        ></iframe>
      </div>
    } @else {
      <router-outlet />
    }
  `,
})
class PrototypeRoot {
  readonly phone = ['phone', '320'].includes(new URLSearchParams(location.search).get('width') || '');
  readonly frameWidth = new URLSearchParams(location.search).get('width') === '320' ? 320 : 390;
  readonly fullUrl = (() => {
    const u = new URL(location.href);
    u.searchParams.delete('width');
    return u.href;
  })();
  readonly frameUrl = inject(DomSanitizer).bypassSecurityTrustResourceUrl(this.fullUrl);
}

bootstrapApplication(PrototypeRoot, {
  providers: [
    provideRouter([
      { path: '', pathMatch: 'full', redirectTo: 'app/accounts' },
      { path: '**', component: ScreenPrototype },
    ]),
  ],
}).catch(console.error);
