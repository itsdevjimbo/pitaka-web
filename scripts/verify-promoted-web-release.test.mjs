import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyPromotedWebRelease } from './verify-promoted-web-release.mjs';
import { packageWebBuild } from './web-build-artifact.mjs';

const API_BASE_URL = 'https://api.github.com';
const REPOSITORY = 'itsdevjimbo/pitaka-web';
const SOURCE_SHA = 'a'.repeat(40);
const RELEASE_TAG = 'v1.0.0';

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function gitExec() {
  return (command, args) => {
    if (command === 'git' && (args[0] === 'fetch' || args[0] === 'merge-base')) {
      return Buffer.alloc(0);
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
}

async function makeReleaseFixture(t, { immutable = true, corruptArchive = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pitaka-web-release-selection-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const buildDirectory = join(root, 'build');
  const artifactDirectory = join(root, 'artifact');
  await mkdir(join(buildDirectory, 'assets'), { recursive: true });
  await writeFile(join(buildDirectory, 'index.html'), '<main>Pitaka</main>');
  await writeFile(join(buildDirectory, 'assets', 'main.js'), 'window.pitaka = true;');
  const manifest = await packageWebBuild({
    buildDirectory,
    artifactDirectory,
    sourceRevision: SOURCE_SHA,
    repository: REPOSITORY,
    runId: 125,
    runAttempt: 2,
    nodeVersion: 'v24.0.0',
    npmVersion: '11.0.0',
  });
  const archiveName = manifest.archive.name;
  const manifestName = `pitaka-web-${SOURCE_SHA}.manifest.json`;
  const archiveBytes = await readFile(join(artifactDirectory, archiveName));
  const manifestBytes = await readFile(join(artifactDirectory, manifestName));
  const release = {
    id: 700,
    tag_name: RELEASE_TAG,
    draft: false,
    prerelease: false,
    immutable,
    published_at: '2026-09-26T10:00:00Z',
    assets: [
      { id: 701, name: archiveName, state: 'uploaded', size: archiveBytes.length },
      { id: 702, name: manifestName, state: 'uploaded', size: manifestBytes.length },
    ],
  };
  for (const asset of release.assets) {
    asset.url = `${API_BASE_URL}/repos/${REPOSITORY}/releases/assets/${asset.id}`;
    asset.browser_download_url = `https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}/${asset.name}`;
  }
  const contents = new Map([
    [701, corruptArchive ? Buffer.from(archiveBytes).fill(0) : archiveBytes],
    [702, manifestBytes],
  ]);
  const publicRequests = [];
  const workflow = {
    id: 910,
    name: 'Promote Production Build',
    path: '.github/workflows/promote-production-build.yml',
    state: 'active',
  };
  const promotionRun = {
    id: 500,
    run_attempt: 2,
    name: workflow.name,
    workflow_id: workflow.id,
    head_sha: SOURCE_SHA,
    head_branch: RELEASE_TAG,
    head_repository: { full_name: REPOSITORY },
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  };
  const ciWorkflow = { id: 911, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' };
  const ciRun = {
    id: 125,
    run_attempt: 2,
    name: 'CI',
    workflow_id: ciWorkflow.id,
    head_sha: SOURCE_SHA,
    head_branch: 'main',
    head_repository: { full_name: REPOSITORY },
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const pathname = url.pathname.replace(`/repos/${REPOSITORY}`, '');
    if (pathname === '/actions/workflows/promote-production-build.yml') {
      return responseJson(workflow);
    }
    if (pathname === '/actions/runs/500/attempts/2') {
      return responseJson(promotionRun);
    }
    if (pathname === '/actions/workflows/ci.yml') {
      return responseJson(ciWorkflow);
    }
    if (pathname === '/actions/runs/125/attempts/2') {
      return responseJson(ciRun);
    }
    if (pathname === `/commits/${RELEASE_TAG}`) {
      return responseJson({ sha: SOURCE_SHA });
    }
    if (pathname === `/releases/tags/${RELEASE_TAG}`) {
      return responseJson(release);
    }
    const assetMatch = pathname.match(/^\/releases\/assets\/(\d+)$/);
    if (assetMatch) {
      return new Response(contents.get(Number(assetMatch[1])));
    }
    if (url.hostname === 'github.com') {
      publicRequests.push({ url: String(url), headers: options.headers ?? {} });
      const asset = release.assets.find((candidate) => candidate.browser_download_url === String(url));
      const id = asset?.id;
      return id ? new Response(contents.get(id)) : new Response('missing', { status: 404 });
    }
    return responseJson({ message: `unexpected request ${url}` }, 500);
  };
  return { release, publicRequests, fetchImpl };
}

test('verifies the successful promotion, immutable Release, public bytes, and exact CI attempt', async (t) => {
  const fixture = await makeReleaseFixture(t);
  const verified = await verifyPromotedWebRelease({
    promotionRunId: 500,
    promotionRunAttempt: 2,
    expectedSourceSha: SOURCE_SHA,
    releaseTag: RELEASE_TAG,
    token: 'read-token',
    fetchImpl: fixture.fetchImpl,
    execFileSyncImpl: gitExec(),
  });

  assert.equal(verified.web.sourceSha, SOURCE_SHA);
  assert.equal(verified.web.source.kind, 'release');
  assert.equal(verified.web.source.releaseId, fixture.release.id);
  assert.equal(verified.web.source.archiveAssetId, 701);
  assert.equal(verified.web.source.manifestAssetId, 702);
  assert.equal(verified.web.source.ciRunId, 125);
  assert.equal(verified.web.source.ciRunAttempt, 2);
  assert.match(verified.web.archive.sha256, /^[a-f0-9]{64}$/);
  assert.equal(verified.promotionRun.id, 500);
  assert.equal(verified.promotionRun.attempt, 2);
  assert.equal(fixture.publicRequests.length, 2);
  assert.ok(fixture.publicRequests.every(({ headers }) => Object.keys(headers).length === 0));
});

test('rejects a Release that is not published and immutable', async (t) => {
  const fixture = await makeReleaseFixture(t, { immutable: false });
  await assert.rejects(
    verifyPromotedWebRelease({
      promotionRunId: 500,
      promotionRunAttempt: 2,
      expectedSourceSha: SOURCE_SHA,
      releaseTag: RELEASE_TAG,
      token: 'read-token',
      fetchImpl: fixture.fetchImpl,
      execFileSyncImpl: gitExec(),
    }),
    (error) => {
      assert.match(error.message, /published immutable Release/);
      assert.deepEqual(error.releaseVerification.release, { id: 700, tag: RELEASE_TAG });
      assert.deepEqual(error.releaseVerification.promotionRun, { id: 500, attempt: 2, workflowId: 910 });
      return true;
    },
  );
  assert.equal(fixture.publicRequests.length, 0);
});

test('rejects public Release bytes that do not match the verified manifest', async (t) => {
  const fixture = await makeReleaseFixture(t, { corruptArchive: true });
  await assert.rejects(
    verifyPromotedWebRelease({
      promotionRunId: 500,
      promotionRunAttempt: 2,
      expectedSourceSha: SOURCE_SHA,
      releaseTag: RELEASE_TAG,
      token: 'read-token',
      fetchImpl: fixture.fetchImpl,
      execFileSyncImpl: gitExec(),
    }),
    /checksum or size does not match its manifest/,
  );
});
