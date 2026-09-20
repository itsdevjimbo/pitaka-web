import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Branch checks use the common ancestor; push checks compare the previous tip directly. */
export function changedSourceFiles(cwd, base, defaultBranch = 'main', compareDirectly = false) {
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  let reference = 'HEAD';
  if (base) {
    // A new branch push has no previous SHA. Compare it to the default branch.
    const newBranch = /^0+$/.test(base);
    const target = newBranch ? `refs/remotes/origin/${defaultBranch}` : base;
    const commit = git('rev-parse', '--verify', '--end-of-options', `${target}^{commit}`);
    reference = compareDirectly && !newBranch ? commit : git('merge-base', 'HEAD', commit);
  }

  const changed = git('diff', '--name-only', '--diff-filter=ACMR', '-z', reference, '--', 'src');
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z', '--', 'src');
  return [...new Set([...changed.split('\0'), ...untracked.split('\0')])]
    .filter((file) => /^src\/.*\.(ts|html)$/.test(file))
    .sort();
}

function main(args) {
  if (args.length !== 0 && (args.length !== 2 || !['--base', '--since'].includes(args[0]) || !args[1])) {
    throw new Error('Usage: npm run check:changed [-- --base <git-ref> | -- --since <previous-tip>]');
  }
  const files = changedSourceFiles(repoRoot, args[1], process.env.DEFAULT_BRANCH, args[0] === '--since');
  if (files.length === 0) {
    console.log('No changed TypeScript or HTML source files to check.');
    return;
  }
  console.log(`Checking formatting and lint for ${files.length} changed source file(s).`);
  const checks = [
    ['prettier/bin/prettier.cjs', '--check'],
    ['eslint/bin/eslint.js', '--max-warnings', '0'],
  ];
  for (const [binary, ...options] of checks) {
    const result = spawnSync(process.execPath, [resolve(repoRoot, 'node_modules', binary), ...options, ...files], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
