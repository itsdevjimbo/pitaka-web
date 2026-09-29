import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubApiHeaders, githubApiUrl } from './github-api.mjs';
import {
  assertSourceReachableFromMain,
  requireSuccessfulWorkflowRun,
  requireWorkflow,
} from './github-workflow-provenance.mjs';
import { isPositiveInteger } from './value-validation.mjs';
import { isMainModule, sha256, verifyWebBuildArtifact, webBuildArtifactNames } from './web-build-artifact.mjs';

const WEB_REPOSITORY = 'itsdevjimbo/pitaka-web';
const DEFAULT_API_BASE_URL = 'https://api.github.com';
const FULL_SHA = /^[a-f0-9]{40}$/;
const VERSION_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  throw new Error(message);
}

async function getJson({ apiBaseUrl, pathname, token, fetchImpl }) {
  const response = await fetchImpl(githubApiUrl(apiBaseUrl, WEB_REPOSITORY, pathname), {
    headers: githubApiHeaders(token),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    fail(`GitHub API request for ${pathname} failed with HTTP ${response.status}${details ? `: ${details}` : ''}`);
  }
  try {
    return await response.json();
  } catch {
    fail(`GitHub API request for ${pathname} returned invalid JSON.`);
  }
}

function releaseAssets(release, sourceSha, tag) {
  const names = webBuildArtifactNames(sourceSha, 1, 1);
  const expectedNames = [names.archiveName, names.manifestName];
  if (!Array.isArray(release.assets) || release.assets.length !== expectedNames.length) {
    fail(`Release ${tag} must contain exactly the checked archive and manifest assets.`);
  }
  const selected = new Map();
  for (const asset of release.assets) {
    if (
      !expectedNames.includes(asset.name) ||
      selected.has(asset.name) ||
      !isPositiveInteger(asset.id) ||
      !isPositiveInteger(asset.size) ||
      asset.state !== 'uploaded'
    ) {
      fail(`Release ${tag} has an unexpected, duplicate, or incomplete asset identity.`);
    }
    const expectedApiUrl = `${DEFAULT_API_BASE_URL}/repos/${WEB_REPOSITORY}/releases/assets/${asset.id}`;
    const expectedDownloadUrl = `https://github.com/${WEB_REPOSITORY}/releases/download/${tag}/${asset.name}`;
    if (asset.url !== expectedApiUrl || asset.browser_download_url !== expectedDownloadUrl) {
      fail(`Release ${tag} asset ${asset.name} has an unexpected API or public download URL.`);
    }
    selected.set(asset.name, asset);
  }
  if (selected.size !== expectedNames.length) {
    fail(`Release ${tag} is missing its checked archive or manifest asset.`);
  }
  return { ...names, selected };
}

async function downloadPublicAsset({ asset, fetchImpl }) {
  const response = await fetchImpl(asset.browser_download_url, { headers: {} });
  if (!response.ok) {
    fail(`Could not download public Release asset ${asset.name}: HTTP ${response.status}.`);
  }
  const contents = Buffer.from(await response.arrayBuffer());
  if (contents.byteLength !== asset.size) {
    fail(`Public Release asset ${asset.name} size does not match its recorded identity.`);
  }
  return contents;
}

export async function verifyPromotedWebRelease({
  promotionRunId,
  promotionRunAttempt,
  expectedSourceSha,
  releaseTag,
  token,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetchImpl = fetch,
  execFileSyncImpl = execFileSync,
  workspace,
}) {
  const runId = Number(promotionRunId);
  const runAttempt = Number(promotionRunAttempt);
  if (!isPositiveInteger(runId) || !isPositiveInteger(runAttempt)) {
    fail('Promotion workflow run ID and attempt must be positive integers.');
  }
  if (!FULL_SHA.test(expectedSourceSha ?? '')) {
    fail('Promotion workflow run must identify a full source SHA.');
  }
  if (!VERSION_TAG.test(releaseTag ?? '')) {
    fail(`Expected a stable production tag in vMAJOR.MINOR.PATCH form, received: ${releaseTag ?? '(empty)'}.`);
  }
  if (!token) {
    fail('A repository Actions and Release read token is required to verify the promoted web Release.');
  }
  const ownWorkspace = workspace ?? (await mkdtemp(join(tmpdir(), 'pitaka-web-release-selection-')));
  const ownsWorkspace = workspace === undefined;
  const verification = { promotionRun: undefined, release: undefined, ciRun: undefined };
  try {
    const promotionWorkflow = requireWorkflow(
      await getJson({
        apiBaseUrl,
        pathname: 'actions/workflows/promote-production-build.yml',
        token,
        fetchImpl,
      }),
      { name: 'Promote Production Build', path: '.github/workflows/promote-production-build.yml', fail },
    );
    const promotionRun = requireSuccessfulWorkflowRun(
      await getJson({
        apiBaseUrl,
        pathname: `actions/runs/${runId}/attempts/${runAttempt}`,
        token,
        fetchImpl,
      }),
      {
        id: runId,
        attempt: runAttempt,
        workflow: promotionWorkflow,
        event: 'push',
        headBranch: releaseTag,
        sourceSha: expectedSourceSha,
        repository: WEB_REPOSITORY,
        fail,
      },
    );
    verification.promotionRun = {
      id: promotionRun.id,
      attempt: promotionRun.run_attempt,
      workflowId: promotionWorkflow.id,
    };
    assertSourceReachableFromMain({
      sourceSha: promotionRun.head_sha,
      execFileSyncImpl,
      fail,
      description: 'Promoted source SHA',
    });

    const taggedCommit = await getJson({
      apiBaseUrl,
      pathname: `commits/${encodeURIComponent(releaseTag)}`,
      token,
      fetchImpl,
    });
    if (taggedCommit.sha !== expectedSourceSha) {
      fail(`Version tag ${releaseTag} resolves to ${taggedCommit.sha}, not promoted SHA ${expectedSourceSha}.`);
    }

    const release = await getJson({
      apiBaseUrl,
      pathname: `releases/tags/${encodeURIComponent(releaseTag)}`,
      token,
      fetchImpl,
    });
    if (isPositiveInteger(release.id) && release.tag_name === releaseTag) {
      verification.release = { id: release.id, tag: releaseTag };
    }
    if (
      !isPositiveInteger(release.id) ||
      release.tag_name !== releaseTag ||
      release.draft !== false ||
      release.prerelease !== false ||
      release.immutable !== true ||
      !Number.isFinite(Date.parse(release.published_at))
    ) {
      fail(`Release ${releaseTag} is not a published immutable Release.`);
    }

    const { archiveName, manifestName, selected } = releaseAssets(release, expectedSourceSha, releaseTag);
    const artifactDirectory = join(ownWorkspace, 'release-assets');
    await mkdir(artifactDirectory, { recursive: true });
    for (const name of [archiveName, manifestName]) {
      const contents = await downloadPublicAsset({ asset: selected.get(name), fetchImpl });
      await writeFile(join(artifactDirectory, name), contents, { flag: 'wx', mode: 0o600 });
    }
    const entries = (await readdir(artifactDirectory)).sort();
    if (JSON.stringify(entries) !== JSON.stringify([archiveName, manifestName].sort())) {
      fail(`Release ${releaseTag} did not provide exactly the checked archive and manifest.`);
    }
    for (const name of entries) {
      const info = await lstat(join(artifactDirectory, name));
      if (!info.isFile() || info.isSymbolicLink()) {
        fail(`Release ${releaseTag} contains an unsupported asset: ${name}`);
      }
    }

    const manifest = await verifyWebBuildArtifact({
      artifactDirectory,
      sourceRevision: expectedSourceSha,
      repository: WEB_REPOSITORY,
    });
    const ciWorkflow = requireWorkflow(
      await getJson({ apiBaseUrl, pathname: 'actions/workflows/ci.yml', token, fetchImpl }),
      { name: 'CI', path: '.github/workflows/ci.yml', fail },
    );
    const ciRun = requireSuccessfulWorkflowRun(
      await getJson({
        apiBaseUrl,
        pathname: `actions/runs/${manifest.ci.runId}/attempts/${manifest.ci.runAttempt}`,
        token,
        fetchImpl,
      }),
      {
        id: manifest.ci.runId,
        attempt: manifest.ci.runAttempt,
        workflow: ciWorkflow,
        event: 'push',
        headBranch: 'main',
        sourceSha: expectedSourceSha,
        repository: WEB_REPOSITORY,
        fail,
      },
    );
    verification.ciRun = { id: ciRun.id, attempt: ciRun.run_attempt };

    const archiveBytes = await readFile(join(artifactDirectory, archiveName));
    const manifestBytes = await readFile(join(artifactDirectory, manifestName));
    const archiveAsset = selected.get(archiveName);
    const manifestAsset = selected.get(manifestName);
    const web = {
      repository: WEB_REPOSITORY,
      sourceSha: expectedSourceSha,
      source: {
        kind: 'release',
        releaseId: release.id,
        tag: releaseTag,
        url: archiveAsset.browser_download_url,
        sourceSha: expectedSourceSha,
        immutable: true,
        archiveAssetId: archiveAsset.id,
        manifestAssetId: manifestAsset.id,
        archiveAssetUrl: archiveAsset.url,
        manifestAssetUrl: manifestAsset.url,
        ciRunId: ciRun.id,
        ciRunAttempt: ciRun.run_attempt,
      },
      manifest: { name: manifestName, sha256: sha256(manifestBytes) },
      archive: { name: archiveName, sha256: sha256(archiveBytes), sizeBytes: archiveBytes.byteLength },
      assetIdentitySha256: manifest.assets.treeSha256,
    };
    return {
      web,
      promotionRun: { id: promotionRun.id, attempt: promotionRun.run_attempt, workflowId: promotionWorkflow.id },
      release: { id: release.id, tag: releaseTag },
      ciRun: { id: ciRun.id, attempt: ciRun.run_attempt },
    };
  } catch (error) {
    const verificationError = error instanceof Error ? error : new Error(String(error));
    verificationError.releaseVerification = verification;
    throw verificationError;
  } finally {
    if (ownsWorkspace) {
      await rm(ownWorkspace, { recursive: true, force: true });
    }
  }
}

async function cli() {
  const [promotionRunId, promotionRunAttempt, expectedSourceSha, releaseTag] = process.argv.slice(2);
  if (!promotionRunId || !promotionRunAttempt || !expectedSourceSha || !releaseTag) {
    throw new Error(
      'Usage: verify-promoted-web-release.mjs <promotion-run-id> <promotion-run-attempt> <source-sha> <release-tag>',
    );
  }
  const verified = await verifyPromotedWebRelease({
    promotionRunId,
    promotionRunAttempt,
    expectedSourceSha,
    releaseTag,
    token: process.env.GITHUB_TOKEN,
    apiBaseUrl: process.env.GITHUB_API_URL ?? DEFAULT_API_BASE_URL,
  });
  process.stdout.write(`${JSON.stringify(verified.web)}\n`);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  cli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
