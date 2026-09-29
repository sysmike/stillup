import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/sync-upstream.sh', import.meta.url));

const identity = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@e',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@e',
};
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env: { ...process.env, ...identity }, encoding: 'utf8' });

function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    if (content === null) {
      rmSync(full);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

const read = (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);

// An upstream and a deployment copied from it, each then going its own way.
function setup({ upstream, deployment, later }) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-test-'));
  const up = join(dir, 'upstream');
  mkdirSync(up);
  git(up, 'init', '-q', '-b', 'main');
  write(up, upstream);
  git(up, 'add', '-A');
  git(up, 'commit', '-qm', 'upstream v1');

  const deploy = join(dir, 'deploy');
  git(dir, 'clone', '-q', up, deploy);
  if (deployment) {
    write(deploy, deployment);
    git(deploy, 'add', '-A');
    git(deploy, 'commit', '-qm', 'deployment diverges');
  }

  if (later) {
    write(up, later);
    git(up, 'add', '-A');
    git(up, 'commit', '-qm', 'upstream v2');
  }
  return { dir, up, deploy };
}

function sync(deploy, up, keep) {
  const outputs = join(deploy, '..', 'outputs');
  writeFileSync(outputs, '');
  const env = { ...process.env, SYNC_UPSTREAM: 'acme/status-page', SYNC_SOURCE: up, GITHUB_OUTPUT: outputs };
  delete env.SYNC_KEEP;
  if (keep !== undefined) env.SYNC_KEEP = keep;
  execFileSync('bash', [SCRIPT], { cwd: deploy, env, encoding: 'utf8' });
  return Object.fromEntries(
    readFileSync(outputs, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
}

const staged = (deploy) => git(deploy, 'diff', '--cached', '--name-status', 'HEAD').trim().split('\n').filter(Boolean);

test('upstream edits, additions and deletions all arrive', () => {
  const { dir, up, deploy } = setup({
    upstream: { 'scripts/check.mjs': 'v1', 'test/old.test.mjs': 'old' },
    later: { 'scripts/check.mjs': 'v2', 'scripts/feed.mjs': 'new', 'test/old.test.mjs': null },
  });
  const out = sync(deploy, up);

  assert.equal(out.changed, 'true');
  assert.equal(read(deploy, 'scripts/check.mjs'), 'v2');
  assert.equal(read(deploy, 'scripts/feed.mjs'), 'new');
  // Gone from the index and from the working tree: a deleted test left on disk
  // would still be run before the commit.
  assert.equal(read(deploy, 'test/old.test.mjs'), null);
  assert.deepEqual(staged(deploy).sort(), ['A\tscripts/feed.mjs', 'D\ttest/old.test.mjs', 'M\tscripts/check.mjs']);
  rmSync(dir, { recursive: true, force: true });
});

test('the history stays the deployment’s own, whatever upstream has in it', () => {
  const { dir, up, deploy } = setup({
    upstream: { 'scripts/check.mjs': 'v1', 'history/daily/web.csv': 'upstream data' },
    deployment: { 'history/daily/web.csv': 'deployment data', 'history/daily/db.csv': 'deployment only' },
    later: { 'scripts/check.mjs': 'v2', 'history/daily/web.csv': 'upstream data, changed', 'history/raw/x.csv': 'x' },
  });
  sync(deploy, up);

  assert.equal(read(deploy, 'history/daily/web.csv'), 'deployment data');
  assert.equal(read(deploy, 'history/daily/db.csv'), 'deployment only');
  assert.equal(read(deploy, 'history/raw/x.csv'), null, 'nothing of upstream’s history comes across');
  assert.deepEqual(staged(deploy), ['M\tscripts/check.mjs']);
  rmSync(dir, { recursive: true, force: true });
});

test('paths the deployment keeps stay as it has them', () => {
  const { dir, up, deploy } = setup({
    upstream: { 'form.yml': 'Window', 'README.md': 'upstream readme', 'a.js': 'v1' },
    deployment: { 'form.yml': 'Zeitfenster', 'README.md': 'my readme' },
    later: { 'form.yml': 'Window, reworded', 'README.md': 'upstream readme v2', 'a.js': 'v2' },
  });
  // Commas and spaces both separate paths.
  sync(deploy, up, 'form.yml, README.md');

  assert.equal(read(deploy, 'form.yml'), 'Zeitfenster');
  assert.equal(read(deploy, 'README.md'), 'my readme');
  assert.equal(read(deploy, 'a.js'), 'v2');
  rmSync(dir, { recursive: true, force: true });
});

test('a kept path the deployment does not have is not taken from upstream', () => {
  const { dir, up, deploy } = setup({
    upstream: { 'a.js': 'v1' },
    later: { 'a.js': 'v2', 'NOTES.md': 'upstream notes' },
  });
  sync(deploy, up, 'NOTES.md');
  assert.equal(read(deploy, 'NOTES.md'), null);
  assert.equal(read(deploy, 'a.js'), 'v2');
  rmSync(dir, { recursive: true, force: true });
});

test('a change to a workflow is reported, because it takes a stronger token to push', () => {
  const { dir, up, deploy } = setup({
    upstream: { '.github/workflows/uptime.yml': 'v1', 'a.js': 'v1' },
    later: { '.github/workflows/uptime.yml': 'v2' },
  });
  assert.equal(sync(deploy, up).workflows, 'true');
  rmSync(dir, { recursive: true, force: true });

  const code = setup({ upstream: { 'a.js': 'v1' }, later: { 'a.js': 'v2' } });
  assert.equal(sync(code.deploy, code.up).workflows, 'false');
  rmSync(code.dir, { recursive: true, force: true });
});

test('a deployment already in step changes nothing', () => {
  const { dir, up, deploy } = setup({
    upstream: { 'a.js': 'v1' },
    deployment: { 'history/daily/web.csv': 'data' },
    later: { 'a.js': 'v2' },
  });
  sync(deploy, up);
  git(deploy, 'commit', '-qm', 'sync');

  const again = sync(deploy, up);
  assert.equal(again.changed, 'false');
  assert.equal(git(deploy, 'status', '--porcelain'), '');
  rmSync(dir, { recursive: true, force: true });
});

test('the upstream commit is reported, for the commit message to point at', () => {
  const { dir, up, deploy } = setup({ upstream: { 'a.js': 'v1' }, later: { 'a.js': 'v2' } });
  assert.equal(sync(deploy, up).upstream_sha, git(up, 'rev-parse', 'HEAD').trim());
  rmSync(dir, { recursive: true, force: true });
});
