import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { downloadWebBuild } from './download-web-build.mjs';
import { packageWebBuild, verifyWebBuildArtifact } from './web-build-artifact.mjs';

const sourceRevision = 'a'.repeat(40);
const repository = 'test/pitaka-web';
const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'pitaka-web-build-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createArtifact(
  rootDirectory,
  { runId = 100, runAttempt = 1, indexHtml = '<app-root></app-root>' } = {},
) {
  const buildDirectory = join(rootDirectory, 'browser');
  const artifactDirectory = join(rootDirectory, 'artifact');
  await mkdir(join(buildDirectory, 'assets'), { recursive: true });
  await writeFile(join(buildDirectory, 'index.html'), indexHtml);
  await writeFile(join(buildDirectory, 'assets', 'main.js'), 'window.pitaka = true;');
  const manifest = await packageWebBuild({
    buildDirectory,
    artifactDirectory,
    sourceRevision,
    repository,
    runId,
    runAttempt,
    nodeVersion: 'v24.0.0',
    npmVersion: '11.0.0',
  });
  return { artifactDirectory, manifest };
}

function zipArtifact(artifactDirectory, manifest) {
  const zipPath = join(artifactDirectory, 'actions-artifact.zip');
  execFileSync('zip', ['-q', zipPath, manifest.archive.name, `pitaka-web-${sourceRevision}.manifest.json`], {
    cwd: artifactDirectory,
  });
  return zipPath;
}

function responseJson(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('packages the browser files at archive root and verifies the manifest hashes', async () => {
  const directory = await createTemporaryDirectory();
  const { artifactDirectory, manifest } = await createArtifact(directory);
  const verified = await verifyWebBuildArtifact({
    artifactDirectory,
    sourceRevision,
    repository,
    runId: 100,
    runAttempt: 1,
  });
  const archiveList = execFileSync('tar', ['-tzf', join(artifactDirectory, manifest.archive.name)], {
    encoding: 'utf8',
  });

  assert.equal(verified.archive.sha256, manifest.archive.sha256);
  assert.match(archiveList, /^index\.html$/m);
  assert.equal(manifest.assets.fileCount, 2);
  assert.equal(manifest.actionsArtifact.retentionDays, 14);
});

test('retries with identical browser assets produce identical archive bytes', async () => {
  const directory = await createTemporaryDirectory();
  const first = await createArtifact(join(directory, 'first'), { runId: 102, runAttempt: 1 });
  const second = await createArtifact(join(directory, 'second'), { runId: 102, runAttempt: 2 });

  assert.equal(first.manifest.archive.sha256, second.manifest.archive.sha256);
});

test('preserves long asset paths in the extracted archive', async () => {
  const directory = await createTemporaryDirectory();
  const buildDirectory = join(directory, 'browser');
  const artifactDirectory = join(directory, 'artifact');
  const longAssetPath = `assets/${'x'.repeat(140)}/${'y'.repeat(140)}.svg`;
  const longAsset = join(buildDirectory, ...longAssetPath.split('/'));
  await mkdir(dirname(longAsset), { recursive: true });
  await writeFile(join(buildDirectory, 'index.html'), '<app-root></app-root>');
  await writeFile(longAsset, '<svg/>');
  const manifest = await packageWebBuild({
    buildDirectory,
    artifactDirectory,
    sourceRevision,
    repository,
    runId: 103,
    runAttempt: 1,
    nodeVersion: 'v24.0.0',
    npmVersion: '11.0.0',
  });

  const verified = await verifyWebBuildArtifact({
    artifactDirectory,
    sourceRevision,
    repository,
    runId: 103,
    runAttempt: 1,
  });

  assert.ok(verified.assets.files.some(({ path }) => path === longAssetPath));
  assert.equal(verified.archive.sha256, manifest.archive.sha256);
});

test('rejects an archive whose bytes no longer match its manifest', async () => {
  const directory = await createTemporaryDirectory();
  const { artifactDirectory, manifest } = await createArtifact(directory);
  await writeFile(join(artifactDirectory, manifest.archive.name), 'changed bytes');

  await assert.rejects(
    verifyWebBuildArtifact({ artifactDirectory, sourceRevision, repository, runId: 100, runAttempt: 1 }),
    /checksum or size does not match/,
  );
});

test('downloads the artifact from a successful run with the requested head SHA', async () => {
  const directory = await createTemporaryDirectory();
  const { artifactDirectory, manifest } = await createArtifact(directory, { runId: 101 });
  const zipPath = zipArtifact(artifactDirectory, manifest);
  const zipContents = await readFile(zipPath);
  const apiBaseUrl = 'https://api.test';
  const runId = 101;
  const artifactId = 501;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/actions/runs')) {
      return responseJson({
        workflow_runs: [
          {
            id: 99,
            name: 'CI',
            head_sha: 'b'.repeat(40),
            head_branch: 'main',
            event: 'push',
            status: 'completed',
            conclusion: 'success',
            run_attempt: 1,
          },
          {
            id: runId,
            name: 'CI',
            head_sha: sourceRevision,
            head_branch: 'main',
            event: 'push',
            status: 'completed',
            conclusion: 'success',
            run_attempt: 1,
          },
        ],
      });
    }
    if (url.pathname.endsWith(`/actions/runs/${runId}/artifacts`)) {
      return responseJson({
        artifacts: [
          {
            id: artifactId,
            name: manifest.actionsArtifact.name,
            expired: false,
            archive_download_url: `${apiBaseUrl}/artifacts/${artifactId}.zip`,
          },
        ],
      });
    }
    if (url.pathname === `/artifacts/${artifactId}.zip`) {
      return new Response(zipContents, { status: 200 });
    }
    return new Response('', { status: 404 });
  };
  const destinationDirectory = join(directory, 'download');

  const result = await downloadWebBuild({
    sourceRevision,
    destinationDirectory,
    repository,
    token: 'test-token',
    apiBaseUrl,
    fetchImpl,
  });

  assert.equal(result.source, 'actions');
  assert.equal(result.artifactId, artifactId);
  assert.equal(result.ciRunId, runId);
  assert.deepEqual(
    (await readdir(destinationDirectory)).sort(),
    [manifest.archive.name, `pitaka-web-${sourceRevision}.manifest.json`].sort(),
  );
});

test('rejects successful retries for the same SHA when their archive bytes conflict', async () => {
  const directory = await createTemporaryDirectory();
  const first = await createArtifact(join(directory, 'first'), { runId: 201 });
  const secondRoot = join(directory, 'second');
  await mkdir(secondRoot);
  const second = await createArtifact(secondRoot, { runId: 202, indexHtml: '<app-root>different</app-root>' });
  const firstZip = await readFile(zipArtifact(first.artifactDirectory, first.manifest));
  const secondZip = await readFile(zipArtifact(second.artifactDirectory, second.manifest));
  const apiBaseUrl = 'https://api.test';
  const runs = [first, second].map(({ manifest }, index) => ({
    id: 201 + index,
    name: 'CI',
    head_sha: sourceRevision,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    artifactName: manifest.actionsArtifact.name,
    artifactId: 601 + index,
  }));
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/actions/runs')) {
      return responseJson({ workflow_runs: runs });
    }
    const run = runs.find(({ id }) => url.pathname.endsWith(`/actions/runs/${id}/artifacts`));
    if (run) {
      return responseJson({
        artifacts: [
          {
            id: run.artifactId,
            name: run.artifactName,
            expired: false,
            archive_download_url: `${apiBaseUrl}/artifacts/${run.artifactId}.zip`,
          },
        ],
      });
    }
    if (url.pathname === '/artifacts/601.zip') {
      return new Response(firstZip, { status: 200 });
    }
    if (url.pathname === '/artifacts/602.zip') {
      return new Response(secondZip, { status: 200 });
    }
    return new Response('', { status: 404 });
  };

  await assert.rejects(
    downloadWebBuild({
      sourceRevision,
      destinationDirectory: join(directory, 'download'),
      repository,
      token: 'test-token',
      apiBaseUrl,
      fetchImpl,
    }),
    /Conflicting successful CI retries produced different web bytes/,
  );
});

test('does not choose a remaining retry when another matching artifact has expired', async () => {
  const directory = await createTemporaryDirectory();
  const { artifactDirectory, manifest } = await createArtifact(directory, { runId: 251 });
  const zipContents = await readFile(zipArtifact(artifactDirectory, manifest));
  const apiBaseUrl = 'https://api.test';
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/actions/runs')) {
      return responseJson({
        workflow_runs: [
          {
            id: 251,
            name: 'CI',
            head_sha: sourceRevision,
            head_branch: 'main',
            event: 'push',
            status: 'completed',
            conclusion: 'success',
            run_attempt: 1,
          },
          {
            id: 252,
            name: 'CI',
            head_sha: sourceRevision,
            head_branch: 'main',
            event: 'push',
            status: 'completed',
            conclusion: 'success',
            run_attempt: 1,
          },
        ],
      });
    }
    if (url.pathname.endsWith('/actions/runs/251/artifacts')) {
      return responseJson({
        artifacts: [
          {
            id: 751,
            name: manifest.actionsArtifact.name,
            expired: false,
            archive_download_url: `${apiBaseUrl}/artifacts/751.zip`,
          },
        ],
      });
    }
    if (url.pathname.endsWith('/actions/runs/252/artifacts')) {
      return responseJson({
        artifacts: [
          {
            id: 752,
            name: `pitaka-web-${sourceRevision}-run-252-attempt-1`,
            expired: true,
          },
        ],
      });
    }
    if (url.pathname === '/artifacts/751.zip') {
      return new Response(zipContents, { status: 200 });
    }
    return new Response('', { status: 404 });
  };

  await assert.rejects(
    downloadWebBuild({
      sourceRevision,
      destinationDirectory: join(directory, 'download'),
      repository,
      token: 'test-token',
      apiBaseUrl,
      fetchImpl,
    }),
    /matching retry artifact .* has expired.*No source rebuild was attempted/,
  );
});

test('reports expired Actions bytes and does not select another revision', async () => {
  const directory = await createTemporaryDirectory();
  const apiBaseUrl = 'https://api.test';
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/actions/runs')) {
      return responseJson({
        workflow_runs: [
          {
            id: 301,
            name: 'CI',
            head_sha: sourceRevision,
            head_branch: 'main',
            event: 'push',
            status: 'completed',
            conclusion: 'success',
            run_attempt: 1,
          },
        ],
      });
    }
    if (url.pathname.endsWith('/actions/runs/301/artifacts')) {
      return responseJson({
        artifacts: [
          {
            id: 701,
            name: `pitaka-web-${sourceRevision}-run-301-attempt-1`,
            expired: true,
          },
        ],
      });
    }
    return new Response('', { status: 404 });
  };

  await assert.rejects(
    downloadWebBuild({
      sourceRevision,
      destinationDirectory: join(directory, 'download'),
      repository,
      token: 'test-token',
      apiBaseUrl,
      fetchImpl,
    }),
    /14-day Actions artifact .* has expired.*No source rebuild was attempted/,
  );
});

test('retrieves an existing immutable release after the Actions artifact expires', async () => {
  const directory = await createTemporaryDirectory();
  const { artifactDirectory, manifest } = await createArtifact(directory, { runId: 401 });
  const archive = await readFile(join(artifactDirectory, manifest.archive.name));
  const sidecarName = `pitaka-web-${sourceRevision}.manifest.json`;
  const sidecar = await readFile(join(artifactDirectory, sidecarName));
  const apiBaseUrl = 'https://api.test';
  const versionTag = 'v1.2.3';
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/actions/runs')) {
      return responseJson({
        workflow_runs: [
          {
            id: 401,
            name: 'CI',
            head_sha: sourceRevision,
            head_branch: 'main',
            event: 'push',
            status: 'completed',
            conclusion: 'success',
            run_attempt: 1,
          },
        ],
      });
    }
    if (url.pathname.endsWith('/actions/runs/401/artifacts')) {
      return responseJson({
        artifacts: [
          {
            id: 801,
            name: manifest.actionsArtifact.name,
            expired: true,
          },
        ],
      });
    }
    if (url.pathname.endsWith(`/releases/tags/${versionTag}`)) {
      return responseJson({
        tag_name: versionTag,
        draft: false,
        prerelease: false,
        immutable: true,
        assets: [
          {
            id: 901,
            name: manifest.archive.name,
            state: 'uploaded',
            browser_download_url: `${apiBaseUrl}/release/archive`,
          },
          { id: 902, name: sidecarName, state: 'uploaded', browser_download_url: `${apiBaseUrl}/release/manifest` },
        ],
      });
    }
    if (url.pathname.endsWith(`/commits/${versionTag}`)) {
      return responseJson({ sha: sourceRevision });
    }
    if (url.pathname.endsWith('/actions/runs/401/attempts/1')) {
      return responseJson({
        name: 'CI',
        head_sha: sourceRevision,
        head_branch: 'main',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
      });
    }
    if (url.pathname === '/release/archive') {
      return new Response(archive, { status: 200 });
    }
    if (url.pathname === '/release/manifest') {
      return new Response(sidecar, { status: 200 });
    }
    return new Response('', { status: 404 });
  };
  const destinationDirectory = join(directory, 'download');

  const result = await downloadWebBuild({
    sourceRevision,
    destinationDirectory,
    repository,
    releaseTag: versionTag,
    token: 'test-token',
    apiBaseUrl,
    fetchImpl,
  });

  assert.equal(result.source, 'release');
  assert.equal(result.releaseTag, versionTag);
  assert.equal(result.archiveSha256, manifest.archive.sha256);
});
