import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyFailureRecovery,
  applyLocalWebSelection,
  compareWebSelections,
  prepareActionsSelection,
  prepareReconciliationSelection,
  prepareReleaseSelection,
  validateRecordWebSelection,
  writeSelectionSummary,
} from './local-web-selection.mjs';
import { packageWebBuild } from './web-build-artifact.mjs';

const API_BASE_URL = 'https://api.github.com';
const SOURCE_SHA = 'a'.repeat(40);
const CURRENT_SHA = 'b'.repeat(40);
const LATER_SHA = 'c'.repeat(40);
const NOW = new Date();

function responseJson(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function gitExec(ancestors = new Set()) {
  return (command, args, options) => {
    if (command === 'git' && args[0] === 'fetch') {
      return Buffer.alloc(0);
    }
    if (command === 'git' && args[0] === 'merge-base') {
      const pair = `${args[2]}:${args[3]}`;
      if (ancestors.has(pair)) {
        return Buffer.alloc(0);
      }
      const error = new Error('not an ancestor');
      error.status = 1;
      throw error;
    }
    return execFileSync(command, args, options);
  };
}

function makeActionsWeb({
  sourceSha = SOURCE_SHA,
  workflowRunId = 500,
  workflowRunAttempt = 1,
  workflowId = 900,
  artifactId = 800,
  ciRunId = 125,
  ciRunAttempt = 2,
  expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
} = {}) {
  return {
    repository: 'itsdevjimbo/pitaka-web',
    sourceSha,
    source: {
      kind: 'actions',
      workflowRunId,
      workflowName: 'Publish Build',
      workflowId,
      workflowRunAttempt,
      workflowRunSha: sourceSha,
      artifactId,
      artifactSizeBytes: 4096,
      artifactName: `pitaka-web-${sourceSha}-run-${ciRunId}-attempt-${ciRunAttempt}`,
      downloadUrl: `${API_BASE_URL}/repos/itsdevjimbo/pitaka-web/actions/artifacts/${artifactId}/zip`,
      ciRunId,
      ciRunAttempt,
      expiresAt,
    },
    manifest: { name: `pitaka-web-${sourceSha}.manifest.json`, sha256: 'd'.repeat(64) },
    archive: {
      name: `pitaka-web-${sourceSha}.tar.gz`,
      sha256: 'e'.repeat(64),
      sizeBytes: 2048,
    },
    assetIdentitySha256: 'f'.repeat(64),
  };
}

function makeReleaseWeb(sourceSha) {
  const web = makeActionsWeb({ sourceSha });
  web.source = {
    kind: 'release',
    releaseId: 700,
    tag: 'v1.2.3',
    url: `https://github.com/itsdevjimbo/pitaka-web/releases/download/v1.2.3/${web.archive.name}`,
    sourceSha,
    immutable: true,
    archiveAssetId: 701,
    manifestAssetId: 702,
    archiveAssetUrl: 'https://api.github.com/repos/itsdevjimbo/pitaka-web/releases/assets/701',
    manifestAssetUrl: 'https://api.github.com/repos/itsdevjimbo/pitaka-web/releases/assets/702',
    ciRunId: 125,
    ciRunAttempt: 2,
  };
  return web;
}

function validVersionRecord(web) {
  const imageDigest = '1'.repeat(64);
  const versions = {
    nginx: ['1.27-alpine', 'nginx'],
    mysql: ['8.4.7', 'mysql'],
    seaweedfs: ['4.47', 'chrislusf/seaweedfs'],
    smtp4dev: ['v3', 'rnwood/smtp4dev'],
    awscli: ['2.27.35', 'amazon/aws-cli'],
  };
  const images = Object.fromEntries(
    Object.entries(versions).map(([name, [version, repository]]) => [
      name,
      { version, reference: `${repository}:${version}@sha256:${imageDigest}` },
    ]),
  );
  return {
    schemaVersion: 1,
    environment: 'local',
    configuration: {
      revision: 'pitaka-local-compose-v1',
      origin: 'http://localhost:8080',
      secretReferences: ['secrets/local.env'],
      compatibilityNotes: 'Original setting',
    },
    web,
    api: {
      repository: 'jimbodev0530/pitaka-api',
      sourceSha: '9'.repeat(40),
      sourceTag: `sha-${'9'.repeat(40)}`,
      image: `jimbodev0530/pitaka-api@sha256:${'2'.repeat(64)}`,
      digest: `sha256:${'2'.repeat(64)}`,
      platform: 'linux/arm64',
    },
    images,
    operatorExtension: { preserved: true },
  };
}

function encodedVersionRecord(record) {
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  return {
    path: 'versions/local.json',
    sha,
    encoding: 'base64',
    size: bytes.length,
    content: bytes.toString('base64'),
    record,
  };
}

function makeDeployApi({ currentRecord, onPut, beforeRead }) {
  let record = currentRecord;
  const calls = { get: 0, put: 0, writes: [] };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/users/')) {
      return responseJson({ id: 123456, login: 'pitaka-deploy-bot[bot]' });
    }
    if (parsed.pathname === '/repos/itsdevjimbo/pitaka-deploy/contents/versions/local.json') {
      if (init.method === 'PUT') {
        calls.put += 1;
        const payload = JSON.parse(init.body);
        const nextRecord = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));
        calls.writes.push({ payload, record: nextRecord });
        const result = onPut
          ? await onPut({ calls, payload, nextRecord, record, setRecord: (next) => (record = next) })
          : undefined;
        if (result) {
          return result;
        }
        record = nextRecord;
        return responseJson({ content: { sha: 'new-sha' } }, 201);
      }
      calls.get += 1;
      if (beforeRead) {
        await beforeRead({ calls, record, setRecord: (next) => (record = next) });
      }
      const encoded = encodedVersionRecord(record);
      return responseJson({
        name: 'local.json',
        path: encoded.path,
        sha: encoded.sha,
        size: encoded.size,
        encoding: encoded.encoding,
        content: encoded.content,
      });
    }
    return responseJson({ message: `unexpected request ${init.method ?? 'GET'} ${url}` }, 500);
  };
  return { fetchImpl, calls, getRecord: () => record };
}

async function makePublisherFixture(t, { missingArtifact = false, expired = false, corrupt = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pitaka-web-selection-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const buildDirectory = join(root, 'build');
  const artifactDirectory = join(root, 'published');
  await mkdir(buildDirectory);
  await writeFile(join(buildDirectory, 'index.html'), '<main>Pitaka</main>');
  await writeFile(join(buildDirectory, 'main.js'), 'console.log("Pitaka");');
  await packageWebBuild({
    buildDirectory,
    artifactDirectory,
    sourceRevision: SOURCE_SHA,
    repository: 'itsdevjimbo/pitaka-web',
    runId: 125,
    runAttempt: 2,
    nodeVersion: 'v24.20.0',
    npmVersion: '11.6.2',
  });
  if (corrupt) {
    const manifestPath = join(artifactDirectory, `pitaka-web-${SOURCE_SHA}.manifest.json`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.archive.sha256 = '0'.repeat(64);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const zipPath = join(root, 'uploaded-artifact.zip');
  execFileSync(
    'zip',
    [
      '-q',
      '-j',
      zipPath,
      join(artifactDirectory, `pitaka-web-${SOURCE_SHA}.tar.gz`),
      join(artifactDirectory, `pitaka-web-${SOURCE_SHA}.manifest.json`),
    ],
    { cwd: root },
  );
  const zipContents = await readFile(zipPath);
  const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const created = new Date(Date.now() - 60 * 60 * 1000);
  const completed = new Date(Date.now() - 30 * 60 * 1000);
  const expiresAt = expired ? new Date(Date.now() - 60_000) : new Date(created.getTime() + 14 * 24 * 60 * 60 * 1000);
  const artifact = {
    id: 800,
    name: `pitaka-web-${SOURCE_SHA}-run-125-attempt-2`,
    size_in_bytes: zipContents.byteLength,
    expired,
    created_at: created.toISOString(),
    expires_at: expiresAt.toISOString(),
    archive_download_url: `${API_BASE_URL}/repos/itsdevjimbo/pitaka-web/actions/artifacts/800/zip`,
    workflow_run: {
      id: 500,
      head_sha: SOURCE_SHA,
      head_branch: 'main',
    },
  };
  const publisherRun = {
    id: 500,
    run_attempt: 1,
    name: 'Publish Build',
    workflow_id: 900,
    head_sha: SOURCE_SHA,
    head_branch: 'main',
    head_repository: { full_name: 'itsdevjimbo/pitaka-web' },
    event: 'workflow_run',
    status: 'completed',
    conclusion: 'success',
    run_started_at: start.toISOString(),
    updated_at: completed.toISOString(),
  };
  const ciRun = {
    id: 125,
    run_attempt: 2,
    name: 'CI',
    workflow_id: 901,
    head_sha: SOURCE_SHA,
    head_branch: 'main',
    head_repository: { full_name: 'itsdevjimbo/pitaka-web' },
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  };
  const artifactDownloadRequests = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/repos/itsdevjimbo/pitaka-web/actions/workflows/publish-build.yml') {
      return responseJson({
        id: 900,
        name: 'Publish Build',
        path: '.github/workflows/publish-build.yml',
        state: 'active',
      });
    }
    if (parsed.pathname === '/repos/itsdevjimbo/pitaka-web/actions/workflows/ci.yml') {
      return responseJson({ id: 901, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' });
    }
    if (parsed.pathname === '/repos/itsdevjimbo/pitaka-web/actions/runs/500/attempts/1') {
      return responseJson(publisherRun);
    }
    if (parsed.pathname === '/repos/itsdevjimbo/pitaka-web/actions/runs/125/attempts/2') {
      return responseJson(ciRun);
    }
    if (parsed.pathname === '/repos/itsdevjimbo/pitaka-web/actions/runs/500/artifacts') {
      return responseJson({ artifacts: missingArtifact ? [] : [artifact] });
    }
    if (parsed.pathname === '/repos/itsdevjimbo/pitaka-web/actions/artifacts/800') {
      return responseJson(artifact);
    }
    if (parsed.pathname === '/repos/itsdevjimbo/pitaka-web/actions/artifacts/800/zip') {
      artifactDownloadRequests.push({ headers: options?.headers });
      return new Response(zipContents);
    }
    return responseJson({ message: `unexpected request ${url}` }, 500);
  };
  return { root, artifact, publisherRun, ciRun, zipContents, artifactDownloadRequests, fetchImpl };
}

test('verifies the exact publisher, CI attempt, artifact identity and web bytes', async (t) => {
  const fixture = await makePublisherFixture(t);
  const prepared = await prepareActionsSelection({
    workflowRunId: 500,
    workflowRunAttempt: 1,
    token: 'read-token',
    fetchImpl: fixture.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:refs/remotes/origin/main`])),
    now: () => NOW,
  });
  t.after(() => rm(prepared.workspace, { recursive: true, force: true }));

  assert.equal(prepared.web.sourceSha, SOURCE_SHA);
  assert.equal(prepared.web.source.workflowRunId, 500);
  assert.equal(prepared.web.source.workflowRunAttempt, 1);
  assert.equal(prepared.web.source.workflowId, 900);
  assert.equal(prepared.web.source.artifactId, 800);
  assert.equal(prepared.web.source.ciRunId, 125);
  assert.equal(prepared.web.source.ciRunAttempt, 2);
  assert.match(prepared.web.manifest.sha256, /^[a-f0-9]{64}$/);
  assert.ok(prepared.web.archive.sizeBytes > 0);
  assert.equal(new Headers(fixture.artifactDownloadRequests[0].headers).get('accept'), 'application/vnd.github+json');
  const candidate = JSON.parse(await readFile(prepared.candidatePath, 'utf8'));
  assert.equal(candidate.web.source.artifactName, fixture.artifact.name);
});

test('derives a manual Actions reconciliation candidate from only the publisher run identity', async (t) => {
  const fixture = await makePublisherFixture(t);
  const prepared = await prepareReconciliationSelection({
    sourceType: 'actions',
    publisherRunId: '500',
    publisherRunAttempt: '1',
    releaseTag: '',
    token: 'read-token',
    fetchImpl: fixture.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:refs/remotes/origin/main`])),
    now: () => NOW,
  });
  t.after(() => rm(prepared.workspace, { recursive: true, force: true }));

  const candidate = JSON.parse(await readFile(prepared.candidatePath, 'utf8'));
  assert.equal(candidate.eventType, 'manual-actions-reconciliation');
  assert.equal(candidate.sourceSha, SOURCE_SHA);
  assert.equal(candidate.publisherRun.id, 500);
  assert.equal(candidate.publisherRun.attempt, 1);
  assert.equal(candidate.web.source.artifactId, 800);
});

test('derives a manual Release reconciliation candidate from only the immutable tag', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pitaka-web-release-reconciliation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prepared = await prepareReconciliationSelection({
    sourceType: 'release',
    publisherRunId: '',
    publisherRunAttempt: '',
    releaseTag: 'v1.2.3',
    token: 'read-token',
    runnerTemp: root,
    verifyReleaseImpl: async (options) => {
      assert.equal(options.releaseTag, 'v1.2.3');
      assert.equal(options.expectedSourceSha, undefined);
      return {
        web: makeReleaseWeb(SOURCE_SHA),
        release: { id: 700, tag: 'v1.2.3' },
        ciRun: { id: 125, attempt: 2 },
      };
    },
  });

  const candidate = JSON.parse(await readFile(prepared.candidatePath, 'utf8'));
  assert.equal(candidate.eventType, 'manual-release-reconciliation');
  assert.equal(candidate.sourceSha, SOURCE_SHA);
  assert.equal(candidate.release.tag, 'v1.2.3');
  assert.equal(candidate.promotionRun, undefined);
  assert.equal(candidate.web.source.kind, 'release');
});

test('rejects mixed or incomplete manual reconciliation inputs before source verification', async () => {
  await assert.rejects(
    prepareReconciliationSelection({
      sourceType: 'actions',
      publisherRunId: '500',
      publisherRunAttempt: '1',
      releaseTag: 'v1.2.3',
      token: 'read-token',
    }),
    /does not accept a Release tag/,
  );
  await assert.rejects(
    prepareReconciliationSelection({
      sourceType: 'release',
      publisherRunId: '500',
      publisherRunAttempt: '',
      releaseTag: 'v1.2.3',
      token: 'read-token',
    }),
    /does not accept a publisher run ID or attempt/,
  );
  await assert.rejects(
    prepareReconciliationSelection({
      sourceType: 'release',
      publisherRunId: '',
      publisherRunAttempt: '',
      releaseTag: '',
      token: 'read-token',
      verifyReleaseImpl: async () => {
        throw new Error('source verification should not run without a tag');
      },
    }),
    /requires an immutable Release tag/,
  );
});

test('reports manual source provenance when candidate bytes change before apply', async (t) => {
  const fixture = await makePublisherFixture(t);
  const prepared = await prepareReconciliationSelection({
    sourceType: 'actions',
    publisherRunId: '500',
    publisherRunAttempt: '1',
    releaseTag: '',
    token: 'read-token',
    fetchImpl: fixture.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:refs/remotes/origin/main`])),
    now: () => NOW,
  });
  const summaryPath = join(fixture.root, 'summary.md');
  await writeFile(join(prepared.artifactDirectory, prepared.web.archive.name), 'tampered');

  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [join(import.meta.dirname, 'local-web-selection.mjs'), 'apply', prepared.candidatePath],
        {
          env: {
            ...process.env,
            DEPLOY_APP_SLUG: 'pitaka-deploy-bot',
            DEPLOY_APP_TOKEN: 'deploy-token',
            GITHUB_STEP_SUMMARY: summaryPath,
          },
          encoding: 'utf8',
        },
      ),
    /checked publisher artifact bytes changed/,
  );
  const summary = await readFile(summaryPath, 'utf8');
  assert.match(summary, /Event type: manual Actions reconciliation/);
  assert.match(summary, /Source SHA: `aaaaaaaa/);
  assert.match(summary, /Publisher run: 500, attempt 1/);
  assert.match(summary, /Outcome: failed/);
});

test('rejects a publication with no uploaded candidate', async (t) => {
  const fixture = await makePublisherFixture(t, { missingArtifact: true });
  await assert.rejects(
    prepareActionsSelection({
      workflowRunId: 500,
      workflowRunAttempt: 1,
      token: 'read-token',
      fetchImpl: fixture.fetchImpl,
      execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:refs/remotes/origin/main`])),
      now: () => NOW,
    }),
    /no matching uploaded Actions artifact/,
  );
});

test('rejects a publisher SHA that was removed from the current main history', async (t) => {
  const fixture = await makePublisherFixture(t);
  await assert.rejects(
    prepareActionsSelection({
      workflowRunId: 500,
      workflowRunAttempt: 1,
      token: 'read-token',
      fetchImpl: fixture.fetchImpl,
      execFileSyncImpl: gitExec(),
      now: () => NOW,
    }),
    /no longer reachable from pitaka-web\/main/,
  );
});

test('rejects an expired Actions artifact before selecting it', async (t) => {
  const fixture = await makePublisherFixture(t, { expired: true });
  await assert.rejects(
    prepareActionsSelection({
      workflowRunId: 500,
      workflowRunAttempt: 1,
      token: 'read-token',
      fetchImpl: fixture.fetchImpl,
      execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:refs/remotes/origin/main`])),
      now: () => NOW,
    }),
    /artifact has expired/,
  );
});

test('rejects a corrupt published archive or manifest', async (t) => {
  const fixture = await makePublisherFixture(t, { corrupt: true });
  await assert.rejects(
    prepareActionsSelection({
      workflowRunId: 500,
      workflowRunAttempt: 1,
      token: 'read-token',
      fetchImpl: fixture.fetchImpl,
      execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:refs/remotes/origin/main`])),
      now: () => NOW,
    }),
    /archive checksum or size does not match/,
  );
});

test('writes only web and preserves a concurrent non-web edit after a conflict', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: CURRENT_SHA }));
  const concurrentRecord = structuredClone(current);
  concurrentRecord.configuration.compatibilityNotes = 'Edited while selection was running';
  let conflicted = false;
  const deploy = makeDeployApi({
    currentRecord: current,
    onPut: async ({ setRecord }) => {
      if (!conflicted) {
        conflicted = true;
        setRecord(concurrentRecord);
        return responseJson({ message: 'sha does not match' }, 409);
      }
      return undefined;
    },
  });
  const candidate = makeActionsWeb({ sourceSha: SOURCE_SHA, workflowRunId: 600 });
  const result = await applyLocalWebSelection({
    candidate,
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: deploy.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${CURRENT_SHA}:${SOURCE_SHA}`])),
    now: () => NOW,
    sleepImpl: async () => {},
  });

  assert.equal(result.outcome, 'applied');
  assert.equal(result.writeAttempts, 2);
  assert.equal(deploy.calls.put, 2);
  assert.equal(deploy.getRecord().configuration.compatibilityNotes, 'Edited while selection was running');
  assert.equal(deploy.getRecord().operatorExtension.preserved, true);
  assert.deepEqual(deploy.getRecord().web, candidate);
  assert.equal(deploy.calls.writes[1].payload.branch, 'main');
  assert.equal(deploy.calls.writes[1].payload.author.name, 'pitaka-deploy-bot[bot]');
  assert.equal(
    deploy.calls.writes[1].payload.committer.email,
    '123456+pitaka-deploy-bot[bot]@users.noreply.github.com',
  );
  validateRecordWebSelection(deploy.getRecord());
});

test('does not create a commit when the exact checked selection is already current', () => {
  const web = makeActionsWeb();
  assert.equal(compareWebSelections(web, web), 'already-current');
});

test('reads back an already-current selection without creating a commit', async () => {
  const current = validVersionRecord(makeActionsWeb());
  const deploy = makeDeployApi({ currentRecord: current });
  const result = await applyLocalWebSelection({
    candidate: current.web,
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: deploy.fetchImpl,
    now: () => NOW,
    sleepImpl: async () => {},
  });
  assert.equal(result.outcome, 'already current');
  assert.equal(deploy.calls.put, 0);
});

test('orders same-SHA publications by publisher run and attempt', () => {
  const older = makeActionsWeb({ workflowRunId: 500, workflowRunAttempt: 2 });
  const newer = makeActionsWeb({ workflowRunId: 500, workflowRunAttempt: 3, artifactId: 801 });
  assert.equal(compareWebSelections(newer, older), 'advance');
  assert.equal(compareWebSelections(older, newer), 'superseded');
});

test('keeps a same-SHA immutable Release selected over an Actions retry', () => {
  assert.equal(compareWebSelections(makeActionsWeb(), makeReleaseWeb(SOURCE_SHA)), 'superseded');
  assert.equal(
    compareWebSelections(makeReleaseWeb(SOURCE_SHA), makeActionsWeb({ sourceSha: CURRENT_SHA }), {
      execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:${CURRENT_SHA}`])),
    }),
    'superseded',
  );
});

test('upgrades matching selected Actions bytes to the verified immutable Release', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: SOURCE_SHA }));
  const deploy = makeDeployApi({ currentRecord: current });
  const release = makeReleaseWeb(SOURCE_SHA);
  const result = await applyLocalWebSelection({
    candidate: release,
    promotionRun: { id: 900, attempt: 2, workflowId: 901 },
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: deploy.fetchImpl,
    now: () => NOW,
    sleepImpl: async () => {},
  });

  assert.equal(result.outcome, 'applied');
  assert.equal(result.writeAttempts, 1);
  assert.equal(deploy.calls.put, 1);
  assert.equal(deploy.getRecord().web.source.kind, 'release');
  assert.equal(deploy.getRecord().web.archive.sha256, current.web.archive.sha256);
  assert.equal(deploy.getRecord().web.assetIdentitySha256, current.web.assetIdentitySha256);
  assert.deepEqual(deploy.getRecord().api, current.api);
  assert.deepEqual(deploy.getRecord().images, current.images);
  assert.deepEqual(result.promotionRun, { id: 900, attempt: 2, workflowId: 901 });
});

test('fails the Release handoff when a same-SHA selected Actions build has different bytes', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: SOURCE_SHA }));
  const deploy = makeDeployApi({ currentRecord: current });
  const release = makeReleaseWeb(SOURCE_SHA);
  release.archive.sha256 = '0'.repeat(64);

  await assert.rejects(
    applyLocalWebSelection({
      candidate: release,
      token: 'deploy-token',
      appSlug: 'pitaka-deploy-bot',
      fetchImpl: deploy.fetchImpl,
      now: () => NOW,
      sleepImpl: async () => {},
    }),
    /does not match the selected Actions build bytes/,
  );
  assert.equal(deploy.calls.put, 0);
  assert.deepEqual(deploy.getRecord().web, current.web);
});

test('keeps an existing Release when promotion repeats or names another source SHA', async () => {
  const currentWeb = makeReleaseWeb(CURRENT_SHA);
  const current = validVersionRecord(currentWeb);
  const sameRelease = makeDeployApi({ currentRecord: current });
  const repeated = await applyLocalWebSelection({
    candidate: makeReleaseWeb(CURRENT_SHA),
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: sameRelease.fetchImpl,
    now: () => NOW,
    sleepImpl: async () => {},
  });
  assert.equal(repeated.outcome, 'already current');
  assert.equal(sameRelease.calls.put, 0);

  const anotherPromotion = makeDeployApi({ currentRecord: current });
  const ignored = await applyLocalWebSelection({
    candidate: makeReleaseWeb(SOURCE_SHA),
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: anotherPromotion.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:${CURRENT_SHA}`])),
    now: () => NOW,
    sleepImpl: async () => {},
  });
  assert.equal(ignored.outcome, 'validly superseded');
  assert.equal(anotherPromotion.calls.put, 0);
  assert.equal(anotherPromotion.getRecord().web.sourceSha, CURRENT_SHA);
});

test('does not replace a concurrently selected newer Actions candidate with an older Release', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: SOURCE_SHA }));
  let advanced = false;
  const deploy = makeDeployApi({
    currentRecord: current,
    beforeRead: async ({ setRecord }) => {
      if (!advanced) {
        advanced = true;
        setRecord(validVersionRecord(makeActionsWeb({ sourceSha: LATER_SHA, workflowRunId: 700 })));
      }
    },
  });
  const result = await applyLocalWebSelection({
    candidate: makeReleaseWeb(SOURCE_SHA),
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: deploy.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:${LATER_SHA}`])),
    now: () => NOW,
    sleepImpl: async () => {},
  });

  assert.equal(result.outcome, 'validly superseded');
  assert.equal(deploy.calls.put, 0);
  assert.equal(deploy.getRecord().web.sourceSha, LATER_SHA);
});

test('a rerun stops when the selected SHA was removed from main', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: LATER_SHA, workflowRunId: 700 }));
  const deploy = makeDeployApi({ currentRecord: current });

  await assert.rejects(
    applyLocalWebSelection({
      candidate: makeActionsWeb({ sourceSha: SOURCE_SHA }),
      token: 'deploy-token',
      appSlug: 'pitaka-deploy-bot',
      fetchImpl: deploy.fetchImpl,
      execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:refs/remotes/origin/main`, `${SOURCE_SHA}:${LATER_SHA}`])),
      now: () => NOW,
      eventType: 'successful Publish Build completion',
      verifySelectedSourceReachability: true,
      sleepImpl: async () => {},
    }),
    /Selected SHA .* is no longer reachable from pitaka-web\/main/,
  );
  assert.equal(deploy.calls.put, 0);
});

test('manual reconciliation accepts already-current and validly superseded selections without a commit', async () => {
  const currentRelease = validVersionRecord(makeReleaseWeb(SOURCE_SHA));
  const alreadyCurrentDeploy = makeDeployApi({ currentRecord: currentRelease });
  const alreadyCurrent = await applyLocalWebSelection({
    candidate: makeReleaseWeb(SOURCE_SHA),
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: alreadyCurrentDeploy.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${SOURCE_SHA}:refs/remotes/origin/main`])),
    eventType: 'manual immutable Release reconciliation',
    verifySelectedSourceReachability: true,
    now: () => NOW,
    sleepImpl: async () => {},
  });
  assert.equal(alreadyCurrent.outcome, 'already current');
  assert.equal(alreadyCurrentDeploy.calls.put, 0);

  const newer = validVersionRecord(makeActionsWeb({ sourceSha: LATER_SHA, workflowRunId: 700 }));
  const supersededDeploy = makeDeployApi({ currentRecord: newer });
  const superseded = await applyLocalWebSelection({
    candidate: makeActionsWeb({ sourceSha: SOURCE_SHA }),
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: supersededDeploy.fetchImpl,
    execFileSyncImpl: gitExec(
      new Set([
        `${SOURCE_SHA}:refs/remotes/origin/main`,
        `${LATER_SHA}:refs/remotes/origin/main`,
        `${SOURCE_SHA}:${LATER_SHA}`,
      ]),
    ),
    eventType: 'manual Actions reconciliation',
    verifySelectedSourceReachability: true,
    now: () => NOW,
    sleepImpl: async () => {},
  });
  assert.equal(superseded.outcome, 'validly superseded');
  assert.equal(supersededDeploy.calls.put, 0);
});

test('manual Release reconciliation advances an older selected SHA with verified durable bytes', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: CURRENT_SHA }));
  const deploy = makeDeployApi({ currentRecord: current });
  const result = await applyLocalWebSelection({
    candidate: makeReleaseWeb(SOURCE_SHA),
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: deploy.fetchImpl,
    execFileSyncImpl: gitExec(
      new Set([
        `${CURRENT_SHA}:${SOURCE_SHA}`,
        `${CURRENT_SHA}:refs/remotes/origin/main`,
        `${SOURCE_SHA}:refs/remotes/origin/main`,
      ]),
    ),
    eventType: 'manual immutable Release reconciliation',
    verifySelectedSourceReachability: true,
    allowReleaseSourceAdvance: true,
    now: () => NOW,
    sleepImpl: async () => {},
  });

  assert.equal(result.outcome, 'applied');
  assert.equal(deploy.calls.put, 1);
  assert.equal(deploy.getRecord().web.sourceSha, SOURCE_SHA);
  assert.equal(deploy.getRecord().web.source.kind, 'release');
});

test('fails a promoted Release handoff when its SHA is unrelated to the selected SHA', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: CURRENT_SHA }));
  const deploy = makeDeployApi({ currentRecord: current });

  await assert.rejects(
    applyLocalWebSelection({
      candidate: makeReleaseWeb(SOURCE_SHA),
      token: 'deploy-token',
      appSlug: 'pitaka-deploy-bot',
      fetchImpl: deploy.fetchImpl,
      execFileSyncImpl: gitExec(),
      now: () => NOW,
      sleepImpl: async () => {},
    }),
    /unrelated/,
  );
  assert.equal(deploy.calls.put, 0);
  assert.equal(deploy.getRecord().web.sourceSha, CURRENT_SHA);
});

test('writes a verified Release candidate with its promotion provenance to temporary storage', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pitaka-web-release-candidate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prepared = await prepareReleaseSelection({
    promotionRunId: 900,
    promotionRunAttempt: 2,
    expectedSourceSha: SOURCE_SHA,
    releaseTag: 'v1.2.3',
    token: 'read-token',
    runnerTemp: root,
    verifyReleaseImpl: async () => ({
      web: makeReleaseWeb(SOURCE_SHA),
      promotionRun: { id: 900, attempt: 2, workflowId: 901 },
      release: { id: 700, tag: 'v1.2.3' },
      ciRun: { id: 125, attempt: 2 },
    }),
  });
  const candidate = JSON.parse(await readFile(prepared.candidatePath, 'utf8'));

  assert.equal(candidate.eventType, 'verified-immutable-release-promotion');
  assert.equal(candidate.promotionRun.id, 900);
  assert.equal(candidate.release.tag, 'v1.2.3');
  assert.equal(candidate.web.source.kind, 'release');
});

test('orders different source SHAs by ancestry and fails for divergence', () => {
  const candidate = makeActionsWeb({ sourceSha: LATER_SHA });
  const current = makeActionsWeb({ sourceSha: CURRENT_SHA });
  assert.equal(
    compareWebSelections(candidate, current, {
      execFileSyncImpl: gitExec(new Set([`${CURRENT_SHA}:${LATER_SHA}`])),
    }),
    'advance',
  );
  assert.equal(
    compareWebSelections(current, candidate, {
      execFileSyncImpl: gitExec(new Set([`${CURRENT_SHA}:${LATER_SHA}`])),
    }),
    'superseded',
  );
  assert.throws(() => compareWebSelections(candidate, current, { execFileSyncImpl: gitExec() }), /unrelated/);
});

test('reports an uncertain accepted write as applied after verified read-back', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: CURRENT_SHA }));
  let lostResponse = false;
  const deploy = makeDeployApi({
    currentRecord: current,
    onPut: async ({ nextRecord, setRecord }) => {
      if (!lostResponse) {
        lostResponse = true;
        setRecord(nextRecord);
        throw new TypeError('network timeout after write');
      }
      return undefined;
    },
  });
  const result = await applyLocalWebSelection({
    candidate: makeActionsWeb({ sourceSha: SOURCE_SHA }),
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: deploy.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${CURRENT_SHA}:${SOURCE_SHA}`])),
    now: () => NOW,
    sleepImpl: async () => {},
  });
  assert.equal(result.outcome, 'applied');
  assert.equal(result.writeAttempts, 1);
  assert.equal(deploy.calls.put, 1);
});

test('reports a newer descendant selection that wins before read-back as validly superseded', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: CURRENT_SHA }));
  const newer = validVersionRecord(makeActionsWeb({ sourceSha: LATER_SHA, workflowRunId: 700 }));
  const deploy = makeDeployApi({
    currentRecord: current,
    onPut: async ({ setRecord }) => {
      setRecord(newer);
      return responseJson({ content: { sha: 'newer-sha' } }, 201);
    },
  });
  const result = await applyLocalWebSelection({
    candidate: makeActionsWeb({ sourceSha: SOURCE_SHA }),
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: deploy.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${CURRENT_SHA}:${SOURCE_SHA}`, `${SOURCE_SHA}:${LATER_SHA}`])),
    now: () => NOW,
    sleepImpl: async () => {},
  });
  assert.equal(result.outcome, 'validly superseded');
  assert.equal(result.writeAttempts, 1);
  assert.equal(result.after.sourceSha, LATER_SHA);
});

test('stops after three concurrent-write conflicts', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: CURRENT_SHA }));
  const deploy = makeDeployApi({
    currentRecord: current,
    onPut: async () => responseJson({ message: 'conflict' }, 409),
  });
  await assert.rejects(
    applyLocalWebSelection({
      candidate: makeActionsWeb({ sourceSha: SOURCE_SHA }),
      token: 'deploy-token',
      appSlug: 'pitaka-deploy-bot',
      fetchImpl: deploy.fetchImpl,
      execFileSyncImpl: gitExec(new Set([`${CURRENT_SHA}:${SOURCE_SHA}`])),
      now: () => NOW,
      sleepImpl: async () => {},
    }),
    /HTTP 409/,
  );
  assert.equal(deploy.calls.put, 3);
});

test('does not retry a deploy App authorization rejection', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: CURRENT_SHA }));
  const deploy = makeDeployApi({
    currentRecord: current,
    onPut: async () => responseJson({ message: 'Resource not accessible by integration' }, 403),
  });
  await assert.rejects(
    applyLocalWebSelection({
      candidate: makeActionsWeb({ sourceSha: SOURCE_SHA }),
      token: 'deploy-token',
      appSlug: 'pitaka-deploy-bot',
      fetchImpl: deploy.fetchImpl,
      execFileSyncImpl: gitExec(new Set([`${CURRENT_SHA}:${SOURCE_SHA}`])),
      now: () => NOW,
      sleepImpl: async () => {},
    }),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.equal(error.selectionReport.before.sourceSha, CURRENT_SHA);
      assert.equal(error.selectionReport.after.sourceSha, CURRENT_SHA);
      return true;
    },
  );
  assert.equal(deploy.calls.put, 1);
});

test('selects web while preserving unrelated deploy fields without validating them', async () => {
  const current = validVersionRecord(makeActionsWeb({ sourceSha: CURRENT_SHA }));
  current.api.image = 'managed by the API publisher';
  current.images.mysql.reference = 'managed by the stack owner';
  current.configuration.origin = 'managed by the stack owner';
  const deploy = makeDeployApi({ currentRecord: current });
  const result = await applyLocalWebSelection({
    candidate: makeActionsWeb({ sourceSha: SOURCE_SHA }),
    token: 'deploy-token',
    appSlug: 'pitaka-deploy-bot',
    fetchImpl: deploy.fetchImpl,
    execFileSyncImpl: gitExec(new Set([`${CURRENT_SHA}:${SOURCE_SHA}`])),
    now: () => NOW,
    sleepImpl: async () => {},
  });
  assert.equal(result.outcome, 'applied');
  assert.equal(deploy.calls.put, 1);
  assert.deepEqual(deploy.getRecord().api, current.api);
  assert.deepEqual(deploy.getRecord().images, current.images);
  assert.deepEqual(deploy.getRecord().configuration, current.configuration);
  assert.equal(deploy.getRecord().web.sourceSha, SOURCE_SHA);
});

test('writes a failure summary with source, attempts and recovery details', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pitaka-web-selection-summary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const summaryPath = join(root, 'summary.md');
  await writeSelectionSummary(summaryPath, {
    sourceSha: SOURCE_SHA,
    publisherRun: { id: 500, attempt: 2 },
    ciRun: { id: 125, attempt: 1 },
    before: makeActionsWeb({ sourceSha: CURRENT_SHA }),
    after: undefined,
    writeAttempts: 3,
    outcome: 'failed',
    recovery: 'Inspect pitaka-deploy/main and rerun before artifact expiry.',
  });
  const summary = await readFile(summaryPath, 'utf8');
  assert.match(summary, /Source SHA: `aaaaaaaa/);
  assert.match(summary, /Publisher run: 500, attempt 2/);
  assert.match(summary, /Write attempts: 3/);
  assert.match(summary, /Outcome: failed/);
  assert.match(summary, /Inspect pitaka-deploy\/main/);
});

test('gives concrete recovery for deploy authorization, malformed records, and exhausted retries', () => {
  assert.match(
    applyFailureRecovery(Object.assign(new Error('Writing failed with HTTP 403.'), { status: 403 }), {
      sourceKind: 'actions',
    }),
    /App installation.*Contents write.*branch rules/,
  );
  assert.match(
    applyFailureRecovery(new Error('Deploy repository version record is not valid JSON.'), {
      sourceKind: 'release',
    }),
    /Repair pitaka-deploy\/main versions\/local\.json/,
  );
  assert.match(
    applyFailureRecovery(
      Object.assign(new Error('Writing failed with HTTP 409.'), {
        retryable: true,
        selectionReport: { writeAttempts: 3 },
      }),
      { sourceKind: 'actions' },
    ),
    /concurrent edits or GitHub API availability.*three attempts/,
  );
});

test('includes the promotion run and immutable Release in the handoff summary', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pitaka-web-release-summary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const summaryPath = join(root, 'summary.md');
  await writeSelectionSummary(summaryPath, {
    eventType: 'verified immutable Release promotion',
    sourceSha: SOURCE_SHA,
    promotionRun: { id: 900, attempt: 2 },
    release: { id: 700, tag: 'v1.2.3' },
    ciRun: { id: 125, attempt: 2 },
    before: makeActionsWeb({ sourceSha: SOURCE_SHA }),
    after: makeReleaseWeb(SOURCE_SHA),
    writeAttempts: 1,
    outcome: 'applied',
    recovery: 'No recovery is needed.',
  });
  const summary = await readFile(summaryPath, 'utf8');

  assert.match(summary, /Promotion run: 900, attempt 2/);
  assert.match(summary, /Immutable Release: v1\.2\.3 \(ID 700\)/);
  assert.match(summary, /Outcome: applied/);
  assert.match(summary, /does not run smoke, apply, or report deployment success/);
});
