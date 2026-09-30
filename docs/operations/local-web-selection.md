# Local web selection handoff

`Select Local Web Build` runs automatically after a successful `Publish Build` or
`Promote Production Build` completion and can be invoked manually to reconcile a
failed handoff. For a publisher run, it rechecks the exact publisher run,
successful main `CI` attempt, uploaded artifact, manifest, archive, and asset
hashes. For a promotion run or manually selected Release, it rechecks the stable
tag target, published immutable Release, both public assets, their hashes, and the
successful exact-SHA `CI` attempt. Automatic promotion also verifies the exact
promotion run. All source checks finish before the workflow requests a
deploy-repository token.

The handoff validates the existing web selection, updates only `web` in
`pitaka-deploy/versions/local.json`, and reads that selection back before reporting
success. Promotion upgrades an Actions selection only when its source SHA and
archive and asset tree hashes match the Release. A promotion of another SHA or a
repeat promotion of an already selected Release leaves the current selection in
place. The updater preserves the API, configuration, and supporting image fields
without validating them. Selecting inputs for the local stack does not run smoke,
apply, or report a deployment.

## GitHub configuration

Install the dedicated GitHub App on `itsdevjimbo/pitaka-deploy` only, with
Contents read and write permission and no Actions or workflow permission. Add the
App Client ID as the `PITAKA_DEPLOY_APP_CLIENT_ID` Actions repository variable
in `pitaka-web` and its private key as the `PITAKA_DEPLOY_APP_PRIVATE_KEY`
Actions secret. The workflow requests an installation token for `pitaka-deploy`
alone after the Actions candidate or immutable Release has passed verification.

The App installation and branch rules for `pitaka-deploy/main` must allow this App
to update `versions/local.json`. To rotate the private key, create the replacement
key in the App settings, replace `PITAKA_DEPLOY_APP_PRIVATE_KEY`, verify a handoff
or reconciliation run can mint a token, and then delete the old key. A Client ID
change requires updating `PITAKA_DEPLOY_APP_CLIENT_ID` as a separate operation.

## Rerun or reconcile

Rerun a failed `Select Local Web Build` job when its original workflow event still
identifies the intended source. The rerun re-verifies that source and is
idempotent: an already current or validly superseded selection succeeds without a
commit.

Use **Run workflow** on `Select Local Web Build` when the original handoff cannot
be rerun or when recovery should explicitly choose a different durable source.
Run it from `main` and supply exactly one source identity:

- For `source_type: actions`, enter the successful `Publish Build` run ID and its
  run attempt. Leave `release_tag` empty.
- For `source_type: release`, enter the immutable `vMAJOR.MINOR.PATCH` Release tag.
  Leave both publisher run fields empty.

An explicitly reconciled Release is a recovery source, not a new promotion event.
Its verified tag target may advance an older selected SHA by main ancestry, and a
newer selected SHA validly supersedes it. A divergent or removed selection stops
for review. When it replaces an Actions selection of the same SHA, its archive and
asset tree hashes must match those already selected.

The reconciler accepts no source SHA, asset URL, or pasted `web` record. It derives
those fields from GitHub and uses the same verification, ordering, conditional
write, three-attempt retry, and read-back path as automatic handoffs. Its summary
records the source identity, selection before and after, write-attempt count,
outcome, and a recovery instruction. An unresolved failure also emits an error
annotation.

## Recovery

The selection handoff is separate from publication and promotion, so a failed
handoff leaves the successful Actions artifact or immutable Release available
under its original identity. Fix the reported credential, provenance, deploy
record, or write conflict, then rerun the handoff. If the Actions artifact expired
or cannot be verified, it cannot be reconciled under the expired identity. An
independently verified immutable Release for the same SHA may be reconciled by its
tag; otherwise publish a new successful main build to establish a new checked
identity. A divergent or removed selected SHA requires human review; do not force
the local selection backward. Authentication or branch-rule failure, a malformed
deploy record, provenance or byte mismatch, and exhausted conflicts leave the
selection unresolved until their reported cause is corrected.

The updater validates the web selection in the deploy record. Validation of the
remaining deployment fields belongs to `pitaka-deploy`. Selection only changes
the version used by the local stack; neither automatic handoff nor reconciliation
runs smoke, apply, or any deployment.
