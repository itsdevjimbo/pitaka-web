# Local web selection handoff

`Select Local Web Build` runs after a successful `Publish Build` or
`Promote Production Build` completion. For a publisher run, it rechecks the exact
publisher run, successful main `CI` attempt, uploaded artifact, manifest, archive,
and asset hashes. For a promotion run, it rechecks the exact stable tag and run,
the tag target, the published immutable Release, both public assets, their hashes,
and the successful exact-SHA `CI` attempt. It completes those checks before
requesting a deploy-repository token.

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

## Recovery

The selection handoff is separate from publication and promotion, so a failed
handoff leaves the successful Actions artifact or immutable Release available
under its original identity. Fix the reported credential, provenance, deploy
record, or write conflict, then rerun the handoff. If the Actions artifact expired
or cannot be verified, publish a new successful main build to establish a new
checked identity. A divergent or removed source SHA requires human review; do
not force the local selection backward.

The updater validates the web selection in the deploy record. Validation of the
remaining deployment fields belongs to `pitaka-deploy`.
