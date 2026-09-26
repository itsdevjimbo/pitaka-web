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

CI runs formatting, standards checks, lint, tests, and a production build on
pushes to branches and pull requests targeting `main`. Only a successful push to
`main` uploads the checked browser files.

## Downloadable production web build

After all CI checks pass for a push to `main`, CI publishes a temporary Actions
artifact containing `pitaka-web-<full-SHA>.tar.gz` and its sidecar manifest. The
archive extracts with `index.html` at its root. The manifest records the source
repository and SHA, successful CI run and attempt, Node/npm/Angular build
toolchain, production build configuration, per-file asset identity, archive
SHA-256, and archive size. The archive checksum is kept in the sidecar because
putting it inside the archive would make the checksum self-referential.

Actions artifacts expire after 14 days. Download an exact build with Node 24,
`tar` and `unzip` on `PATH`, and a GitHub token with `Actions: read` access to
`itsdevjimbo/pitaka-web` (GitHub also requires repository metadata access):

```sh
SOURCE_SHA="<full-SHA>"
export GH_TOKEN="<token with Actions: read access>"
node scripts/download-web-build.mjs "$SOURCE_SHA" ./web-build
mkdir -p web-root
tar -xzf "./web-build/pitaka-web-${SOURCE_SHA}.tar.gz" -C web-root
```

The downloader searches successful `CI` runs for that exact main SHA, resolves
the matching artifact by run ID, attempt, name, and artifact ID, then verifies
the manifest, archive checksum, root layout, and asset identity. It rejects
conflicting successful retries and never selects a recent or latest artifact.
Missing or expired bytes produce a clear error; the source is never rebuilt as a
fallback. For a production-selected build that was copied to an immutable,
published GitHub Release, pass its version tag to retrieve that durable copy
after Actions expiry:

```sh
SOURCE_SHA="<full-SHA>"
VERSION_TAG="<immutable-version-tag>"
node scripts/download-web-build.mjs "$SOURCE_SHA" ./web-build \
  --release-tag "$VERSION_TAG"
```

## Static artifact publishing decision

[ADR 0018](docs/adr/0018-retain-promoted-web-builds-for-rollback.md) records the
accepted target: successful main builds produce exact-SHA static archives retained
in Actions for 14 days. Production-selected bytes belong in public immutable
GitHub Releases and remain available at least 90 days from their latest
promotion, protecting every active version and the last three successful
production versions.

#291 implements the temporary Actions artifact and exact-SHA downloader. The
version-tag promotion and durable-retention workflow is tracked separately in
[durable promotion #293](https://github.com/itsdevjimbo/pitaka-web/issues/293);
serving-image retirement is tracked in
[#294](https://github.com/itsdevjimbo/pitaka-web/issues/294). When production
selects a version tag, use the successful build for that exact tagged commit and
preserve its archive and manifest in an immutable release before deployment.
Attach both files to a draft release, then publish it with GitHub release
immutability enabled. The downloader checks the release tag's commit, immutability,
manifest, and original successful CI run. If neither the Actions artifact nor an
existing release copy is available, promotion must fail instead of rebuilding.
Only production-selected builds need durable storage. Selection and successful
deployment are separate records.

After consumer handoff, the separate deploy repository owns environment
composition, Nginx, Compose, and deployment control. This repository keeps the
current serving image and Nginx configuration until the handoff described by
[deploy issue #194](https://github.com/itsdevjimbo/pitaka/issues/194) is accepted.

## Current production web image (transition)

The compatibility serving image is published to the public Docker Hub
repository `jimbodev0530/pitaka-web` after the `CI` workflow succeeds for a
push to `main`. #291 builds it from the same verified static archive described
above, checks both supported architectures and container behavior, and verifies
the immutable `sha-<full-commit-sha>` image before advancing the moving `main`
tag. Image publishing does not apply environment state or act as a deployment
controller.

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
docker run --rm -p 8080:8080 \
  jimbodev0530/pitaka-web:main
```

Production browser requests remain relative to the same origin at `/api`; the
serving layer forwards those requests to its configured API upstream without
changing their paths. `API_UPSTREAM` is read when the image starts and defaults
to `http://api:8080`. Set it to the API origin without a path suffix when the
upstream uses a different hostname. Browser routes fall back to `index.html`,
and API errors keep their upstream status and response body.
