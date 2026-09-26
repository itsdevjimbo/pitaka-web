# Production web releases

Pushing a production version tag such as `v1.0.0` selects an already checked
production web build for preservation. The tag must be a stable `vMAJOR.MINOR.PATCH`
version, point to a commit reachable from `main`, and have a successful `CI` run
for that exact commit. `CI` runs the formatting, changed-source, lint, standards,
web-artifact, and full application test gates. `Publish Build` then creates the
production Angular build and publishes the exact-SHA temporary artifact. The
promotion workflow does not compile Angular and does not report deployment
success.

## Repository setup

Enable release immutability in the repository before pushing a production tag:
open **Settings → General → Releases** and select **Enable release immutability**.
GitHub applies this setting to releases published after it is enabled. See
[GitHub's release immutability setup](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes).

The workflow uses two credentials with separate minimum permissions:

- The workflow's `GITHUB_TOKEN` needs **Actions: read** to identify and retrieve
  the exact successful CI artifact, and **Contents: write** to create a draft
  Release, upload its assets, and publish it.
- The repository secret `RELEASE_IMMUTABILITY_TOKEN` must be a fine-grained
  token or GitHub App token with **Administration: read** for this repository.
  The workflow checks the repository immutability setting and stops before
  publication if the setting is off or cannot be read.

The publisher downloads by source SHA and artifact identity, verifies the
manifest, archive checksum, root `index.html`, and extracted file layout, then
uploads those same archive and manifest bytes to a draft Release. It checks for
matching existing Releases and rejects conflicting retries. It verifies both
assets before publishing and verifies public downloads and checksums afterward.
If the 14-day Actions artifact has expired, a verified immutable Release for
that same source SHA can supply the bytes. Otherwise promotion fails; it never
rebuilds or substitutes a newer build.

## Downloads and handoff

Published Releases are public and durable. Their stable download URLs are:

```text
https://github.com/itsdevjimbo/pitaka-web/releases/download/<version-tag>/pitaka-web-<full-source-sha>.tar.gz
https://github.com/itsdevjimbo/pitaka-web/releases/download/<version-tag>/pitaka-web-<full-source-sha>.manifest.json
```

Deployment automation can retrieve temporary Actions artifacts with a token
that has **Actions: read**. The existing downloader verifies the complete
archive before returning it. A production deployment must wait for the
`Promote Production Build` workflow to succeed and require the tagged immutable
Release; `--require-release` prevents fallback to a temporary Actions artifact:

```sh
GH_TOKEN=<actions-read-token> node scripts/download-web-build.mjs \
  <full-source-sha> <empty-output-directory> --release-tag <version-tag> --require-release
```

The manifest records source repository and SHA, successful CI run and attempt,
Actions artifact name, toolchain and lockfile identity, file layout, archive
size, and archive SHA-256. The promotion summary and Release body also record
the selection time and artifact identity. Each workflow run summary records
the current selection or attempt time, so rerunning a matching immutable
selection preserves the latest promotion time there. Those records identify
production selection; the deployment owner separately records each deployment
attempt and whether it succeeded.

## Retention and monitoring

Keep each production-selected archive for at least 90 days after its latest
promotion. GitHub Releases do not expire automatically, so this repository does
not run an expiry job. A repeat selection of the same build uses a new unused
version tag and creates a new immutable Release. Failed deployment attempts do
not shorten retention.

Before any manual cleanup, confirm the release is not the active production
version, is not among the last three successful production versions, and has
passed its 90-day retention period. Cleanup requires manual review as part of
the recovery work; this workflow never deletes releases. If deployment records
are unavailable, retain the build. The selection record does not establish
compatibility with an older API or database schema.

`Publish Build` reports each temporary Actions artifact's size in its run
summary. Monitor repository Actions storage usage and the archive sizes on
published Release assets. Missing size telemetry does not block publication,
but GitHub's repository Actions storage usage should be checked periodically.
