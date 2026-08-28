# Pitaka Web

Angular client for Pitaka, a personal expense tracker. The API is a separate
.NET repo.

This project is built on the Fuse 22.1.0 source with its demonstration material
removed — see `docs/adr/0001-build-on-the-fuse-source.md`.

## Prerequisites

Node 24 (see `.nvmrc`).

```bash
nvm use
npm install
```

## Development server

```bash
npm start
```

Navigate to `http://localhost:4200/`. The app reloads on source changes.

## Checks

```bash
npm run lint
npm test
npm run build
```

CI runs all three on every push and pull request.
