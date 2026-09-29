import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { githubApiHeaders, githubApiUrl, nextGitHubApiPage } from './github-api.mjs';
import { verifyPromotedWebRelease } from './verify-promoted-web-release.mjs';
import { isMainModule, sha256, verifyWebBuildArtifact, webBuildArtifactNames } from './web-build-artifact.mjs';

export const WEB_REPOSITORY = 'itsdevjimbo/pitaka-web';
export const DEPLOY_REPOSITORY = 'itsdevjimbo/pitaka-deploy';
export const DEPLOY_VERSION_PATH = 'versions/local.json';
export const DEFAULT_API_BASE_URL = 'https://api.github.com';

const FULL_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 1_048_576;

export class LocalWebSelectionError extends Error {}

function fail(message) {
  throw new LocalWebSelectionError(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeAssetName(value) {
  return (
    typeof value === 'string' &&
    !['', '.', '..'].includes(value) &&
    basename(value) === value &&
    !value.includes('/') &&
    !value.includes('\\')
  );
}

function requirePositiveInteger(value, description) {
  if (!positiveInteger(value)) {
    fail(`${description} must be a positive integer.`);
  }
}

function validateReleaseSource(source, sourceSha) {
  requirePositiveInteger(source.releaseId, 'Release web source releaseId');
  if (
    !source.tag ||
    typeof source.url !== 'string' ||
    !source.url.startsWith(`https://github.com/${WEB_REPOSITORY}/releases/download/`)
  ) {
    fail('Release web source must record its immutable release URL and tag.');
  }
  if (source.sourceSha !== sourceSha || source.immutable !== true) {
    fail('Release web source must identify the selected SHA and be immutable.');
  }
  for (const field of ['archiveAssetId', 'manifestAssetId']) {
    requirePositiveInteger(source[field], `Release web source ${field}`);
  }
  for (const field of ['archiveAssetUrl', 'manifestAssetUrl']) {
    if (
      typeof source[field] !== 'string' ||
      !source[field].startsWith(`https://api.github.com/repos/${WEB_REPOSITORY}/releases/assets/`)
    ) {
      fail(`Release web source must record its exact ${field}.`);
    }
  }
}

function validateActionsSource(source, sourceSha) {
  for (const field of [
    'workflowRunId',
    'workflowId',
    'workflowRunAttempt',
    'artifactId',
    'artifactSizeBytes',
    'ciRunId',
    'ciRunAttempt',
  ]) {
    requirePositiveInteger(source[field], `Actions web source ${field}`);
  }
  if (source.workflowName !== 'Publish Build') {
    fail('Actions web source must identify the Publish Build workflow.');
  }
  if (source.workflowRunSha !== sourceSha) {
    fail('Actions publisher run must match the selected web source SHA.');
  }
  const expectedName = `pitaka-web-${sourceSha}-run-${source.ciRunId}-attempt-${source.ciRunAttempt}`;
  if (source.artifactName !== expectedName) {
    fail('Actions artifact name does not match its source SHA, run, and attempt.');
  }
  const expectedUrl = `${DEFAULT_API_BASE_URL}/repos/${WEB_REPOSITORY}/actions/artifacts/${source.artifactId}/zip`;
  if (source.downloadUrl !== expectedUrl) {
    fail('Actions artifact URL must identify the recorded artifact ID.');
  }
  if (typeof source.expiresAt !== 'string' || !source.expiresAt.endsWith('Z')) {
    fail('Actions artifact source must record its expiry time in UTC.');
  }
  if (!Number.isFinite(Date.parse(source.expiresAt))) {
    fail('Actions artifact source must record a valid UTC expiry time.');
  }
}

export function validateWebSelection(web) {
  if (!isObject(web) || web.repository !== WEB_REPOSITORY || !FULL_SHA.test(web.sourceSha ?? '')) {
    fail('Web selection must record its repository and full source SHA.');
  }
  if (!isObject(web.source)) {
    fail('Web selection is missing its artifact source identity.');
  }

  if (web.source.kind === 'actions') {
    validateActionsSource(web.source, web.sourceSha);
  } else if (web.source.kind === 'release') {
    validateReleaseSource(web.source, web.sourceSha);
  } else {
    fail("Web source kind must be 'actions' or 'release'.");
  }

  if (!isObject(web.manifest) || !isSafeAssetName(web.manifest.name)) {
    fail('Web manifest must record a safe asset name.');
  }
  if (!SHA256.test(web.manifest.sha256 ?? '')) {
    fail('Web manifest must record its SHA-256.');
  }
  if (!isObject(web.archive) || !isSafeAssetName(web.archive.name)) {
    fail('Web archive must record a safe asset name.');
  }
  if (!web.archive.name.endsWith('.tar.gz') || !SHA256.test(web.archive.sha256 ?? '')) {
    fail('Web archive must record a gzip-compressed tar archive and its SHA-256.');
  }
  requirePositiveInteger(web.archive.sizeBytes, 'Web archive size');
  if (
    web.archive.name !== `pitaka-web-${web.sourceSha}.tar.gz` ||
    web.manifest.name !== `pitaka-web-${web.sourceSha}.manifest.json`
  ) {
    fail('Web archive and manifest names must match their full source SHA.');
  }
  if (!SHA256.test(web.assetIdentitySha256 ?? '')) {
    fail('Web selection must record the static asset identity SHA-256.');
  }
}

export function validateRecordWebSelection(record) {
  if (!isObject(record)) {
    fail('Deploy version record must be a JSON object.');
  }
  validateWebSelection(record.web);
}

function apiUrl(apiBaseUrl, repository, path, query = '') {
  return githubApiUrl(apiBaseUrl, repository, path, query);
}

function describeHttpError(label, response) {
  const error = new LocalWebSelectionError(`${label} failed with HTTP ${response.status}.`);
  error.status = response.status;
  error.headers = response.headers;
  error.retryable = isRetryableStatus(response.status, response.headers, '');
  return error;
}

async function readJsonResponse(response, label) {
  if (!response.ok) {
    throw describeHttpError(label, response);
  }
  try {
    return await response.json();
  } catch {
    fail(`${label} returned invalid JSON.`);
  }
}

async function getJson({ apiBaseUrl, repository, path, token, fetchImpl }) {
  const response = await fetchImpl(apiUrl(apiBaseUrl, repository, path), {
    headers: githubApiHeaders(token),
  });
  return readJsonResponse(response, `GitHub API request for ${path}`);
}

async function getJsonPages({ apiBaseUrl, repository, path, token, fetchImpl }) {
  const results = [];
  const baseOrigin = new URL(apiBaseUrl).origin;
  let pageUrl = apiUrl(apiBaseUrl, repository, path);
  while (pageUrl) {
    if (new URL(pageUrl).origin !== baseOrigin) {
      fail('GitHub API returned a pagination link outside the configured API host.');
    }
    const response = await fetchImpl(pageUrl, { headers: githubApiHeaders(token) });
    const body = await readJsonResponse(response, `GitHub API request for ${path}`);
    if (Array.isArray(body.artifacts)) {
      results.push(...body.artifacts);
    } else {
      fail('GitHub API returned an invalid Actions artifact listing.');
    }
    pageUrl = nextGitHubApiPage(response.headers.get('link'));
  }
  return results;
}

function requireWorkflow(workflow, { name, path }) {
  if (
    !isObject(workflow) ||
    !positiveInteger(workflow.id) ||
    workflow.name !== name ||
    workflow.path !== path ||
    workflow.state !== 'active'
  ) {
    fail(`The ${name} workflow identity is missing or inactive.`);
  }
  return workflow;
}

function requireSuccessfulRun(run, { id, attempt, workflow, repository, event, sourceSha }) {
  if (
    !isObject(run) ||
    run.id !== id ||
    run.run_attempt !== attempt ||
    run.name !== workflow.name ||
    run.workflow_id !== workflow.id ||
    (sourceSha !== undefined && run.head_sha !== sourceSha) ||
    run.head_branch !== 'main' ||
    run.event !== event ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.head_repository?.full_name !== repository
  ) {
    fail(`The exact successful ${workflow.name} run does not match the required main SHA and attempt.`);
  }
  return run;
}

function validatePublisherArtifact(artifact, publisherRun, sourceSha, now) {
  const identity = artifact.name?.match(new RegExp(`^pitaka-web-${sourceSha}-run-(\\d+)-attempt-(\\d+)$`));
  if (!identity) {
    fail('The completed Publish Build run has no artifact with the expected SHA and CI identity.');
  }
  if (artifact.expired === true || Date.parse(artifact.expires_at) <= now.getTime()) {
    fail('The uploaded Actions artifact has expired.');
  }
  if (
    !positiveInteger(Number(artifact.id)) ||
    !positiveInteger(Number(artifact.size_in_bytes)) ||
    artifact.expired !== false ||
    artifact.workflow_run?.id !== publisherRun.id ||
    artifact.workflow_run?.head_sha !== sourceSha ||
    artifact.workflow_run?.head_branch !== 'main' ||
    artifact.archive_download_url !==
      `${DEFAULT_API_BASE_URL}/repos/${WEB_REPOSITORY}/actions/artifacts/${artifact.id}/zip`
  ) {
    fail('The uploaded Actions artifact metadata does not match its completed publisher run.');
  }
  const created = Date.parse(artifact.created_at);
  const expires = Date.parse(artifact.expires_at);
  const runStarted = Date.parse(publisherRun.run_started_at);
  const runCompleted = Date.parse(publisherRun.updated_at);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    !Number.isFinite(runStarted) ||
    !Number.isFinite(runCompleted) ||
    created < runStarted ||
    created > runCompleted ||
    expires <= now.getTime() ||
    expires <= created ||
    expires > created + 14 * 24 * 60 * 60 * 1000 + 60_000
  ) {
    fail('The uploaded Actions artifact is expired or has inconsistent creation and expiry metadata.');
  }
  return {
    artifact,
    ciRunId: Number(identity[1]),
    ciRunAttempt: Number(identity[2]),
  };
}

function assertMainAncestry(sourceSha, execFileSyncImpl) {
  execFileSyncImpl('git', ['fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main'], {
    stdio: 'ignore',
  });
  try {
    execFileSyncImpl('git', ['merge-base', '--is-ancestor', sourceSha, 'refs/remotes/origin/main'], {
      stdio: 'ignore',
    });
  } catch (error) {
    if (error.status === 1) {
      fail(`Source SHA ${sourceSha} is no longer reachable from pitaka-web/main; review it manually.`);
    }
    throw error;
  }
}

function verifyZipContents(zipPath, expectedNames, execFileSyncImpl) {
  const output = execFileSyncImpl('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  const names = String(output).split(/\r?\n/).filter(Boolean);
  const sortedNames = [...names].sort();
  const sortedExpected = [...expectedNames].sort();
  if (JSON.stringify(sortedNames) !== JSON.stringify(sortedExpected)) {
    fail(`The downloaded Actions artifact must contain exactly ${expectedNames.join(' and ')}.`);
  }
  for (const name of names) {
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) {
      fail('The downloaded Actions artifact contains an unsafe path.');
    }
  }
}

async function verifyDownloadedArtifact({
  zipContents,
  artifact,
  publisherRun,
  publisherWorkflow,
  sourceSha,
  ciRunId,
  ciRunAttempt,
  workspace,
  execFileSyncImpl,
}) {
  if (zipContents.byteLength !== Number(artifact.size_in_bytes)) {
    fail('The downloaded Actions ZIP size does not match its artifact metadata.');
  }
  const zipPath = join(workspace, 'actions-artifact.zip');
  const artifactDirectory = join(workspace, 'artifact');
  await writeFile(zipPath, zipContents, { flag: 'wx', mode: 0o600 });
  const names = webBuildArtifactNames(sourceSha, ciRunId, ciRunAttempt);
  verifyZipContents(zipPath, [names.archiveName, names.manifestName], execFileSyncImpl);
  await mkdir(artifactDirectory);
  execFileSyncImpl('unzip', ['-q', zipPath, '-d', artifactDirectory], { stdio: 'ignore' });
  const entries = (await readdir(artifactDirectory)).sort();
  if (JSON.stringify(entries) !== JSON.stringify([names.archiveName, names.manifestName].sort())) {
    fail('The downloaded Actions ZIP did not extract to exactly the checked manifest and archive.');
  }
  for (const name of entries) {
    const info = await lstat(join(artifactDirectory, name));
    if (!info.isFile() || info.isSymbolicLink()) {
      fail(`The downloaded Actions artifact contains an unsupported file: ${name}`);
    }
    if (name === names.manifestName && info.size > MAX_MANIFEST_BYTES) {
      fail('The downloaded web build manifest is too large to verify.');
    }
  }

  const manifest = await verifyWebBuildArtifact({
    artifactDirectory,
    sourceRevision: sourceSha,
    repository: WEB_REPOSITORY,
    runId: ciRunId,
    runAttempt: ciRunAttempt,
  });
  const manifestBytes = await readFile(join(artifactDirectory, names.manifestName));
  const archiveBytes = await readFile(join(artifactDirectory, names.archiveName));
  const web = {
    repository: WEB_REPOSITORY,
    sourceSha,
    source: {
      kind: 'actions',
      workflowRunId: publisherRun.id,
      workflowName: 'Publish Build',
      workflowId: publisherWorkflow.id,
      workflowRunAttempt: publisherRun.run_attempt,
      workflowRunSha: sourceSha,
      artifactId: Number(artifact.id),
      artifactSizeBytes: Number(artifact.size_in_bytes),
      artifactName: artifact.name,
      downloadUrl: artifact.archive_download_url,
      ciRunId: manifest.ci.runId,
      ciRunAttempt: manifest.ci.runAttempt,
      expiresAt: artifact.expires_at,
    },
    manifest: { name: names.manifestName, sha256: sha256(manifestBytes) },
    archive: {
      name: names.archiveName,
      sha256: sha256(archiveBytes),
      sizeBytes: archiveBytes.byteLength,
    },
    assetIdentitySha256: manifest.assets.treeSha256,
  };
  return { web, artifactDirectory };
}

export async function verifyPublishedActionsBuild({
  workflowRunId,
  workflowRunAttempt,
  expectedSourceSha,
  token,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetchImpl = fetch,
  execFileSyncImpl = execFileSync,
  now = () => new Date(),
  workspace,
}) {
  requirePositiveInteger(Number(workflowRunId), 'Publisher workflow run ID');
  requirePositiveInteger(Number(workflowRunAttempt), 'Publisher workflow run attempt');
  if (!token) {
    fail('A repository Actions read token is required to verify the published build.');
  }
  const ownWorkspace = workspace ?? (await mkdtemp(join(tmpdir(), 'pitaka-web-local-selection-')));
  const ownsWorkspace = workspace === undefined;
  try {
    const publisherWorkflow = requireWorkflow(
      await getJson({
        apiBaseUrl,
        repository: WEB_REPOSITORY,
        path: 'actions/workflows/publish-build.yml',
        token,
        fetchImpl,
      }),
      { name: 'Publish Build', path: '.github/workflows/publish-build.yml' },
    );
    const publisherRun = requireSuccessfulRun(
      await getJson({
        apiBaseUrl,
        repository: WEB_REPOSITORY,
        path: `actions/runs/${Number(workflowRunId)}/attempts/${Number(workflowRunAttempt)}`,
        token,
        fetchImpl,
      }),
      {
        id: Number(workflowRunId),
        attempt: Number(workflowRunAttempt),
        workflow: { ...publisherWorkflow, name: 'Publish Build' },
        repository: WEB_REPOSITORY,
        event: 'workflow_run',
        sourceSha: undefined,
      },
    );
    if (!FULL_SHA.test(publisherRun.head_sha ?? '')) {
      fail('The completed Publish Build run does not record a full source SHA.');
    }
    const sourceSha = publisherRun.head_sha;
    if (expectedSourceSha && expectedSourceSha !== sourceSha) {
      fail('The completed publisher run SHA does not match its workflow_run event.');
    }
    assertMainAncestry(sourceSha, execFileSyncImpl);

    const artifacts = await getJsonPages({
      apiBaseUrl,
      repository: WEB_REPOSITORY,
      path: `actions/runs/${Number(workflowRunId)}/artifacts?per_page=100`,
      token,
      fetchImpl,
    });
    const runStarted = Date.parse(publisherRun.run_started_at);
    const runCompleted = Date.parse(publisherRun.updated_at);
    const matchingArtifacts = artifacts.filter((artifact) => {
      const hasExpectedIdentity = new RegExp(`^pitaka-web-${sourceSha}-run-\\d+-attempt-\\d+$`).test(
        artifact.name ?? '',
      );
      const created = Date.parse(artifact.created_at);
      return (
        hasExpectedIdentity &&
        artifact.workflow_run?.id === publisherRun.id &&
        artifact.workflow_run?.head_sha === sourceSha &&
        artifact.workflow_run?.head_branch === 'main' &&
        Number.isFinite(created) &&
        created >= runStarted &&
        created <= runCompleted
      );
    });
    if (matchingArtifacts.length !== 1) {
      fail(
        matchingArtifacts.length === 0
          ? 'The completed Publish Build attempt has no matching uploaded Actions artifact.'
          : 'The completed Publish Build attempt has multiple matching Actions artifacts; refusing an ambiguous selection.',
      );
    }
    const selected = validatePublisherArtifact(matchingArtifacts[0], publisherRun, sourceSha, now());

    const artifact = await getJson({
      apiBaseUrl,
      repository: WEB_REPOSITORY,
      path: `actions/artifacts/${selected.artifact.id}`,
      token,
      fetchImpl,
    });
    if (
      artifact.id !== selected.artifact.id ||
      artifact.name !== selected.artifact.name ||
      artifact.size_in_bytes !== selected.artifact.size_in_bytes ||
      artifact.archive_download_url !== selected.artifact.archive_download_url ||
      artifact.expires_at !== selected.artifact.expires_at ||
      artifact.expired !== false ||
      artifact.workflow_run?.id !== publisherRun.id ||
      artifact.workflow_run?.head_sha !== sourceSha ||
      artifact.workflow_run?.head_branch !== 'main'
    ) {
      fail('The exact Actions artifact ID no longer matches the completed publisher run.');
    }

    const ciWorkflow = requireWorkflow(
      await getJson({
        apiBaseUrl,
        repository: WEB_REPOSITORY,
        path: 'actions/workflows/ci.yml',
        token,
        fetchImpl,
      }),
      { name: 'CI', path: '.github/workflows/ci.yml' },
    );
    const ciRunId = selected.ciRunId;
    const ciRunAttempt = selected.ciRunAttempt;
    const ciRun = requireSuccessfulRun(
      await getJson({
        apiBaseUrl,
        repository: WEB_REPOSITORY,
        path: `actions/runs/${ciRunId}/attempts/${ciRunAttempt}`,
        token,
        fetchImpl,
      }),
      {
        id: ciRunId,
        attempt: ciRunAttempt,
        workflow: { ...ciWorkflow, name: 'CI' },
        repository: WEB_REPOSITORY,
        event: 'push',
        sourceSha,
      },
    );

    const zipResponse = await fetchImpl(artifact.archive_download_url, {
      headers: githubApiHeaders(token),
    });
    if (!zipResponse.ok) {
      throw describeHttpError('Downloading the checked Actions artifact', zipResponse);
    }
    const zipContents = Buffer.from(await zipResponse.arrayBuffer());
    const verified = await verifyDownloadedArtifact({
      zipContents,
      artifact,
      publisherRun,
      publisherWorkflow,
      sourceSha,
      ciRunId: ciRun.id,
      ciRunAttempt: ciRun.run_attempt,
      workspace: ownWorkspace,
      execFileSyncImpl,
    });
    validateWebSelection(verified.web);
    return {
      ...verified,
      publisherRun: {
        id: publisherRun.id,
        attempt: publisherRun.run_attempt,
        workflowId: publisherWorkflow.id,
      },
      ciRun: { id: ciRun.id, attempt: ciRun.run_attempt },
      workspace: ownWorkspace,
      ownsWorkspace,
    };
  } catch (error) {
    if (ownsWorkspace) {
      await rm(ownWorkspace, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function prepareActionsSelection({
  workflowRunId,
  workflowRunAttempt,
  expectedSourceSha,
  token,
  apiBaseUrl,
  fetchImpl,
  execFileSyncImpl,
  now,
  runnerTemp = tmpdir(),
}) {
  const workspace = await mkdtemp(join(runnerTemp, 'pitaka-web-local-selection-'));
  try {
    const verified = await verifyPublishedActionsBuild({
      workflowRunId,
      workflowRunAttempt,
      expectedSourceSha,
      token,
      apiBaseUrl,
      fetchImpl,
      execFileSyncImpl,
      now,
      workspace,
    });
    const candidatePath = join(workspace, 'candidate.json');
    await writeFile(
      candidatePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          eventType: 'successful-publish-build',
          sourceSha: verified.web.sourceSha,
          publisherRun: verified.publisherRun,
          ciRun: verified.ciRun,
          artifactDirectory: verified.artifactDirectory,
          web: verified.web,
        },
        null,
        2,
      )}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    return { candidatePath, ...verified };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

export async function prepareReleaseSelection({
  promotionRunId,
  promotionRunAttempt,
  expectedSourceSha,
  releaseTag,
  token,
  apiBaseUrl,
  fetchImpl,
  execFileSyncImpl,
  runnerTemp = tmpdir(),
  verifyReleaseImpl = verifyPromotedWebRelease,
}) {
  const workspace = await mkdtemp(join(runnerTemp, 'pitaka-web-local-selection-'));
  try {
    const verified = await verifyReleaseImpl({
      promotionRunId,
      promotionRunAttempt,
      expectedSourceSha,
      releaseTag,
      token,
      apiBaseUrl,
      fetchImpl,
      execFileSyncImpl,
    });
    validateWebSelection(verified.web);
    const candidatePath = join(workspace, 'candidate.json');
    await writeFile(
      candidatePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          eventType: 'verified-immutable-release-promotion',
          sourceSha: verified.web.sourceSha,
          promotionRun: verified.promotionRun,
          ciRun: verified.ciRun,
          release: verified.release,
          web: verified.web,
        },
        null,
        2,
      )}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    return { candidatePath, ...verified };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (!isObject(value)) {
    return JSON.stringify(value);
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

function comparePublicationIdentity(left, right) {
  const leftIdentity = [left.workflowRunId, left.workflowRunAttempt];
  const rightIdentity = [right.workflowRunId, right.workflowRunAttempt];
  for (let index = 0; index < leftIdentity.length; index += 1) {
    if (leftIdentity[index] > rightIdentity[index]) {
      return 1;
    }
    if (leftIdentity[index] < rightIdentity[index]) {
      return -1;
    }
  }
  return 0;
}

function isAncestor(ancestor, descendant, execFileSyncImpl) {
  try {
    execFileSyncImpl('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if (error.status === 1) {
      return false;
    }
    throw new LocalWebSelectionError(`Could not check source ancestry between ${ancestor} and ${descendant}.`);
  }
}

export function compareWebSelections(candidate, current, { execFileSyncImpl = execFileSync } = {}) {
  if (stableJson(candidate) === stableJson(current)) {
    return 'already-current';
  }
  if (candidate.source.kind === 'release' && candidate.sourceSha !== current.sourceSha) {
    return 'superseded';
  }
  if (candidate.sourceSha === current.sourceSha) {
    if (candidate.source.kind === 'release') {
      if (
        current.source.kind === 'actions' &&
        (candidate.archive.sha256 !== current.archive.sha256 ||
          candidate.assetIdentitySha256 !== current.assetIdentitySha256)
      ) {
        fail(
          `Immutable Release ${candidate.source.tag} does not match the selected Actions build bytes for ${candidate.sourceSha}; review the mismatch manually.`,
        );
      }
      return current.source.kind === 'release' ? 'superseded' : 'advance';
    }
    if (current.source.kind === 'release') {
      return 'superseded';
    }
    return comparePublicationIdentity(candidate.source, current.source) > 0 ? 'advance' : 'superseded';
  }
  if (isAncestor(current.sourceSha, candidate.sourceSha, execFileSyncImpl)) {
    return 'advance';
  }
  if (isAncestor(candidate.sourceSha, current.sourceSha, execFileSyncImpl)) {
    return 'superseded';
  }
  fail(
    `Selected SHA ${current.sourceSha} and checked SHA ${candidate.sourceSha} are unrelated; review the selection manually.`,
  );
}

function sha1GitBlob(bytes) {
  const prefix = Buffer.from(`blob ${bytes.byteLength}\0`);
  return createHash('sha1').update(prefix).update(bytes).digest('hex');
}

function decodeVersionContents(response) {
  if (typeof response.content !== 'string' || typeof response.sha !== 'string' || response.encoding !== 'base64') {
    fail('Deploy repository did not return a base64 version record and blob SHA.');
  }
  const encoded = response.content.replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    fail('Deploy repository returned malformed base64 version content.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (sha1GitBlob(bytes) !== response.sha) {
    fail('Deploy repository version content does not match its recorded blob SHA.');
  }
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('Deploy repository version record is not valid JSON.');
  }
  return { bytes, record, sha: response.sha };
}

async function readDeployVersion({ token, apiBaseUrl, fetchImpl }) {
  const response = await fetchImpl(
    apiUrl(apiBaseUrl, DEPLOY_REPOSITORY, `contents/${DEPLOY_VERSION_PATH}`, '?ref=main'),
    { headers: githubApiHeaders(token) },
  );
  if (!response.ok) {
    throw describeHttpError('Reading pitaka-deploy/main versions/local.json', response);
  }
  return decodeVersionContents(await response.json());
}

function isRetryableStatus(status, headers, message) {
  if ([408, 409, 429].includes(status) || status >= 500) {
    return true;
  }
  if (status === 403 && (headers.get('retry-after') || headers.get('x-ratelimit-remaining') === '0')) {
    return true;
  }
  return status === 422 && /sha.{0,40}(does not match|doesn't match|conflict|out of date)/i.test(message);
}

function isRetryableError(error) {
  return (
    error.retryable === true ||
    error instanceof TypeError ||
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)
  );
}

async function pauseBeforeRetry(index, headers, sleepImpl) {
  const retryAfter = Number(headers?.get('retry-after'));
  const requestedMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** index;
  await sleepImpl(Math.min(Math.max(requestedMs, 100), 1200));
}

async function performWrite({
  record,
  blobSha,
  candidate,
  publisherRun,
  ciRun,
  token,
  apiBaseUrl,
  botIdentity,
  fetchImpl,
}) {
  const nextRecord = { ...record, web: candidate };
  validateRecordWebSelection(nextRecord);
  const content = `${JSON.stringify(nextRecord, null, 2)}\n`;
  const message = [
    `Select checked web build ${candidate.sourceSha}`,
    '',
    ...(candidate.source.kind === 'actions'
      ? [
          `Source: Publish Build run ${publisherRun.id}, attempt ${publisherRun.attempt}`,
          `CI: ${ciRun.id}, attempt ${ciRun.attempt}`,
        ]
      : [`Source: immutable Release ${candidate.source.tag} (${candidate.source.releaseId})`]),
  ].join('\n');
  const response = await fetchImpl(apiUrl(apiBaseUrl, DEPLOY_REPOSITORY, `contents/${DEPLOY_VERSION_PATH}`), {
    method: 'PUT',
    headers: {
      ...githubApiHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: blobSha,
      branch: 'main',
      author: botIdentity,
      committer: botIdentity,
    }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    const error = new LocalWebSelectionError(
      `Writing pitaka-deploy/main versions/local.json failed with HTTP ${response.status}.`,
    );
    error.status = response.status;
    error.headers = response.headers;
    error.retryable = isRetryableStatus(response.status, response.headers, details);
    throw error;
  }
  return response;
}

async function resolveBotIdentity({ token, apiBaseUrl, appSlug, fetchImpl }) {
  if (!/^[a-z0-9-]+$/.test(appSlug ?? '')) {
    fail('The GitHub App token action did not return a valid App slug.');
  }
  const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/users/${encodeURIComponent(`${appSlug}[bot]`)}`, {
    headers: githubApiHeaders(token),
  });
  const bot = await readJsonResponse(response, 'Resolving the GitHub App bot identity');
  if (!positiveInteger(bot.id) || bot.login !== `${appSlug}[bot]`) {
    fail('GitHub did not return the bot identity for the deploy App.');
  }
  const email = `${bot.id}+${bot.login}@users.noreply.github.com`;
  return { name: bot.login, email };
}

export async function applyLocalWebSelection({
  candidate,
  promotionRun,
  token,
  appSlug,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetchImpl = fetch,
  execFileSyncImpl = execFileSync,
  now = () => new Date(),
  eventType,
  sleepImpl = (duration) => new Promise((resolveSleep) => setTimeout(resolveSleep, duration)),
}) {
  const report = {
    eventType:
      eventType ??
      (candidate?.source?.kind === 'release'
        ? 'verified immutable Release promotion'
        : 'successful Publish Build completion'),
    sourceSha: candidate?.sourceSha,
    publisherRun:
      candidate?.source?.kind === 'actions'
        ? { id: candidate.source.workflowRunId, attempt: candidate.source.workflowRunAttempt }
        : undefined,
    ciRun: candidate?.source ? { id: candidate.source.ciRunId, attempt: candidate.source.ciRunAttempt } : undefined,
    promotionRun,
    release:
      candidate?.source?.kind === 'release' ? { id: candidate.source.releaseId, tag: candidate.source.tag } : undefined,
    before: undefined,
    after: undefined,
    writeAttempts: 0,
  };

  try {
    if (!token) {
      fail('A deploy-repository GitHub App token is required to select the checked build.');
    }
    validateWebSelection(candidate);
    if (candidate.source.kind === 'actions' && Date.parse(candidate.source.expiresAt) <= now().getTime()) {
      fail('The checked Actions artifact expired before the deploy selection could be written.');
    }
    const botIdentity = await resolveBotIdentity({ token, apiBaseUrl, appSlug, fetchImpl });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      let current;
      try {
        current = await readDeployVersion({ token, apiBaseUrl, fetchImpl });
      } catch (error) {
        if (!isRetryableError(error) || cycle === 2) {
          throw error;
        }
        await pauseBeforeRetry(cycle, undefined, sleepImpl);
        continue;
      }
      validateRecordWebSelection(current.record);
      if (report.before === undefined) {
        report.before = current.record.web;
      }
      const decision = compareWebSelections(candidate, current.record.web, { execFileSyncImpl });
      if (decision === 'already-current') {
        report.after = current.record.web;
        return { ...report, outcome: report.writeAttempts > 0 ? 'applied' : 'already current' };
      }
      if (decision === 'superseded') {
        report.after = current.record.web;
        return { ...report, outcome: 'validly superseded' };
      }

      report.after = undefined;
      report.writeAttempts += 1;
      let writeHeaders;
      try {
        const writeResponse = await performWrite({
          record: current.record,
          blobSha: current.sha,
          candidate,
          publisherRun: report.publisherRun,
          ciRun: report.ciRun,
          token,
          apiBaseUrl,
          botIdentity,
          fetchImpl,
        });
        writeHeaders = writeResponse.headers;
      } catch (error) {
        const retryable = error.retryable === true || isRetryableError(error);
        if (!retryable || cycle === 2) {
          throw error;
        }
        await pauseBeforeRetry(cycle, error.headers, sleepImpl);
        continue;
      }

      try {
        const afterWrite = await readDeployVersion({ token, apiBaseUrl, fetchImpl });
        validateRecordWebSelection(afterWrite.record);
        report.after = afterWrite.record.web;
        const finalDecision = compareWebSelections(candidate, afterWrite.record.web, {
          execFileSyncImpl,
        });
        if (finalDecision === 'already-current') {
          return { ...report, outcome: 'applied' };
        }
        if (finalDecision === 'superseded') {
          return { ...report, outcome: 'validly superseded' };
        }
      } catch (error) {
        if (!isRetryableError(error) || cycle === 2) {
          throw error;
        }
        await pauseBeforeRetry(cycle, writeHeaders, sleepImpl);
        continue;
      }
      if (cycle < 2) {
        await pauseBeforeRetry(cycle, writeHeaders, sleepImpl);
      }
    }
    throw new LocalWebSelectionError(
      'The checked web selection was not verified within three handoff attempts; inspect pitaka-deploy/main before retrying.',
    );
  } catch (error) {
    if (token && report.before !== undefined) {
      try {
        const finalState = await readDeployVersion({ token, apiBaseUrl, fetchImpl });
        validateRecordWebSelection(finalState.record);
        report.after = finalState.record.web;
      } catch {
        report.after = undefined;
      }
    }
    error.selectionReport = report;
    throw error;
  }
}

export function formatSelection(web) {
  if (!web) {
    return 'unavailable (deploy record not read)';
  }
  if (web.source?.kind === 'actions') {
    return `${web.sourceSha} via Actions artifact ${web.source.artifactId} (Publish Build ${web.source.workflowRunId}/${web.source.workflowRunAttempt}, CI ${web.source.ciRunId}/${web.source.ciRunAttempt})`;
  }
  if (web.source?.kind === 'release') {
    return `${web.sourceSha} via immutable Release ${web.source.tag} (${web.source.releaseId})`;
  }
  return `${web.sourceSha} via ${web.source?.kind ?? 'unknown source'}`;
}

export async function writeSelectionSummary(summaryPath, report) {
  if (!summaryPath) {
    return;
  }
  const lines = [
    '## Local web selection handoff',
    '',
    `- Event type: ${report.eventType ?? 'successful Publish Build completion'}`,
    `- Source SHA: \`${report.sourceSha ?? 'unavailable'}\``,
    `- Publisher run: ${
      report.publisherRun ? `${report.publisherRun.id}, attempt ${report.publisherRun.attempt}` : 'not applicable'
    }`,
    `- Promotion run: ${
      report.promotionRun ? `${report.promotionRun.id}, attempt ${report.promotionRun.attempt}` : 'not applicable'
    }`,
    `- Immutable Release: ${
      report.release ? `${report.release.tag} (ID ${report.release.id ?? 'unavailable'})` : 'not applicable'
    }`,
    `- Successful CI run: ${report.ciRun?.id ?? 'unavailable'}, attempt ${report.ciRun?.attempt ?? 'unavailable'}`,
    `- Deploy selection before: ${formatSelection(report.before)}`,
    `- Deploy selection after: ${formatSelection(report.after)}`,
    `- Write attempts: ${report.writeAttempts ?? 0}`,
    `- Outcome: ${report.outcome ?? 'failed'}`,
    `- Recovery: ${report.recovery ?? 'Correct the reported verification, authorization, or deploy-record issue, then rerun this handoff while the source artifact is still available.'}`,
    '',
    'This updates the local stack selection; it does not run smoke, apply, or report deployment success.',
    '',
  ];
  await writeFile(summaryPath, `${lines.join('\n')}\n`, { flag: 'a' });
}

function safeAnnotation(message) {
  return message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function writeOutput(name, value, outputPath) {
  if (!outputPath) {
    return;
  }
  return writeFile(outputPath, `${name}=${value}\n`, { flag: 'a' });
}

async function prepareCli(workflowRunId, workflowRunAttempt) {
  const report = {
    sourceSha: process.env.PUBLISH_RUN_SHA,
    publisherRun: { id: Number(workflowRunId), attempt: Number(workflowRunAttempt) },
    ciRun: undefined,
    before: undefined,
    after: undefined,
    writeAttempts: 0,
  };
  try {
    const prepared = await prepareActionsSelection({
      workflowRunId: Number(workflowRunId),
      workflowRunAttempt: Number(workflowRunAttempt),
      expectedSourceSha: process.env.PUBLISH_RUN_SHA,
      token: process.env.GITHUB_TOKEN,
      apiBaseUrl: process.env.GITHUB_API_URL ?? DEFAULT_API_BASE_URL,
    });
    report.sourceSha = prepared.web.sourceSha;
    report.ciRun = prepared.ciRun;
    await writeOutput('candidate_path', prepared.candidatePath, process.env.GITHUB_OUTPUT);
    await writeOutput('source_sha', prepared.web.sourceSha, process.env.GITHUB_OUTPUT);
    await writeOutput('publisher_run_id', prepared.publisherRun.id, process.env.GITHUB_OUTPUT);
    await writeOutput('publisher_run_attempt', prepared.publisherRun.attempt, process.env.GITHUB_OUTPUT);
    await writeOutput('ci_run_id', prepared.ciRun.id, process.env.GITHUB_OUTPUT);
    await writeOutput('ci_run_attempt', prepared.ciRun.attempt, process.env.GITHUB_OUTPUT);
    return;
  } catch (error) {
    report.outcome = 'failed';
    report.recovery =
      'Correct the source run or artifact issue. If its artifact has expired, publish a new successful main CI build.';
    await writeSelectionSummary(process.env.GITHUB_STEP_SUMMARY, report);
    process.stderr.write(`::error title=Local web selection verification failed::${safeAnnotation(error.message)}\n`);
    throw error;
  }
}

async function prepareReleaseCli() {
  const promotionRunId = Number(process.env.PROMOTION_RUN_ID);
  const promotionRunAttempt = Number(process.env.PROMOTION_RUN_ATTEMPT);
  const report = {
    eventType: 'verified immutable Release promotion',
    sourceSha: process.env.PROMOTION_RUN_SHA,
    promotionRun:
      positiveInteger(promotionRunId) && positiveInteger(promotionRunAttempt)
        ? { id: promotionRunId, attempt: promotionRunAttempt }
        : undefined,
    release: process.env.RELEASE_TAG ? { tag: process.env.RELEASE_TAG } : undefined,
    before: undefined,
    after: undefined,
    writeAttempts: 0,
  };
  try {
    const prepared = await prepareReleaseSelection({
      promotionRunId,
      promotionRunAttempt,
      expectedSourceSha: process.env.PROMOTION_RUN_SHA,
      releaseTag: process.env.RELEASE_TAG,
      token: process.env.GITHUB_TOKEN,
      apiBaseUrl: process.env.GITHUB_API_URL ?? DEFAULT_API_BASE_URL,
    });
    report.sourceSha = prepared.web.sourceSha;
    report.promotionRun = prepared.promotionRun;
    report.release = prepared.release;
    report.ciRun = prepared.ciRun;
    await writeOutput('candidate_path', prepared.candidatePath, process.env.GITHUB_OUTPUT);
    await writeOutput('source_sha', prepared.web.sourceSha, process.env.GITHUB_OUTPUT);
    await writeOutput('promotion_run_id', prepared.promotionRun.id, process.env.GITHUB_OUTPUT);
    await writeOutput('promotion_run_attempt', prepared.promotionRun.attempt, process.env.GITHUB_OUTPUT);
    await writeOutput('release_id', prepared.release.id, process.env.GITHUB_OUTPUT);
    await writeOutput('release_tag', prepared.release.tag, process.env.GITHUB_OUTPUT);
    await writeOutput('ci_run_id', prepared.ciRun.id, process.env.GITHUB_OUTPUT);
    await writeOutput('ci_run_attempt', prepared.ciRun.attempt, process.env.GITHUB_OUTPUT);
  } catch (error) {
    report.promotionRun = error.releaseVerification?.promotionRun ?? report.promotionRun;
    report.release = error.releaseVerification?.release ?? report.release;
    report.ciRun = error.releaseVerification?.ciRun ?? report.ciRun;
    report.outcome = 'failed';
    report.recovery =
      'Correct the promotion, Release, or provenance issue, then rerun this handoff for the same stable version tag.';
    await writeSelectionSummary(process.env.GITHUB_STEP_SUMMARY, report);
    process.stderr.write(`::error title=Local web Release verification failed::${safeAnnotation(error.message)}\n`);
    throw error;
  }
}

function parsePreparedCandidate(candidatePath) {
  const resolved = resolve(candidatePath);
  const tempRoot = resolve(tmpdir());
  if (!resolved.startsWith(`${tempRoot}/`) || !resolved.endsWith('/candidate.json')) {
    fail('The verified candidate path is outside the runner temporary directory.');
  }
  return resolved;
}

async function applyCli(candidatePath) {
  let prepared;
  let resolvedCandidatePath;
  let report = { writeAttempts: 0 };
  try {
    resolvedCandidatePath = parsePreparedCandidate(candidatePath);
    prepared = JSON.parse(await readFile(resolvedCandidatePath, 'utf8'));
    const commonCandidateIsInvalid =
      !isObject(prepared) ||
      prepared.schemaVersion !== 1 ||
      !isObject(prepared.web) ||
      !FULL_SHA.test(prepared.sourceSha ?? '') ||
      prepared.sourceSha !== prepared.web.sourceSha;
    const actionsCandidate = prepared.eventType === 'successful-publish-build';
    const releaseCandidate = prepared.eventType === 'verified-immutable-release-promotion';
    if (commonCandidateIsInvalid || (!actionsCandidate && !releaseCandidate)) {
      fail('The verified web build candidate data is incomplete or inconsistent.');
    }
    validateWebSelection(prepared.web);
    if (actionsCandidate) {
      if (
        !isObject(prepared.publisherRun) ||
        !isObject(prepared.ciRun) ||
        prepared.web.source.kind !== 'actions' ||
        typeof prepared.artifactDirectory !== 'string' ||
        resolve(prepared.artifactDirectory) !== resolve(join(resolve(resolvedCandidatePath, '..'), 'artifact'))
      ) {
        fail('The checked publisher candidate data is incomplete or inconsistent.');
      }
      const names = webBuildArtifactNames(
        prepared.sourceSha,
        prepared.web.source.ciRunId,
        prepared.web.source.ciRunAttempt,
      );
      const entries = (await readdir(prepared.artifactDirectory)).sort();
      if (JSON.stringify(entries) !== JSON.stringify([names.archiveName, names.manifestName].sort())) {
        fail('The checked publisher artifact directory changed after verification.');
      }
      for (const name of entries) {
        const info = await lstat(join(prepared.artifactDirectory, name));
        if (!info.isFile() || info.isSymbolicLink()) {
          fail(`The checked publisher artifact contains an unsupported file: ${name}`);
        }
        if (name === names.manifestName && info.size > MAX_MANIFEST_BYTES) {
          fail('The checked publisher manifest is too large to use for deploy selection.');
        }
      }
      const manifestBytes = await readFile(join(prepared.artifactDirectory, names.manifestName));
      const archiveBytes = await readFile(join(prepared.artifactDirectory, names.archiveName));
      if (
        sha256(manifestBytes) !== prepared.web.manifest.sha256 ||
        sha256(archiveBytes) !== prepared.web.archive.sha256
      ) {
        fail('The checked publisher artifact bytes changed before deploy selection.');
      }
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      if (
        manifest.schemaVersion !== 1 ||
        manifest.source?.repository !== WEB_REPOSITORY ||
        manifest.source?.sha !== prepared.sourceSha ||
        manifest.ci?.workflow !== 'CI' ||
        manifest.ci?.runId !== prepared.web.source.ciRunId ||
        manifest.ci?.runAttempt !== prepared.web.source.ciRunAttempt ||
        manifest.actionsArtifact?.name !== prepared.web.source.artifactName ||
        manifest.actionsArtifact?.retentionDays !== 14 ||
        manifest.archive?.name !== prepared.web.archive.name ||
        manifest.archive?.sha256 !== prepared.web.archive.sha256 ||
        manifest.archive?.sizeBytes !== prepared.web.archive.sizeBytes ||
        manifest.assets?.treeSha256 !== prepared.web.assetIdentitySha256
      ) {
        fail('The checked publisher manifest identity changed before deploy selection.');
      }
    } else if (
      prepared.web.source.kind !== 'release' ||
      !isObject(prepared.promotionRun) ||
      !positiveInteger(prepared.promotionRun.id) ||
      !positiveInteger(prepared.promotionRun.attempt) ||
      !positiveInteger(prepared.promotionRun.workflowId) ||
      !isObject(prepared.release) ||
      prepared.release.id !== prepared.web.source.releaseId ||
      prepared.release.tag !== prepared.web.source.tag ||
      !isObject(prepared.ciRun) ||
      prepared.ciRun.id !== prepared.web.source.ciRunId ||
      prepared.ciRun.attempt !== prepared.web.source.ciRunAttempt
    ) {
      fail('The verified immutable Release candidate data is incomplete or inconsistent.');
    }

    report = {
      sourceSha: prepared.sourceSha,
      publisherRun: prepared.publisherRun,
      ciRun: prepared.ciRun,
      promotionRun: prepared.promotionRun,
      release: prepared.release,
      before: undefined,
      after: undefined,
      writeAttempts: 0,
    };
    const result = await applyLocalWebSelection({
      candidate: prepared.web,
      promotionRun: prepared.promotionRun,
      token: process.env.DEPLOY_APP_TOKEN,
      appSlug: process.env.DEPLOY_APP_SLUG,
      apiBaseUrl: process.env.GITHUB_API_URL ?? DEFAULT_API_BASE_URL,
      eventType: actionsCandidate ? 'successful Publish Build completion' : 'verified immutable Release promotion',
    });
    report = result;
    report.recovery = 'No recovery is needed.';
    await writeSelectionSummary(process.env.GITHUB_STEP_SUMMARY, report);
    return result;
  } catch (error) {
    if (error.selectionReport) {
      report = { ...report, ...error.selectionReport };
    }
    report = {
      ...report,
      sourceSha: prepared?.sourceSha ?? report.sourceSha,
      publisherRun: prepared?.publisherRun ?? report.publisherRun,
      ciRun: prepared?.ciRun ?? report.ciRun,
      outcome: 'failed',
      recovery:
        prepared?.eventType === 'verified-immutable-release-promotion'
          ? 'Correct the reported issue and rerun this handoff; the verified immutable Release remains available.'
          : 'Correct the reported issue and rerun this handoff while the source artifact is still available. If expired, publish a new successful main CI build.',
    };
    await writeSelectionSummary(process.env.GITHUB_STEP_SUMMARY, report);
    process.stderr.write(`::error title=Local web selection handoff failed::${safeAnnotation(error.message)}\n`);
    throw error;
  } finally {
    if (resolvedCandidatePath) {
      await rm(resolve(resolvedCandidatePath, '..'), { recursive: true, force: true });
    }
  }
}

async function cli() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'prepare' && args.length === 2) {
    await prepareCli(args[0], args[1]);
    return;
  }
  if (mode === 'prepare-release' && args.length === 0) {
    await prepareReleaseCli();
    return;
  }
  if (mode === 'apply' && args.length === 1) {
    await applyCli(args[0]);
    return;
  }
  throw new Error(
    'Usage: select-local-web-build.mjs prepare <publisher-run-id> <publisher-run-attempt> | prepare-release | apply <verified-candidate-path>',
  );
}

if (isMainModule(import.meta.url, process.argv[1])) {
  cli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
