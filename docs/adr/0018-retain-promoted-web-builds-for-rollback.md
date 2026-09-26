---
status: accepted
---

# Retain promoted web builds for rollback

For [web artifact publication #291](https://github.com/itsdevjimbo/pitaka-web/issues/291),
keep successful main candidates temporarily for 14 days and preserve builds selected
for production promotion in durable storage with public downloads. Retain promoted
builds for at least 90 days, always protecting all active versions and the last
three successful production versions even when older; this bounds routine retention
without discarding versions still needed for operation or rollback.

An expired candidate without a durable copy cannot be silently rebuilt or replaced
with another build under its old identity. A new checked build requires a new
identity. Retaining frontend bytes does not establish compatibility with an older
API or database schema.

Use public immutable GitHub Releases in `itsdevjimbo/pitaka-web` for durable
archives, rather than introducing R2. Enable release immutability before publishing
these releases, attach the verified archive and manifest to a draft, and publish
only after the assets are complete. Promotion reuses the checked bytes without
rebuilding Angular.

Pushing a production version tag such as `v1.0.0` selects the tagged commit's
existing build for production promotion. The commit must belong to `main` and
have passed the required checks for that exact SHA. Verify and preserve its
archive in the immutable GitHub Release before deployment; if neither the
temporary archive nor an existing durable copy is available, fail promotion
instead of rebuilding. A version tag records selection for production, not a
successful deployment.

Count the 90-day minimum from the most recent production promotion of a build,
including a repeat promotion. Preserve the archive before deployment starts; a
failed deployment leaves it retained, but does not count toward the last three
successful production versions. Promotion attempts and successful deployments must
therefore be recorded separately by the deployment owner.

Cleanup starts as a manually reviewed operation. Expiry permits deletion but does
not require it. Before deleting a release, verify that its build is neither active
nor among the last three successful production versions and that its retention
window has elapsed. If deployment records are unavailable, retain the build.
GitHub permits deleting an immutable release, but its tag name cannot be reused;
individual immutable assets cannot be deleted or replaced. See
[GitHub's immutable release documentation](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).

These requirements, including version-tag promotion, were agreed during the design
interview. Implementation is tracked separately: [main artifacts #291](https://github.com/itsdevjimbo/pitaka-web/issues/291)
and [version-tag promotion #293](https://github.com/itsdevjimbo/pitaka-web/issues/293).
CI runs tests only. After successful main CI, the `Publish Web Build` workflow
runs format and lint checks, builds the production browser output, and uploads
the temporary Actions archive. It does not yet implement durable promotion or
retention enforcement. The separate
[deployment consumer #194](https://github.com/itsdevjimbo/pitaka/issues/194)
owns static serving and API proxying.
