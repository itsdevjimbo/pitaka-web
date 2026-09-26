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

## Production web image

The production image is published to the public Docker Hub repository
`jimbodev0530/pitaka-web` after the `CI` workflow succeeds for a push to
`main`. It is available as `sha-<full-commit-sha>` and `main` tags.

Before the first successful publish:

1. Create the public `pitaka-web` repository in the Docker Hub namespace
   `jimbodev0530`.
2. Create a Docker Hub access token with read and write access to that
   repository. Add it to the GitHub repository actions secrets as
   `DOCKERHUB_TOKEN`, and add the matching account name as
   `DOCKERHUB_USERNAME`.
3. In the Docker Hub repository's **Settings → General → Tag mutability**,
   make tags matching `^sha-[0-9a-f]{40}$` immutable. The publish workflow also
   checks an existing commit tag's revision and never rebuilds or replaces it.

Run the image with an API upstream that the container can resolve and reach:

```sh
docker network create pitaka

docker run --rm -p 8080:8080 \
  --network pitaka \
  -e API_UPSTREAM=http://pitaka-api:8080 \
  jimbodev0530/pitaka-web:main
```

`API_UPSTREAM` is read when the container starts, so the image does not need a
machine-specific API hostname at build time. Its default, `http://api:8080`,
expects an `api` service on the same Docker network. The web server serves the
Angular application on port `8080`, sends `/api` requests to that upstream
without changing their paths, and falls back to `index.html` for browser
routes. Set `API_UPSTREAM` to the API origin without a path suffix. API errors
keep their upstream status and response body.
