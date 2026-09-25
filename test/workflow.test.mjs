import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const uptime = readFileSync(new URL('../.github/workflows/uptime.yml', import.meta.url), 'utf8');
const commitStep = uptime.slice(uptime.indexOf('- name: Commit history'));

test('the commit step runs a script that exists', () => {
  // A rename on either side would only show up during a race, which is both
  // rare and the worst moment to find out.
  const called = [...commitStep.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map((m) => m[1]);
  assert.deepEqual(called, ['scripts/apply-results.mjs']);
  for (const script of called) {
    assert.ok(existsSync(new URL(`../${script}`, import.meta.url)), `${script} is missing`);
  }
});

test('the commit step does not try to rebase the history', () => {
  // Two runs that overlap append to the same files from the same starting
  // point, and today's row in each daily CSV is a counter both incremented.
  // Rebasing conflicts on every file and leaves the checkout mid-rebase, which
  // failed the run outright rather than recovering from it.
  assert.doesNotMatch(commitStep, /--rebase/);
  assert.match(commitStep, /git reset --hard "origin\/\$\{GITHUB_REF_NAME\}"/);
});

test('a losing push is retried rather than failing the run at once', () => {
  assert.match(commitStep, /for attempt in 1 2 3/);
  assert.match(commitStep, /::error::/, 'and says so plainly once the attempts run out');
});
