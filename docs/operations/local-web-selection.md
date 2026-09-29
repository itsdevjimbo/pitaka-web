# Local web selection handoff

`Select Local Web Build` runs after a successful `Publish Build` completion. It
rechecks the exact publisher run, successful main `CI` attempt, uploaded artifact,
manifest, archive, and asset hashes before requesting a deploy-repository token.
It updates only `web` in `pitaka-deploy/versions/local.json` and reads the record
back before reporting success. Selecting inputs for the local stack does not run
smoke, apply, or report a deployment.

## GitHub configuration

Install the dedicated GitHub App on `itsdevjimbo/pitaka-deploy` only, with
Contents read and write permission and no Actions or workflow permission. Add the
App Client ID as the `PITAKA_DEPLOY_APP_CLIENT_ID` Actions repository variable
in `pitaka-web` and its private key as the `PITAKA_DEPLOY_APP_PRIVATE_KEY`
Actions secret. The workflow requests an installation token for `pitaka-deploy`
alone after the published build has passed verification.

## Recovery

The selection handoff is separate from publication, so a failed handoff leaves
the successful Actions artifact available under its original identity. Fix the
reported credential, provenance, deploy record, or write conflict, then rerun
the handoff while its artifact remains unexpired. If the artifact expired or
cannot be verified, publish a new successful main build to establish a new
checked identity. A divergent or removed source SHA requires human review; do
not force the local selection backward.

The updater mirrors the current `schemaVersion: 1` checks in
`pitaka-deploy/pitaka_deploy/versions.mjs` so it can validate the entire record
without executing code from the repository it is authorized to write. Keep that
mirror aligned if the deploy record schema changes.
