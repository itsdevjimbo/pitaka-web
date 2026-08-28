---
status: accepted
---

# Build on the Fuse 22.1 source rather than a fresh Angular project

Pitaka Web starts as the licensed Fuse 22.1.0 archive with its demonstration material removed, rather than as `ng new` with Fuse pieces copied in. Fuse's shell, layout system, and theming are the hardest parts to reproduce and the least valuable to rewrite, and the archive pins a coherent toolchain (Angular 22.1.1, CLI/build 22.1.3, TypeScript 6.0.3, Tailwind 4.3.3, Vitest 4.1.10, Node ≥24) that we would otherwise have to assemble ourselves.

## Consequences

- The first commit is unmodified Fuse 22.1.0. Everything we change is a diff against that baseline, so "did this come from Fuse or from us?" is always answerable, and any deleted Fuse screen is recoverable with `git checkout`.
- The strip removes the `website`, `coming-soon`, and `maintenance` domains, the demo modules and fake data, demo images, and SSR (`@angular/ssr`, `express`, `api/index.mjs`, `vercel.json`, the server config and routes). Pitaka Web is a client-rendered SPA; it is entirely authenticated, so there is no SEO surface to serve.
- Transloco and its `en`/`es` files are removed. Pitaka Web is English-only. Reintroducing i18n later is mechanical, and the app is small enough that the retrofit cost stays proportional.
- Fuse's `domains/admin` is renamed `domains/app`. The API has no roles and no authorization policies — every protected endpoint is a bare `[Authorize]` — so nothing here is an admin area.
- Fuse's forgot-password and reset-password screens are deleted, because the API has no endpoint, token store, or email sender behind them. A dead password-reset link is worse than an absent one.
- The dev server runs on Angular's default port 4200, not Fuse's 3873.
