import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function validateSourceRevision(sourceRevision) {
  if (!SHA_PATTERN.test(sourceRevision)) {
    throw new Error(`Expected a full 40-character source SHA, received: ${sourceRevision}`);
  }
}

export function webBuildArtifactNames(sourceRevision, runId, runAttempt) {
  validateSourceRevision(sourceRevision);

  if (
    !/^\d+$/.test(String(runId)) ||
    !/^\d+$/.test(String(runAttempt)) ||
    Number(runId) < 1 ||
    Number(runAttempt) < 1
  ) {
    throw new Error('The CI run ID and attempt must be positive integers.');
  }

  const archiveName = `pitaka-web-${sourceRevision}.tar.gz`;
  return {
    archiveName,
    manifestName: `pitaka-web-${sourceRevision}.manifest.json`,
    artifactName: `pitaka-web-${sourceRevision}-run-${runId}-attempt-${runAttempt}`,
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function collectAssets(rootDirectory) {
  const assets = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(rootDirectory, absolutePath).split(sep).join('/');
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const contents = await readFile(absolutePath);
        assets.push({ path: relativePath, sha256: sha256(contents), sizeBytes: contents.byteLength });
      } else {
        throw new Error(`The production build contains an unsupported asset: ${relativePath}`);
      }
    }
  }

  await visit(rootDirectory);
  assets.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return assets;
}

function assetIdentity(assets) {
  const serializedAssets = JSON.stringify(assets);
  return {
    fileCount: assets.length,
    treeSha256: sha256(serializedAssets),
    files: assets,
  };
}

function writeOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0');
  if (encoded.length >= length) {
    throw new Error(`A static asset is too large for the archive format: ${value} bytes.`);
  }
  header.write(`${encoded}\0`, offset, length, 'ascii');
}

function splitUstarPath(path) {
  if (Buffer.byteLength(path) <= 100) {
    return { name: path, prefix: '' };
  }

  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return { name, prefix };
    }
  }
  return undefined;
}

function createTarHeader({ name, prefix = '', size, type = '0' }) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, type === 'x' ? 0o644 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write('root', 265, 4, 'ascii');
  header.write('root', 297, 4, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function paxPathRecord(path) {
  const value = `path=${path}\n`;
  let length = Buffer.byteLength(value) + 2;
  while (true) {
    const record = `${length} ${value}`;
    const actualLength = Buffer.byteLength(record);
    if (actualLength === length) {
      return Buffer.from(record);
    }
    length = actualLength;
  }
}

async function createDeterministicArchive(browserDirectory, assets) {
  // Normalized archive headers keep timestamps, owners, and runner IDs out of the published bytes.
  const chunks = [];
  let paxIndex = 0;
  for (const asset of assets) {
    const contents = await readFile(join(browserDirectory, ...asset.path.split('/')));
    let archivePath = splitUstarPath(asset.path);
    if (!archivePath) {
      paxIndex += 1;
      const extension = paxPathRecord(asset.path);
      chunks.push(createTarHeader({ name: `PaxHeaders/${paxIndex}`, size: extension.byteLength, type: 'x' }));
      chunks.push(extension);
      if (extension.byteLength % 512 !== 0) {
        chunks.push(Buffer.alloc(512 - (extension.byteLength % 512)));
      }
      archivePath = { name: `PaxPayload/${paxIndex}`, prefix: '' };
    }

    chunks.push(createTarHeader({ ...archivePath, size: contents.byteLength }));
    chunks.push(contents);
    if (contents.byteLength % 512 !== 0) {
      chunks.push(Buffer.alloc(512 - (contents.byteLength % 512)));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
}

export async function packageWebBuild({
  buildDirectory,
  artifactDirectory,
  sourceRevision,
  repository,
  runId,
  runAttempt,
  nodeVersion = process.version,
  npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
}) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`Expected an owner/repository name, received: ${repository}`);
  }

  const names = webBuildArtifactNames(sourceRevision, runId, runAttempt);
  const browserDirectory = resolve(buildDirectory);
  const outputDirectory = resolve(artifactDirectory);
  const indexStats = await stat(join(browserDirectory, 'index.html')).catch(() => undefined);
  if (!indexStats?.isFile()) {
    throw new Error(`The production browser build has no root index.html: ${browserDirectory}`);
  }

  const assets = await collectAssets(browserDirectory);
  if (assets.length === 0) {
    throw new Error('The production browser build contains no files.');
  }

  await mkdir(outputDirectory, { recursive: true });
  const archivePath = join(outputDirectory, names.archiveName);
  const manifestPath = join(outputDirectory, names.manifestName);
  for (const existingPath of [archivePath, manifestPath]) {
    if (await stat(existingPath).catch(() => undefined)) {
      throw new Error(`Refusing to overwrite an existing web build artifact: ${existingPath}`);
    }
  }

  await writeFile(archivePath, await createDeterministicArchive(browserDirectory, assets), { flag: 'wx' });

  const archiveContents = await readFile(archivePath);
  const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const packageLock = await readFile(new URL('../package-lock.json', import.meta.url));
  const runNumber = Number(runId);
  const attemptNumber = Number(runAttempt);
  const manifest = {
    schemaVersion: 1,
    source: { repository, sha: sourceRevision },
    ci: {
      workflow: 'CI',
      runId: runNumber,
      runAttempt: attemptNumber,
      url: `https://github.com/${repository}/actions/runs/${runNumber}`,
    },
    build: {
      command: 'npm run build -- --configuration production',
      configuration: 'production',
      nodeVersion,
      npmVersion,
      angularCliVersion: packageManifest.devDependencies['@angular/cli'],
      angularBuildVersion: packageManifest.devDependencies['@angular/build'],
      packageLockSha256: sha256(packageLock),
    },
    assets: assetIdentity(assets),
    archive: {
      name: names.archiveName,
      sha256: sha256(archiveContents),
      sizeBytes: archiveContents.byteLength,
    },
    actionsArtifact: { name: names.artifactName, retentionDays: 14 },
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

function normalizeArchiveMember(member) {
  const normalized = member.replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized === '' || normalized === '.') {
    return '';
  }

  if (normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`The web build archive contains an unsafe path: ${member}`);
  }

  return normalized;
}

export async function verifyWebBuildArtifact({ artifactDirectory, sourceRevision, repository, runId, runAttempt }) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`Expected an owner/repository name, received: ${repository}`);
  }

  const rootDirectory = resolve(artifactDirectory);
  const expectedNames = webBuildArtifactNames(sourceRevision, runId ?? 1, runAttempt ?? 1);
  const manifestPath = join(rootDirectory, `pitaka-web-${sourceRevision}.manifest.json`);
  const archivePath = join(rootDirectory, expectedNames.archiveName);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported web build manifest schema: ${manifest.schemaVersion}`);
  }
  if (manifest.source?.sha !== sourceRevision || manifest.source?.repository !== repository) {
    throw new Error('The web build manifest does not match the requested repository and source SHA.');
  }
  if (
    manifest.ci?.workflow !== 'CI' ||
    !Number.isInteger(manifest.ci.runId) ||
    !Number.isInteger(manifest.ci.runAttempt)
  ) {
    throw new Error('The web build manifest is missing valid CI run identity.');
  }
  if (runId !== undefined && manifest.ci.runId !== Number(runId)) {
    throw new Error(`The web build came from CI run ${manifest.ci.runId}, expected ${runId}.`);
  }
  if (runAttempt !== undefined && manifest.ci.runAttempt !== Number(runAttempt)) {
    throw new Error(`The web build came from CI attempt ${manifest.ci.runAttempt}, expected ${runAttempt}.`);
  }
  if (
    manifest.build?.configuration !== 'production' ||
    manifest.build?.command !== 'npm run build -- --configuration production'
  ) {
    throw new Error('The web build manifest does not describe the required production build.');
  }
  if (
    !manifest.build.nodeVersion ||
    !manifest.build.npmVersion ||
    !manifest.build.angularCliVersion ||
    !manifest.build.angularBuildVersion ||
    !/^[a-f0-9]{64}$/.test(manifest.build.packageLockSha256)
  ) {
    throw new Error('The web build manifest is missing its toolchain or lockfile identity.');
  }

  const names = webBuildArtifactNames(sourceRevision, manifest.ci.runId, manifest.ci.runAttempt);
  if (manifest.archive?.name !== names.archiveName || manifest.actionsArtifact?.name !== names.artifactName) {
    throw new Error('The web build manifest has inconsistent archive or Actions artifact names.');
  }
  if (manifest.actionsArtifact.retentionDays !== 14) {
    throw new Error('The web build Actions artifact does not have the required 14-day retention.');
  }

  const archiveContents = await readFile(archivePath);
  if (
    archiveContents.byteLength !== manifest.archive.sizeBytes ||
    sha256(archiveContents) !== manifest.archive.sha256
  ) {
    throw new Error(`The web build archive checksum or size does not match its manifest: ${archivePath}`);
  }

  const listing = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
  const members = listing.split('\n').filter(Boolean).map(normalizeArchiveMember);
  if (!members.includes('index.html')) {
    throw new Error('The web build archive must contain index.html at its extracted root.');
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pitaka-web-build-verify-'));
  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', temporaryDirectory], { stdio: 'pipe' });
    const extractedAssets = await collectAssets(temporaryDirectory);
    const expectedAssets = manifest.assets?.files;
    if (!Array.isArray(expectedAssets) || JSON.stringify(extractedAssets) !== JSON.stringify(expectedAssets)) {
      throw new Error('The extracted web assets do not match the manifest asset identity.');
    }
    if (
      assetIdentity(extractedAssets).treeSha256 !== manifest.assets.treeSha256 ||
      extractedAssets.length !== manifest.assets.fileCount
    ) {
      throw new Error('The extracted web asset identity does not match the manifest.');
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return manifest;
}

export function isMainModule(metaUrl, argvPath = process.argv[1]) {
  return argvPath !== undefined && pathToFileURL(resolve(argvPath)).href === metaUrl;
}
