import { packageWebBuild } from './web-build-artifact.mjs';

const [buildDirectory, artifactDirectory, sourceRevision, repository, runId, runAttempt] = process.argv.slice(2);
if ([buildDirectory, artifactDirectory, sourceRevision, repository, runId, runAttempt].some((value) => !value)) {
  process.stderr.write(
    'Usage: package-web-build.mjs <browser-output> <artifact-output> <full-sha> <owner/repo> <run-id> <run-attempt>\n',
  );
  process.exitCode = 1;
} else {
  packageWebBuild({ buildDirectory, artifactDirectory, sourceRevision, repository, runId, runAttempt })
    .then((manifest) => process.stdout.write(`${JSON.stringify(manifest)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
