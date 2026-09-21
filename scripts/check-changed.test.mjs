import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { changedSourceFiles } from './check-changed.mjs';

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'pitaka-standards-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (file, content = 'export {};\n') => writeFileSync(join(cwd, file), content);
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Standards Test',
      '-c',
      'user.email=standards@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  mkdirSync(join(cwd, 'src'));
  write('src/existing.ts');
  write('src/deleted.ts');
  write('src/renamed.ts');
  commit();
  return { cwd, git, write, commit };
}

test('selects staged, unstaged and untracked source files; excludes deletions and other files', (t) => {
  const { cwd, git, write } = repository(t);
  write('src/existing.ts', 'export const changed = true;\n');
  git('add', 'src/existing.ts');
  write('src/staged.html', '<p>Staged</p>\n');
  git('add', 'src/staged.html');
  write('src/staged.html', '<p>Unstaged edit too</p>\n');
  write('src/new file [1].ts');
  write('src/ignored.ts');
  write('.gitignore', 'src/ignored.ts\n');
  write('src/style.css', 'p {}\n');
  write('README.md', '# Readme\n');
  rmSync(join(cwd, 'src/deleted.ts'));
  renameSync(join(cwd, 'src/renamed.ts'), join(cwd, 'src/renamed destination.ts'));
  git('add', 'src/renamed.ts', 'src/renamed destination.ts');

  assert.deepEqual(changedSourceFiles(cwd), [
    'src/existing.ts',
    'src/new file [1].ts',
    'src/renamed destination.ts',
    'src/staged.html',
  ]);
});

test('uses the merge base and includes committed branch changes, not unrelated base changes', (t) => {
  const { cwd, git, write, commit } = repository(t);
  git('switch', '-qc', 'feature');
  write('src/feature.ts');
  commit();
  git('switch', '-q', 'main');
  write('src/base-only.ts');
  commit();
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('switch', '-q', 'feature');
  assert.deepEqual(changedSourceFiles(cwd, 'main'), ['src/feature.ts']);
  assert.deepEqual(changedSourceFiles(cwd, '0'.repeat(40)), ['src/feature.ts']);
});

test('returns no source changes for a clean tree and rejects an invalid base', (t) => {
  const { cwd } = repository(t);
  assert.deepEqual(changedSourceFiles(cwd), []);
  assert.throws(() => changedSourceFiles(cwd, 'not-a-real-ref'));
});

test('push comparisons catch reverted files when the new tip is an ancestor of the old tip', (t) => {
  const { cwd, git, write, commit } = repository(t);
  const baseline = git('rev-parse', 'HEAD');
  write('src/existing.ts', 'export const changed = true;\n');
  const previousTip = commit();
  git('switch', '-q', '--detach', baseline);
  assert.deepEqual(changedSourceFiles(cwd, previousTip, 'main', true), ['src/existing.ts']);
});

test('rejects fixture internals casts, permits DOM casts and accepts a documented line exception', async () => {
  const eslint = new ESLint({
    overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
  });
  const options = { filePath: resolve('src/app/app.spec.ts') };
  const lint = async (source) =>
    (await eslint.lintText(source, options))[0].messages.filter((message) => message.ruleId === 'no-restricted-syntax');
  const cast = 'const cmp = fixture.componentInstance as unknown as Internals;';
  const messages = await lint(cast);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].severity, 2);
  assert.deepEqual(await lint('const element = fixture.nativeElement as HTMLElement;'), []);
  assert.deepEqual(
    await lint(
      `// eslint-disable-next-line no-restricted-syntax -- Isolated regression needs this internal seam.\n${cast}`,
    ),
    [],
  );
});

test('requires control-flow braces in production and tests, including single-line bodies', async () => {
  const eslint = new ESLint({
    overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
  });
  const source = `
    if (ready) run(); else if (waiting) wait(); else stop();
    for (let i = 0; i < 2; i++) run();
    for (const value of values) run(value);
    for (const key in values) run(key);
    while (ready) run();
    do run(); while (ready);
  `;
  const braced = `
    if (ready) { run(); } else if (waiting) { wait(); } else { stop(); }
    for (let i = 0; i < 2; i++) { run(); }
    for (const value of values) { run(value); }
    for (const key in values) { run(key); }
    while (ready) { run(); }
    do { run(); } while (ready);
  `;
  for (const file of ['src/app/app.ts', 'src/app/app.spec.ts']) {
    const options = { filePath: resolve(file) };
    const messages = (await eslint.lintText(source, options))[0].messages.filter(
      (message) => message.ruleId === 'curly',
    );
    assert.equal(messages.length, 8, file);
    assert.ok(
      messages.every((message) => message.severity === 2),
      file,
    );
    assert.deepEqual(
      (await eslint.lintText(braced, options))[0].messages.filter((message) => message.ruleId === 'curly'),
      [],
      file,
    );
  }
});
