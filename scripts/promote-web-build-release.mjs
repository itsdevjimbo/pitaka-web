import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadWebBuild, listSuccessfulMainRuns } from './download-web-build.mjs';
import { githubApiHeaders, githubApiUrl, nextGitHubApiPage } from './github-api.mjs';
import {
  isMainModule,
  sha256,
  validateRepository,
  validateSourceRevision,
  verifyWebBuildArtifact,
  webBuildArtifactNames,
} from './web-build-artifact.mjs';

const DEFAULT_REPOSITORY = 'itsdevjimbo/pitaka-web';
const VERSION_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function request({
  apiBaseUrl,
  repository,
  pathname,
  token,
  fetchImpl,
  method = 'GET',
  body,
  accept,
  contentType,
}) {
  const response = await fetchImpl(githubApiUrl(apiBaseUrl, repository, pathname), {
    method,
    headers: {
      ...githubApiHeaders(token, accept),
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    ...(body === undefined ? {} : { body }),
  });
  return response;
}

async function readJson(response, label) {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${label} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

async function listReleases({ repository, token, apiBaseUrl, fetchImpl }) {
  const releases = [];
  let url = githubApiUrl(apiBaseUrl, repository, 'releases', '?per_page=100');
  while (url) {
    const response = await fetchImpl(url, { headers: githubApiHeaders(token) });
    const page = await readJson(response, 'Listing GitHub Releases');
    if (!Array.isArray(page)) {
      throw new Error('GitHub returned an invalid Releases list.');
    }
    releases.push(...page);
    url = nextGitHubApiPage(response.headers.get('link'));
  }
  return releases;
}

async function fetchAsset({ asset, token, apiBaseUrl, repository, fetchImpl, publicOnly = false }) {
  const url = publicOnly
    ? asset.browser_download_url
    : githubApiUrl(apiBaseUrl, repository, `releases/assets/${asset.id}`);
  const response = await fetchImpl(url, {
    headers: publicOnly ? {} : githubApiHeaders(token, 'application/octet-stream'),
  });
  if (!response.ok) {
    throw new Error(`Could not download release asset ${asset.name}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function validateVersionTag(releaseTag) {
  if (!VERSION_TAG_PATTERN.test(releaseTag ?? '')) {
    throw new Error(
      `Expected a production version tag in vMAJOR.MINOR.PATCH form, received: ${releaseTag ?? '(empty)'}.`,
    );
  }
}

function assertCommitOnMain(sourceRevision, execFileSyncImpl = execFileSync) {
  try {
    execFileSyncImpl('git', ['merge-base', '--is-ancestor', sourceRevision, 'origin/main'], { stdio: 'ignore' });
  } catch {
    throw new Error(`Tagged commit ${sourceRevision} is not an ancestor of origin/main.`);
  }
}

function unavailableActionsArtifact(error) {
  return /No successful main CI run exists|14-day Actions artifact|no matching web build artifact|No downloadable artifact exists/.test(
    error.message,
  );
}

function assetSet(release, expectedNames, { partial }) {
  const assets = release.assets ?? [];
  if (assets.some((asset) => !expectedNames.includes(asset.name))) {
    throw new Error(`Release ${release.tag_name} contains an unexpected asset; refusing to replace or ignore it.`);
  }
  const selected = new Map();
  for (const name of expectedNames) {
    const matches = assets.filter((asset) => asset.name === name && asset.state === 'uploaded');
    if (matches.length > 1) {
      throw new Error(`Release ${release.tag_name} contains duplicate ${name} assets.`);
    }
    if (!partial && matches.length !== 1) {
      throw new Error(`Release ${release.tag_name} must contain exactly one ${name} asset.`);
    }
    if (matches.length === 1) {
      selected.set(name, matches[0]);
    }
  }
  return selected;
}

function hasCompleteBuildAssets(release, sourceRevision) {
  const names = webBuildArtifactNames(sourceRevision, 1, 1);
  return assetSet(release, [names.archiveName, names.manifestName], { partial: true }).size === 2;
}

async function verifyReleaseAssets({
  release,
  sourceRevision,
  repository,
  token,
  apiBaseUrl,
  fetchImpl,
  workspace,
  publicOnly,
  allowPartial = false,
}) {
  const names = webBuildArtifactNames(sourceRevision, 1, 1);
  const expectedNames = [names.archiveName, names.manifestName];
  const selected = assetSet(release, expectedNames, { partial: allowPartial });
  const directory = await mkdtemp(join(workspace, `release-${release.id}-`));
  for (const [name, asset] of selected) {
    const contents = await fetchAsset({ asset, token, apiBaseUrl, repository, fetchImpl, publicOnly });
    await writeFile(join(directory, name), contents, { flag: 'wx' });
  }
  if (allowPartial && selected.size !== expectedNames.length) {
    return { directory, manifest: undefined, files: selected };
  }
  const manifest = await verifyWebBuildArtifact({ artifactDirectory: directory, sourceRevision, repository });
  return { directory, manifest, files: selected };
}

function requireSuccessfulCiManifest(manifest, ciRuns, sourceRevision) {
  const matchingRun = ciRuns.find(
    (run) => Number(run.id) === manifest.ci.runId && Number(run.run_attempt) === manifest.ci.runAttempt,
  );
  if (!matchingRun) {
    throw new Error(`The web artifact does not identify a successful main CI attempt for ${sourceRevision}.`);
  }
  return matchingRun;
}

async function resolveTagCommit({ releaseTag, repository, token, apiBaseUrl, fetchImpl }) {
  const response = await request({
    apiBaseUrl,
    repository,
    pathname: `commits/${encodeURIComponent(releaseTag)}`,
    token,
    fetchImpl,
  });
  const commit = await readJson(response, `Resolving version tag ${releaseTag}`);
  return commit.sha;
}

async function checkImmutableReleases({ repository, token, apiBaseUrl, fetchImpl }) {
  const response = await request({
    apiBaseUrl,
    repository,
    pathname: 'immutable-releases',
    token,
    fetchImpl,
  });
  if (response.status === 404) {
    throw new Error(
      'GitHub Release immutability is disabled; enable it in repository settings before promoting a version tag.',
    );
  }
  const result = await readJson(response, 'Checking GitHub Release immutability');
  if (result.enabled !== true) {
    throw new Error(
      'GitHub Release immutability is disabled; enable it in repository settings before promoting a version tag.',
    );
  }
}

async function listDurableBuilds({ releases, sourceRevision, repository, token, apiBaseUrl, fetchImpl, workspace }) {
  const names = webBuildArtifactNames(sourceRevision, 1, 1);
  const expectedNames = [names.archiveName, names.manifestName];
  const candidates = [];
  for (const release of releases) {
    if (release.draft || release.prerelease || release.immutable !== true) {
      continue;
    }
    if (!expectedNames.every((name) => (release.assets ?? []).some((asset) => asset.name === name))) {
      continue;
    }
    const releaseCommit = await resolveTagCommit({
      releaseTag: release.tag_name,
      repository,
      token,
      apiBaseUrl,
      fetchImpl,
    });
    if (releaseCommit !== sourceRevision) {
      continue;
    }
    const verified = await verifyReleaseAssets({
      release,
      sourceRevision,
      repository,
      token,
      apiBaseUrl,
      fetchImpl,
      workspace,
      publicOnly: true,
    });
    candidates.push({ release, ...verified });
  }
  return candidates;
}

async function compareBuildDirectories(leftDirectory, rightDirectory, sourceRevision) {
  const names = webBuildArtifactNames(sourceRevision, 1, 1);
  for (const name of [names.archiveName, names.manifestName]) {
    const [left, right] = await Promise.all([
      readFile(join(leftDirectory, name)),
      readFile(join(rightDirectory, name)),
    ]);
    if (!left.equals(right)) {
      throw new Error(
        `The preserved web artifact ${name} conflicts with the verified build bytes for ${sourceRevision}.`,
      );
    }
  }
}

async function copyBuildArtifactFiles(sourceDirectory, destinationDirectory, sourceRevision) {
  const names = webBuildArtifactNames(sourceRevision, 1, 1);
  await copyFile(join(sourceDirectory, names.archiveName), join(destinationDirectory, names.archiveName));
  await copyFile(join(sourceDirectory, names.manifestName), join(destinationDirectory, names.manifestName));
}

async function createOrResumeDraft({
  releaseTag,
  sourceRevision,
  manifest,
  archiveContents,
  manifestContents,
  release,
  repository,
  token,
  immutabilityToken,
  apiBaseUrl,
  fetchImpl,
  workspace,
  now,
}) {
  let draft = release;
  if (draft && (!draft.draft || draft.prerelease)) {
    throw new Error(`Release ${releaseTag} is already published in a conflicting state.`);
  }
  if (!draft) {
    const created = await request({
      apiBaseUrl,
      repository,
      pathname: 'releases',
      token,
      fetchImpl,
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        tag_name: releaseTag,
        target_commitish: sourceRevision,
        name: `Pitaka Web ${releaseTag}`,
        body: `Production selection verification in progress for source SHA ${sourceRevision}.`,
        draft: true,
        prerelease: false,
      }),
    });
    draft = await readJson(created, `Creating draft Release ${releaseTag}`);
  }

  if (draft.tag_name !== releaseTag) {
    throw new Error(`GitHub returned draft Release ${draft.tag_name} while ${releaseTag} was requested.`);
  }
  const names = webBuildArtifactNames(sourceRevision, 1, 1);
  const existing = await verifyReleaseAssets({
    release: draft,
    sourceRevision,
    repository,
    token,
    apiBaseUrl,
    fetchImpl,
    workspace,
    publicOnly: false,
    allowPartial: true,
  });
  for (const name of existing.files.keys()) {
    const localContents = name === names.archiveName ? archiveContents : manifestContents;
    const remoteContents = await readFile(join(existing.directory, name));
    if (!localContents.equals(remoteContents)) {
      throw new Error(`Draft Release ${releaseTag} already has a conflicting ${name} asset.`);
    }
  }

  const uploadUrl = draft.upload_url?.replace(/\{\?name,label\}$/, '');
  if (!uploadUrl) {
    throw new Error(`Draft Release ${releaseTag} has no asset upload URL.`);
  }
  for (const [name, contents, contentType] of [
    [names.archiveName, archiveContents, 'application/gzip'],
    [names.manifestName, manifestContents, 'application/json'],
  ]) {
    if (existing.files.has(name)) {
      continue;
    }
    const separator = uploadUrl.includes('?') ? '&' : '?';
    const response = await fetchImpl(`${uploadUrl}${separator}name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        ...githubApiHeaders(token, 'application/vnd.github+json'),
        'Content-Type': contentType,
      },
      body: contents,
    });
    await readJson(response, `Uploading ${name} to draft Release ${releaseTag}`);
  }

  const refreshedResponse = await request({
    apiBaseUrl,
    repository,
    pathname: `releases/${draft.id}`,
    token,
    fetchImpl,
  });
  draft = await readJson(refreshedResponse, `Reading draft Release ${releaseTag}`);
  const verifiedDraft = await verifyReleaseAssets({
    release: draft,
    sourceRevision,
    repository,
    token,
    apiBaseUrl,
    fetchImpl,
    workspace,
    publicOnly: false,
  });
  await compareBuildDirectories(verifiedDraft.directory, join(workspace, 'selected-build'), sourceRevision);

  const archiveHash = sha256(archiveContents);
  const manifestHash = sha256(manifestContents);
  const selectedAt = now().toISOString();
  const body = [
    'Production version selection; deployment outcome is recorded separately by the deployment owner.',
    '',
    `Selected at (UTC): ${selectedAt}`,
    `Source repository: ${repository}`,
    `Source SHA: ${sourceRevision}`,
    `Production version tag: ${releaseTag}`,
    `Actions CI run: ${manifest.ci.runId}, attempt ${manifest.ci.runAttempt}`,
    `Actions artifact identity: ${manifest.actionsArtifact.name}`,
    `Archive: ${manifest.archive.name} (${manifest.archive.sizeBytes} bytes, SHA-256 ${archiveHash})`,
    `Manifest: ${names.manifestName} (SHA-256 ${manifestHash})`,
  ].join('\n');
  await checkImmutableReleases({
    repository,
    token: immutabilityToken,
    apiBaseUrl,
    fetchImpl,
  });
  const currentTagCommit = await resolveTagCommit({ releaseTag, repository, token, apiBaseUrl, fetchImpl });
  if (currentTagCommit !== sourceRevision) {
    throw new Error(`Version tag ${releaseTag} moved to ${currentTagCommit} before publication.`);
  }
  const publishResponse = await request({
    apiBaseUrl,
    repository,
    pathname: `releases/${draft.id}`,
    token,
    fetchImpl,
    method: 'PATCH',
    contentType: 'application/json',
    body: JSON.stringify({ draft: false, prerelease: false, body }),
  });
  const published = await readJson(publishResponse, `Publishing immutable Release ${releaseTag}`);
  if (published.draft || published.immutable !== true) {
    throw new Error(`Release ${releaseTag} was published without GitHub confirming immutability.`);
  }

  const publicAssets = await verifyReleaseAssets({
    release: published,
    sourceRevision,
    repository,
    token,
    apiBaseUrl,
    fetchImpl,
    workspace,
    publicOnly: true,
  });
  await compareBuildDirectories(publicAssets.directory, join(workspace, 'selected-build'), sourceRevision);
  return { release: published, selectedAt, archiveHash, manifestHash };
}

async function writeSummary(summaryPath, report) {
  if (!summaryPath) {
    return;
  }
  const lines = [
    `## Production version promotion: ${report.tag}`,
    '',
    `- Selection or attempt time (UTC): ${report.selectedAt ?? report.startedAt}`,
    `- Source SHA: \`${report.sourceRevision}\``,
    `- Status: ${report.status}`,
  ];
  if (report.artifactName) {
    lines.push(`- Actions artifact: \`${report.artifactName}\``);
  }
  if (report.ciRunId) {
    lines.push(`- Successful main CI run: ${report.ciRunId}, attempt ${report.ciRunAttempt}`);
  }
  if (report.artifactId) {
    lines.push(`- Actions artifact ID: ${report.artifactId}`);
  }
  if (report.archiveSha256) {
    lines.push(`- Archive SHA-256: \`${report.archiveSha256}\``);
  }
  if (report.releaseUrl) {
    lines.push(`- Public Release: ${report.releaseUrl}`);
  }
  if (report.releasePublishedAt) {
    lines.push(`- Release first published at (UTC): ${report.releasePublishedAt}`);
  }
  if (report.message) {
    lines.push(`- Details: ${report.message}`);
  }
  lines.push(
    '',
    'This record confirms artifact preservation and production selection; it does not report deployment success.',
    '',
  );
  await writeFile(summaryPath, `${lines.join('\n')}\n`, { flag: 'a' });
}

export async function promoteWebBuildRelease({
  sourceRevision,
  releaseTag,
  repository = DEFAULT_REPOSITORY,
  token,
  immutabilityToken,
  apiBaseUrl = 'https://api.github.com',
  fetchImpl = fetch,
  downloadBuild = downloadWebBuild,
  execFileSyncImpl = execFileSync,
  now = () => new Date(),
  summaryPath,
}) {
  const startedAt = now().toISOString();
  const report = { tag: releaseTag, sourceRevision, startedAt, status: 'failed' };
  const workspace = await mkdtemp(join(tmpdir(), 'pitaka-web-promotion-'));
  try {
    validateVersionTag(releaseTag);
    validateSourceRevision(sourceRevision);
    validateRepository(repository);
    if (!token || !immutabilityToken) {
      throw new Error(
        'Set GITHUB_TOKEN with Actions: read and Contents: write, plus RELEASE_IMMUTABILITY_TOKEN with Administration: read.',
      );
    }
    assertCommitOnMain(sourceRevision, execFileSyncImpl);
    await checkImmutableReleases({ repository, token: immutabilityToken, apiBaseUrl, fetchImpl });

    const taggedCommit = await resolveTagCommit({ releaseTag, repository, token, apiBaseUrl, fetchImpl });
    if (taggedCommit !== sourceRevision) {
      throw new Error(`Version tag ${releaseTag} resolves to ${taggedCommit}, not event source SHA ${sourceRevision}.`);
    }
    const ciRuns = await listSuccessfulMainRuns({ sourceRevision, repository, token, apiBaseUrl, fetchImpl });
    if (ciRuns.length === 0) {
      throw new Error(
        `No successful main CI run exists for tagged SHA ${sourceRevision}; refusing production promotion.`,
      );
    }

    const releases = await listReleases({ repository, token, apiBaseUrl, fetchImpl });
    const matchingTarget = releases.filter((release) => release.tag_name === releaseTag);
    if (matchingTarget.length > 1) {
      throw new Error(`GitHub returned duplicate Releases for ${releaseTag}.`);
    }
    const targetRelease = matchingTarget[0];
    const durableBuilds = await listDurableBuilds({
      releases,
      sourceRevision,
      repository,
      token,
      apiBaseUrl,
      fetchImpl,
      workspace,
    });
    const durableDirectories = new Set();
    for (const candidate of durableBuilds) {
      requireSuccessfulCiManifest(candidate.manifest, ciRuns, sourceRevision);
      if (durableDirectories.size > 0) {
        await compareBuildDirectories([...durableDirectories][0], candidate.directory, sourceRevision);
      }
      durableDirectories.add(candidate.directory);
    }

    if (targetRelease && !targetRelease.draft && (targetRelease.prerelease || targetRelease.immutable !== true)) {
      throw new Error(`Existing Release ${releaseTag} is not a stable immutable release.`);
    }
    if (targetRelease) {
      const targetCommit = await resolveTagCommit({ releaseTag, repository, token, apiBaseUrl, fetchImpl });
      if (targetCommit !== sourceRevision) {
        throw new Error(`Existing Release ${releaseTag} does not select source SHA ${sourceRevision}.`);
      }
    }

    const selectedDirectory = join(workspace, 'selected-build');
    await mkdir(selectedDirectory);
    let downloaded;
    try {
      downloaded = await downloadBuild({
        sourceRevision,
        destinationDirectory: selectedDirectory,
        repository,
        token,
        apiBaseUrl,
        fetchImpl,
      });
    } catch (error) {
      if (!unavailableActionsArtifact(error)) {
        throw error;
      }
      if (targetRelease?.draft && hasCompleteBuildAssets(targetRelease, sourceRevision)) {
        const draftBuild = await verifyReleaseAssets({
          release: targetRelease,
          sourceRevision,
          repository,
          token,
          apiBaseUrl,
          fetchImpl,
          workspace,
          publicOnly: false,
        });
        requireSuccessfulCiManifest(draftBuild.manifest, ciRuns, sourceRevision);
        await copyBuildArtifactFiles(draftBuild.directory, selectedDirectory, sourceRevision);
        downloaded = { source: 'draft-release', archiveSha256: draftBuild.manifest.archive.sha256 };
      } else if (durableBuilds.length > 0) {
        const durable = durableBuilds[0];
        await copyBuildArtifactFiles(durable.directory, selectedDirectory, sourceRevision);
        downloaded = {
          source: 'release',
          releaseTag: durable.release.tag_name,
          archiveSha256: durable.manifest.archive.sha256,
        };
      } else if (targetRelease?.draft) {
        await verifyReleaseAssets({
          release: targetRelease,
          sourceRevision,
          repository,
          token,
          apiBaseUrl,
          fetchImpl,
          workspace,
          publicOnly: false,
        });
        throw error;
      } else {
        throw error;
      }
    }

    const manifest = await verifyWebBuildArtifact({ artifactDirectory: selectedDirectory, sourceRevision, repository });
    requireSuccessfulCiManifest(manifest, ciRuns, sourceRevision);
    report.artifactName = manifest.actionsArtifact.name;
    report.archiveSha256 = manifest.archive.sha256;
    report.ciRunId = manifest.ci.runId;
    report.ciRunAttempt = manifest.ci.runAttempt;
    report.artifactId = downloaded.artifactId;
    report.source = downloaded.source;

    const names = webBuildArtifactNames(sourceRevision, 1, 1);
    const archiveContents = await readFile(join(selectedDirectory, names.archiveName));
    const manifestContents = await readFile(join(selectedDirectory, names.manifestName));
    const manifestDirectory = await readdir(selectedDirectory);
    if (manifestDirectory.length !== 2) {
      throw new Error('The selected production artifact directory must contain exactly the archive and manifest.');
    }

    if (!targetRelease && durableBuilds.length > 0) {
      await compareBuildDirectories(selectedDirectory, durableBuilds[0].directory, sourceRevision);
    }
    if (targetRelease && !targetRelease.draft) {
      const published = await verifyReleaseAssets({
        release: targetRelease,
        sourceRevision,
        repository,
        token,
        apiBaseUrl,
        fetchImpl,
        workspace,
        publicOnly: true,
      });
      requireSuccessfulCiManifest(published.manifest, ciRuns, sourceRevision);
      await compareBuildDirectories(selectedDirectory, published.directory, sourceRevision);
      report.status = 'already published; verified matching immutable Release';
      report.releaseUrl = targetRelease.html_url;
      report.selectedAt = startedAt;
      report.releasePublishedAt = targetRelease.published_at ?? targetRelease.created_at;
    } else {
      const published = await createOrResumeDraft({
        releaseTag,
        sourceRevision,
        manifest,
        archiveContents,
        manifestContents,
        release: targetRelease,
        repository,
        token,
        immutabilityToken,
        apiBaseUrl,
        fetchImpl,
        workspace,
        now,
      });
      report.status = 'published immutable Release; artifact preservation verified';
      report.releaseUrl = published.release.html_url;
      report.selectedAt = published.selectedAt;
    }
    await writeSummary(summaryPath, report);
    return report;
  } catch (error) {
    report.message = error.message;
    await writeSummary(summaryPath, report).catch(() => {});
    throw error;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function cli() {
  const [sourceRevision, releaseTag] = process.argv.slice(2);
  if (!sourceRevision || !releaseTag) {
    throw new Error('Usage: promote-web-build-release.mjs <full-source-sha> <vMAJOR.MINOR.PATCH-tag>');
  }
  const token = process.env.GITHUB_TOKEN;
  const immutabilityToken = process.env.RELEASE_IMMUTABILITY_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required with Actions: read and Contents: write.');
  }
  if (!immutabilityToken) {
    throw new Error('RELEASE_IMMUTABILITY_TOKEN is required with repository Administration: read.');
  }
  const report = await promoteWebBuildRelease({
    sourceRevision,
    releaseTag,
    repository: process.env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY,
    token,
    immutabilityToken,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  cli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
