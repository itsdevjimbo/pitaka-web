import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { promoteWebBuildRelease } from './promote-web-build-release.mjs';
import { packageWebBuild } from './web-build-artifact.mjs';

const sourceRevision = 'a'.repeat(40);
const repository = 'test/pitaka-web';
const releaseTag = 'v1.0.0';
const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'pitaka-web-release-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createBuild(root, indexHtml = '<app-root></app-root>') {
  await mkdir(root, { recursive: true });
  const buildDirectory = join(root, 'browser');
  const artifactDirectory = join(root, 'artifact');
  await mkdir(join(buildDirectory, 'assets'), { recursive: true });
  await writeFile(join(buildDirectory, 'index.html'), indexHtml);
  await writeFile(join(buildDirectory, 'assets', 'main.js'), 'window.pitaka = true;');
  const manifest = await packageWebBuild({
    buildDirectory,
    artifactDirectory,
    sourceRevision,
    repository,
    runId: 100,
    runAttempt: 1,
    nodeVersion: 'v24.0.0',
    npmVersion: '11.0.0',
  });
  return { artifactDirectory, manifest };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function successfulCiRun() {
  return {
    id: 100,
    name: 'CI',
    head_sha: sourceRevision,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
  };
}

function createGitHub({ immutable = true, corruptPublicDownload = false } = {}) {
  const releases = [];
  const uploadedAssets = new Map();
  let nextReleaseId = 500;
  let nextAssetId = 800;
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const pathname = url.pathname.replace(`/repos/${repository}`, '');
    if (pathname === '/immutable-releases') {
      return immutable ? jsonResponse({ enabled: true, enforced_by_owner: false }) : jsonResponse({}, 404);
    }
    if (/^\/commits\/v\d+\.\d+\.\d+$/.test(pathname)) {
      return jsonResponse({ sha: sourceRevision });
    }
    if (pathname === '/actions/runs') {
      return jsonResponse({ workflow_runs: [successfulCiRun()] });
    }
    if (pathname === '/releases' && options.method === 'POST') {
      const inputBody = JSON.parse(options.body);
      const id = nextReleaseId++;
      const release = {
        id,
        tag_name: inputBody.tag_name,
        draft: true,
        prerelease: false,
        immutable: false,
        assets: [],
        upload_url: `https://uploads.test/releases/${id}/assets{?name,label}`,
        html_url: `https://github.test/${repository}/releases/tag/${inputBody.tag_name}`,
        created_at: '2026-09-26T10:00:00Z',
      };
      releases.push(release);
      return jsonResponse(release, 201);
    }
    if (pathname === '/releases' && options.method !== 'POST') {
      return jsonResponse(releases);
    }
    const releaseMatch = pathname.match(/^\/releases\/(\d+)$/);
    if (releaseMatch && options.method === 'GET') {
      return jsonResponse(releases.find((release) => release.id === Number(releaseMatch[1])));
    }
    if (releaseMatch && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      const release = releases.find((candidate) => candidate.id === Number(releaseMatch[1]));
      Object.assign(release, body, {
        immutable: immutable,
        published_at: '2026-09-26T10:05:00Z',
      });
      return jsonResponse(release);
    }
    if (url.hostname === 'uploads.test') {
      const releaseId = Number(url.pathname.split('/')[2]);
      const name = url.searchParams.get('name');
      const release = releases.find((candidate) => candidate.id === releaseId);
      const asset = {
        id: nextAssetId++,
        name,
        state: 'uploaded',
        size: Buffer.byteLength(options.body),
        browser_download_url: `https://downloads.test/${releaseId}/${name}`,
      };
      release.assets.push(asset);
      uploadedAssets.set(asset.id, Buffer.from(options.body));
      return jsonResponse(asset, 201);
    }
    const assetMatch = pathname.match(/^\/releases\/assets\/(\d+)$/);
    if (assetMatch) {
      const contents = uploadedAssets.get(Number(assetMatch[1]));
      return contents ? new Response(contents) : new Response('missing', { status: 404 });
    }
    if (url.hostname === 'downloads.test') {
      const releaseId = Number(url.pathname.split('/')[1]);
      const name = url.pathname.split('/').slice(2).join('/');
      const release = releases.find((candidate) => candidate.id === releaseId);
      const asset = release?.assets.find((candidate) => candidate.name === name);
      if (!asset) {
        return new Response('missing', { status: 404 });
      }
      const contents = Buffer.from(uploadedAssets.get(asset.id));
      if (corruptPublicDownload && name.endsWith('.tar.gz')) {
        contents[0] ^= 0xff;
      }
      return new Response(contents);
    }
    return new Response(`Unexpected request: ${options.method ?? 'GET'} ${url}`, { status: 404 });
  };
  return { fetchImpl, releases, uploadedAssets };
}

function makeDownloadBuild(artifactDirectory) {
  return async ({ destinationDirectory }) => {
    await mkdir(destinationDirectory, { recursive: true });
    for (const name of await readdir(artifactDirectory)) {
      await copyFile(join(artifactDirectory, name), join(destinationDirectory, name));
    }
    return { source: 'actions', artifactId: 77 };
  };
}

function promotionOptions({ fetchImpl, artifactDirectory, execFileSyncImpl = () => {}, ...options }) {
  return {
    sourceRevision,
    releaseTag,
    repository,
    token: 'actions-token',
    immutabilityToken: 'admin-read-token',
    apiBaseUrl: 'https://api.test',
    fetchImpl,
    downloadBuild: makeDownloadBuild(artifactDirectory),
    execFileSyncImpl,
    now: () => new Date('2026-09-26T10:00:00Z'),
    ...options,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('publishes a valid version tag as an immutable release with the verified source bytes', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);
  const github = createGitHub();

  const report = await promoteWebBuildRelease(
    promotionOptions({
      fetchImpl: github.fetchImpl,
      artifactDirectory: build.artifactDirectory,
    }),
  );

  assert.equal(report.status, 'published immutable Release; artifact preservation verified');
  assert.equal(report.archiveSha256, build.manifest.archive.sha256);
  assert.equal(github.releases[0].immutable, true);
  assert.equal(github.releases[0].assets.length, 2);
  assert.equal(github.releases[0].body.includes('deployment outcome is recorded separately'), true);
});

test('rejects a non-main commit before making GitHub API requests', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);
  let apiRequests = 0;
  const options = promotionOptions({
    artifactDirectory: build.artifactDirectory,
    fetchImpl: async () => {
      apiRequests += 1;
      return jsonResponse({});
    },
    execFileSyncImpl: () => {
      throw new Error('not an ancestor');
    },
  });

  await assert.rejects(promoteWebBuildRelease(options), /not an ancestor of origin\/main/);
  assert.equal(apiRequests, 0);
});

test('rejects version tags outside the documented vMAJOR.MINOR.PATCH convention', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);

  await assert.rejects(
    promoteWebBuildRelease(
      promotionOptions({
        releaseTag: 'v1.0',
        fetchImpl: async () => jsonResponse({}),
        artifactDirectory: build.artifactDirectory,
      }),
    ),
    /vMAJOR\.MINOR\.PATCH/,
  );
});

test('rejects an expired temporary artifact when no immutable durable copy exists', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);
  const github = createGitHub();
  const options = promotionOptions({
    fetchImpl: github.fetchImpl,
    artifactDirectory: build.artifactDirectory,
    downloadBuild: async () => {
      throw new Error(`The 14-day Actions artifact for ${sourceRevision} has expired.`);
    },
  });

  await assert.rejects(promoteWebBuildRelease(options), /14-day Actions artifact/);
  assert.equal(github.releases.length, 0);
});

test('rejects a corrupted temporary archive before creating a Release', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);
  await writeFile(join(build.artifactDirectory, build.manifest.archive.name), 'corrupt archive bytes');
  const github = createGitHub();

  await assert.rejects(
    promoteWebBuildRelease(
      promotionOptions({ fetchImpl: github.fetchImpl, artifactDirectory: build.artifactDirectory }),
    ),
    /checksum or size does not match/,
  );
  assert.equal(github.releases.length, 0);
});

test('accepts a matching immutable retry and rejects conflicting bytes for the same tag and SHA', async () => {
  const directory = await temporaryDirectory();
  const firstBuild = await createBuild(join(directory, 'first'));
  const github = createGitHub();
  const summaryPath = join(directory, 'promotion-summary.md');
  const initialOptions = promotionOptions({
    fetchImpl: github.fetchImpl,
    artifactDirectory: firstBuild.artifactDirectory,
    summaryPath,
  });
  await promoteWebBuildRelease(initialOptions);

  const matchingRetry = await promoteWebBuildRelease({
    ...initialOptions,
    now: () => new Date('2026-09-27T10:00:00Z'),
  });
  assert.match(matchingRetry.status, /^already published/);
  assert.equal(matchingRetry.selectedAt, '2026-09-27T10:00:00.000Z');
  assert.equal(matchingRetry.releasePublishedAt, '2026-09-26T10:05:00Z');
  assert.equal(github.releases.length, 1);
  assert.match(await readFile(summaryPath, 'utf8'), /Selection or attempt time \(UTC\): 2026-09-27T10:00:00\.000Z/);

  const conflictingBuild = await createBuild(join(directory, 'conflict'), '<app-root>changed</app-root>');
  await assert.rejects(
    promoteWebBuildRelease(
      promotionOptions({
        fetchImpl: github.fetchImpl,
        artifactDirectory: conflictingBuild.artifactDirectory,
      }),
    ),
    /conflicts with the verified build bytes/,
  );
});

test('uses a verified durable release for a later version tag after the Actions artifact expires', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);
  const github = createGitHub();
  await promoteWebBuildRelease(
    promotionOptions({ fetchImpl: github.fetchImpl, artifactDirectory: build.artifactDirectory }),
  );

  const laterPromotion = await promoteWebBuildRelease(
    promotionOptions({
      releaseTag: 'v1.0.1',
      fetchImpl: github.fetchImpl,
      artifactDirectory: build.artifactDirectory,
      downloadBuild: async () => {
        throw new Error(`The 14-day Actions artifact for ${sourceRevision} has expired.`);
      },
    }),
  );

  assert.equal(laterPromotion.source, 'release');
  assert.equal(github.releases.length, 2);
  assert.equal(github.releases[1].tag_name, 'v1.0.1');
});

test('resumes a partial draft from a verified durable build when Actions bytes have expired', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);
  const github = createGitHub();
  await promoteWebBuildRelease(
    promotionOptions({ fetchImpl: github.fetchImpl, artifactDirectory: build.artifactDirectory }),
  );

  const archiveName = build.manifest.archive.name;
  const archiveContents = await readFile(join(build.artifactDirectory, archiveName));
  const draft = {
    id: 499,
    tag_name: 'v1.0.1',
    draft: true,
    prerelease: false,
    immutable: false,
    assets: [
      {
        id: 999,
        name: archiveName,
        state: 'uploaded',
        browser_download_url: `https://downloads.test/499/${archiveName}`,
      },
    ],
    upload_url: 'https://uploads.test/releases/499/assets{?name,label}',
    html_url: `https://github.test/${repository}/releases/tag/v1.0.1`,
    created_at: '2026-09-26T10:10:00Z',
  };
  github.releases.unshift(draft);
  github.uploadedAssets.set(999, archiveContents);

  const resumed = await promoteWebBuildRelease(
    promotionOptions({
      releaseTag: 'v1.0.1',
      fetchImpl: github.fetchImpl,
      artifactDirectory: build.artifactDirectory,
      downloadBuild: async () => {
        throw new Error(`The 14-day Actions artifact for ${sourceRevision} has expired.`);
      },
    }),
  );

  assert.equal(resumed.source, 'release');
  assert.equal(github.releases[0].draft, false);
  assert.equal(github.releases[0].immutable, true);
  assert.equal(github.releases[0].assets.length, 2);
});

test('verifies public retrieval and checksum after publication', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);
  const github = createGitHub({ corruptPublicDownload: true });

  await assert.rejects(
    promoteWebBuildRelease(
      promotionOptions({ fetchImpl: github.fetchImpl, artifactDirectory: build.artifactDirectory }),
    ),
    /checksum or size does not match/,
  );
  assert.equal(github.releases[0].draft, false);
});

test('rejects an exact-SHA build with no successful main CI run', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);
  const github = createGitHub();
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/actions/runs')) {
      return jsonResponse({ workflow_runs: [{ ...successfulCiRun(), conclusion: 'failure' }] });
    }
    return github.fetchImpl(input, options);
  };

  await assert.rejects(
    promoteWebBuildRelease(promotionOptions({ fetchImpl, artifactDirectory: build.artifactDirectory })),
    /No successful main CI run exists for tagged SHA/,
  );
  assert.equal(github.releases.length, 0);
});

test('fails closed when release immutability is not enabled', async () => {
  const directory = await temporaryDirectory();
  const build = await createBuild(directory);
  const github = createGitHub({ immutable: false });

  await assert.rejects(
    promoteWebBuildRelease(
      promotionOptions({ fetchImpl: github.fetchImpl, artifactDirectory: build.artifactDirectory }),
    ),
    /Release immutability is disabled/,
  );
  assert.equal(github.releases.length, 0);
});
