import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  isMainModule,
  validateSourceRevision,
  verifyWebBuildArtifact,
  webBuildArtifactNames,
} from './web-build-artifact.mjs';

const DEFAULT_REPOSITORY = 'itsdevjimbo/pitaka-web';

function getToken() {
  const existingToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (existingToken) {
    return existingToken;
  }

  const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }

  throw new Error('Set GH_TOKEN or GITHUB_TOKEN with Actions: read access to itsdevjimbo/pitaka-web.');
}

function nextPage(linkHeader) {
  const links = linkHeader?.split(',') ?? [];
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

async function getJsonPages(url, token, fetchImpl) {
  const results = [];
  let pageUrl = url;
  while (pageUrl) {
    const response = await fetchImpl(pageUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed with HTTP ${response.status}: ${pageUrl}`);
    }

    const body = await response.json();
    if (Array.isArray(body.workflow_runs)) {
      results.push(...body.workflow_runs);
    } else if (Array.isArray(body.artifacts)) {
      results.push(...body.artifacts);
    } else {
      results.push(body);
    }
    pageUrl = nextPage(response.headers.get('link'));
  }
  return results;
}

function apiUrl(apiBaseUrl, repository, pathname, query = '') {
  return `${apiBaseUrl.replace(/\/$/, '')}/repos/${repository}/${pathname}${query}`;
}

async function listSuccessfulMainRuns({ sourceRevision, repository, token, apiBaseUrl, fetchImpl }) {
  const query = new URLSearchParams({
    head_sha: sourceRevision,
    branch: 'main',
    event: 'push',
    status: 'completed',
    per_page: '100',
  });
  const runs = await getJsonPages(apiUrl(apiBaseUrl, repository, 'actions/runs', `?${query}`), token, fetchImpl);
  return runs
    .filter(
      (run) =>
        run.name === 'CI' &&
        run.head_sha === sourceRevision &&
        run.head_branch === 'main' &&
        run.event === 'push' &&
        run.status === 'completed' &&
        run.conclusion === 'success',
    )
    .sort((left, right) => Number(left.id) - Number(right.id));
}

async function listSuccessfulArtifactRuns({ sourceRevision, repository, token, apiBaseUrl, fetchImpl }) {
  const query = new URLSearchParams({
    head_sha: sourceRevision,
    branch: 'main',
    event: 'workflow_run',
    status: 'completed',
    per_page: '100',
  });
  const runs = await getJsonPages(
    apiUrl(apiBaseUrl, repository, 'actions/workflows/publish-web-build.yml/runs', `?${query}`),
    token,
    fetchImpl,
  );
  return runs.filter(
    (run) =>
      run.name === 'Publish Web Build' &&
      run.head_sha === sourceRevision &&
      run.head_branch === 'main' &&
      run.event === 'workflow_run' &&
      run.status === 'completed' &&
      run.conclusion === 'success',
  );
}

function artifactIdentityFromName(name, sourceRevision) {
  const match = name.match(new RegExp(`^pitaka-web-${sourceRevision}-run-(\\d+)-attempt-(\\d+)$`));
  if (!match) {
    return undefined;
  }
  return { ciRunId: Number(match[1]), ciRunAttempt: Number(match[2]) };
}

async function listRunArtifacts({ workflowRunId, sourceRevision, ciRuns, repository, token, apiBaseUrl, fetchImpl }) {
  const artifacts = await getJsonPages(
    apiUrl(apiBaseUrl, repository, `actions/runs/${workflowRunId}/artifacts`, '?per_page=100'),
    token,
    fetchImpl,
  );
  const ciRunAttempts = new Map(ciRuns.map((run) => [Number(run.id), Number(run.run_attempt)]));
  return artifacts
    .map((artifact) => ({
      artifact,
      identity: artifactIdentityFromName(artifact.name, sourceRevision),
    }))
    .filter(
      ({ identity }) =>
        identity !== undefined &&
        ciRunAttempts.has(identity.ciRunId) &&
        identity.ciRunAttempt <= ciRunAttempts.get(identity.ciRunId),
    );
}

async function downloadResponse(url, token, fetchImpl, label) {
  const response = await fetchImpl(url, {
    headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' } : {},
  });
  if (response.status === 404 || response.status === 410) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Could not download ${label}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function validateZipPaths(zipPath, expectedNames) {
  const output = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  const names = output.split('\n').filter(Boolean);
  for (const name of names) {
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`The downloaded Actions artifact contains an unsafe path: ${name}`);
    }
  }
  const sortedNames = [...names].sort();
  const sortedExpected = [...expectedNames].sort();
  if (JSON.stringify(sortedNames) !== JSON.stringify(sortedExpected)) {
    throw new Error(`The downloaded artifact must contain exactly: ${expectedNames.join(', ')}`);
  }
}

async function unpackAndVerifyZip({ zipContents, workspace, sourceRevision, repository, runId, runAttempt }) {
  const zipPath = join(workspace, 'artifact.zip');
  const artifactDirectory = join(workspace, 'artifact');
  await writeFile(zipPath, zipContents);
  validateZipPaths(zipPath, [`pitaka-web-${sourceRevision}.tar.gz`, `pitaka-web-${sourceRevision}.manifest.json`]);
  await mkdir(artifactDirectory);
  execFileSync('unzip', ['-q', zipPath, '-d', artifactDirectory]);
  const manifest = await verifyWebBuildArtifact({
    artifactDirectory,
    sourceRevision,
    repository,
    runId,
    runAttempt,
  });
  return { artifactDirectory, manifest };
}

async function downloadActionsBuild({ sourceRevision, repository, token, apiBaseUrl, fetchImpl, workspace }) {
  const ciRuns = await listSuccessfulMainRuns({ sourceRevision, repository, token, apiBaseUrl, fetchImpl });
  if (ciRuns.length === 0) {
    return { status: 'missing', reason: `No successful main CI run exists for ${sourceRevision}.` };
  }

  const artifactRuns = await listSuccessfulArtifactRuns({
    sourceRevision,
    repository,
    token,
    apiBaseUrl,
    fetchImpl,
  });
  const candidates = [];
  let expiredCount = 0;
  let missingCount = 0;
  for (const run of artifactRuns) {
    const runArtifacts = await listRunArtifacts({
      workflowRunId: run.id,
      sourceRevision,
      ciRuns,
      repository,
      token,
      apiBaseUrl,
      fetchImpl,
    });
    const matchingNames = new Set();
    for (const { artifact, identity } of runArtifacts) {
      if (matchingNames.has(artifact.name)) {
        throw new Error(`Artifact publication run ${run.id} contains duplicate web build artifacts named ${artifact.name}.`);
      }
      matchingNames.add(artifact.name);
      if (artifact.expired) {
        expiredCount += 1;
        continue;
      }

      const artifactContents = await downloadResponse(
        artifact.archive_download_url,
        token,
        fetchImpl,
        `Actions artifact ${artifact.id}`,
      );
      if (!artifactContents) {
        expiredCount += 1;
        continue;
      }

      const attemptDirectory = join(
        workspace,
        `run-${identity.ciRunId}-attempt-${identity.ciRunAttempt}-publication-${run.id}`,
      );
      await mkdir(attemptDirectory);
      const unpacked = await unpackAndVerifyZip({
        zipContents: artifactContents,
        workspace: attemptDirectory,
        sourceRevision,
        repository,
        runId: identity.ciRunId,
        runAttempt: identity.ciRunAttempt,
      });
      candidates.push({
        runId: identity.ciRunId,
        runAttempt: identity.ciRunAttempt,
        artifactId: Number(artifact.id),
        artifactDirectory: unpacked.artifactDirectory,
        manifest: unpacked.manifest,
      });
    }
    if (runArtifacts.length === 0) {
      missingCount += 1;
    }
  }

  if (candidates.length === 0) {
    const reason =
      expiredCount > 0
        ? `The 14-day Actions artifact for ${sourceRevision} has expired.`
        : missingCount > 0 || artifactRuns.length === 0
          ? `A successful CI run for ${sourceRevision} has no matching web build artifact; it may be missing or past its 14-day retention.`
          : `No downloadable artifact exists for ${sourceRevision}.`;
    return { status: expiredCount > 0 ? 'expired' : 'missing', reason };
  }

  if (expiredCount > 0) {
    return {
      status: 'ambiguous',
      reason: `At least one matching successful CI attempt for ${sourceRevision} has an expired artifact, so its bytes cannot be compared with the remaining artifact.`,
    };
  }

  const archiveDigests = new Set(candidates.map(({ manifest }) => manifest.archive.sha256));
  if (archiveDigests.size !== 1) {
    throw new Error(
      `Conflicting successful CI attempts produced different web bytes for ${sourceRevision}; refusing to choose one.`,
    );
  }

  candidates.sort((left, right) => left.runId - right.runId || left.runAttempt - right.runAttempt);
  return { status: 'available', candidate: candidates[0] };
}

async function downloadReleaseBuild({
  sourceRevision,
  repository,
  releaseTag,
  token,
  apiBaseUrl,
  fetchImpl,
  workspace,
}) {
  const releaseResponse = await fetchImpl(
    apiUrl(apiBaseUrl, repository, `releases/tags/${encodeURIComponent(releaseTag)}`),
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
    },
  );
  if (releaseResponse.status === 404) {
    throw new Error(`Immutable release ${releaseTag} was not found; the expired Actions artifact cannot be rebuilt.`);
  }
  if (!releaseResponse.ok) {
    throw new Error(`Could not look up immutable release ${releaseTag}: HTTP ${releaseResponse.status}`);
  }
  const release = await releaseResponse.json();
  if (release.tag_name !== releaseTag || release.draft || release.prerelease || release.immutable !== true) {
    throw new Error(
      `Release ${releaseTag} must be published, stable, and immutable before it can provide durable web bytes.`,
    );
  }
  const taggedCommitResponse = await fetchImpl(
    apiUrl(apiBaseUrl, repository, `commits/${encodeURIComponent(releaseTag)}`),
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
    },
  );
  if (!taggedCommitResponse.ok) {
    throw new Error(
      `Could not resolve release tag ${releaseTag} to a source commit: HTTP ${taggedCommitResponse.status}`,
    );
  }
  const taggedCommit = await taggedCommitResponse.json();
  if (taggedCommit.sha !== sourceRevision) {
    throw new Error(
      `Immutable release ${releaseTag} points to ${taggedCommit.sha}, not requested source SHA ${sourceRevision}.`,
    );
  }

  const names = webBuildArtifactNames(sourceRevision, 1, 1);
  const expectedFiles = [names.archiveName, names.manifestName];
  const selectedAssets = expectedFiles.map((name) => {
    const matches = release.assets.filter((asset) => asset.name === name && asset.state === 'uploaded');
    if (matches.length !== 1) {
      throw new Error(`Immutable release ${releaseTag} must contain exactly one ${name} asset.`);
    }
    return matches[0];
  });

  const artifactDirectory = join(workspace, 'release-artifact');
  await mkdir(artifactDirectory);
  for (const asset of selectedAssets) {
    const contents = await downloadResponse(
      asset.browser_download_url,
      undefined,
      fetchImpl,
      `release asset ${asset.name}`,
    );
    if (!contents) {
      throw new Error(`Release asset ${asset.name} is unavailable; the web build cannot be rebuilt after expiry.`);
    }
    await writeFile(join(artifactDirectory, asset.name), contents);
  }

  const manifest = await verifyWebBuildArtifact({ artifactDirectory, sourceRevision, repository });
  const ciAttemptResponse = await fetchImpl(
    apiUrl(apiBaseUrl, repository, `actions/runs/${manifest.ci.runId}/attempts/${manifest.ci.runAttempt}`),
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
    },
  );
  if (!ciAttemptResponse.ok) {
    throw new Error(
      `Could not verify the original CI attempt ${manifest.ci.runId}/${manifest.ci.runAttempt} for the immutable release.`,
    );
  }
  const ciAttempt = await ciAttemptResponse.json();
  if (
    ciAttempt.name !== 'CI' ||
    ciAttempt.head_sha !== sourceRevision ||
    ciAttempt.head_branch !== 'main' ||
    ciAttempt.event !== 'push' ||
    ciAttempt.status !== 'completed' ||
    ciAttempt.conclusion !== 'success'
  ) {
    throw new Error(
      `The immutable release asset does not reference a successful main CI attempt for ${sourceRevision}.`,
    );
  }
  return { artifactDirectory, manifest, releaseTag };
}

async function copyArtifactToDestination(artifactDirectory, destinationDirectory, sourceRevision) {
  const destination = resolve(destinationDirectory);
  await mkdir(destination, { recursive: true });
  const existingFiles = await readdir(destination);
  if (existingFiles.length > 0) {
    throw new Error(
      `The destination must be empty so stale web files cannot be mistaken for this build: ${destination}`,
    );
  }
  const names = webBuildArtifactNames(sourceRevision, 1, 1);
  await copyFile(join(artifactDirectory, names.archiveName), join(destination, names.archiveName));
  await copyFile(join(artifactDirectory, names.manifestName), join(destination, names.manifestName));
}

export async function downloadWebBuild({
  sourceRevision,
  destinationDirectory,
  repository = DEFAULT_REPOSITORY,
  releaseTag,
  token,
  apiBaseUrl = 'https://api.github.com',
  fetchImpl = fetch,
}) {
  validateSourceRevision(sourceRevision);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`Expected an owner/repository name, received: ${repository}`);
  }
  if (!destinationDirectory) {
    throw new Error('A destination directory is required.');
  }
  if (!token) {
    throw new Error('Set GH_TOKEN or GITHUB_TOKEN with Actions: read access to itsdevjimbo/pitaka-web.');
  }

  const workspace = await mkdtemp(join(tmpdir(), 'pitaka-web-build-download-'));
  try {
    const actions = await downloadActionsBuild({ sourceRevision, repository, token, apiBaseUrl, fetchImpl, workspace });
    let selectedBuild;
    let source = 'actions';
    if (actions.status === 'available') {
      selectedBuild = actions.candidate;
    } else if (releaseTag) {
      selectedBuild = await downloadReleaseBuild({
        sourceRevision,
        repository,
        releaseTag,
        token,
        apiBaseUrl,
        fetchImpl,
        workspace,
      });
      source = 'release';
    } else {
      throw new Error(
        `${actions.reason} Pass --release-tag <tag> to retrieve an existing immutable production release. No source rebuild was attempted.`,
      );
    }

    await copyArtifactToDestination(selectedBuild.artifactDirectory, destinationDirectory, sourceRevision);
    return {
      source,
      releaseTag: selectedBuild.releaseTag,
      archiveName: selectedBuild.manifest.archive.name,
      archiveSha256: selectedBuild.manifest.archive.sha256,
      archiveSizeBytes: selectedBuild.manifest.archive.sizeBytes,
      ciRunId: selectedBuild.manifest.ci.runId,
      ciRunAttempt: selectedBuild.manifest.ci.runAttempt,
      artifactId: selectedBuild.artifactId,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function cli() {
  const [sourceRevision, destinationDirectory, ...options] = process.argv.slice(2);
  if (!sourceRevision || !destinationDirectory) {
    throw new Error(
      'Usage: download-web-build.mjs <full-sha> <destination-directory> [--release-tag <immutable-version-tag>]',
    );
  }

  let releaseTag;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] === '--release-tag' && options[index + 1]) {
      releaseTag = options[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${options[index]}`);
    }
  }

  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? getToken();
  const result = await downloadWebBuild({ sourceRevision, destinationDirectory, releaseTag, token });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  cli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
