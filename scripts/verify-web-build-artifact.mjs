import { verifyWebBuildArtifact } from './web-build-artifact.mjs';

const [artifactDirectory, sourceRevision, repository, runId, runAttempt] = process.argv.slice(2);
if ([artifactDirectory, sourceRevision, repository].some((value) => !value)) {
  process.stderr.write(
    'Usage: verify-web-build-artifact.mjs <artifact-directory> <full-sha> <owner/repo> [run-id] [run-attempt]\n',
  );
  process.exitCode = 1;
} else {
  verifyWebBuildArtifact({ artifactDirectory, sourceRevision, repository, runId, runAttempt })
    .then((manifest) => process.stdout.write(`${JSON.stringify(manifest)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
