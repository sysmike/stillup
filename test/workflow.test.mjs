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

const syncWorkflow = readFileSync(new URL('../.github/workflows/sync.yml', import.meta.url), 'utf8');

test('the sync runs a script that exists', () => {
  const called = [...syncWorkflow.matchAll(/bash (scripts\/[\w.-]+\.sh)/g)].map((m) => m[1]);
  assert.deepEqual(called, ['scripts/sync-upstream.sh']);
  assert.ok(existsSync(new URL(`../${called[0]}`, import.meta.url)));
});

test('nothing runs in the project itself', () => {
  // The project's repository holds the code but no page: nothing to check,
  // nothing to deploy, and nothing to sync with but itself. Each would fail
  // there on its schedule, every day, unless someone remembered to disable it.
  const guard = /if: github\.repository != \(vars\.SYNC_UPSTREAM \|\| 'sysmike\/stillup'\)/.source;
  const pages = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  for (const [workflow, job] of [[uptime, 'check'], [pages, 'build'], [syncWorkflow, 'sync']]) {
    const head = workflow.slice(workflow.indexOf(`  ${job}:`));
    assert.match(head, new RegExp(`^  ${job}:\\n(    #.*\\n)*    ${guard}`), `the ${job} job is guarded`);
  }
});

test('the sync tests before it commits, and deploys what it committed', () => {
  const test = syncWorkflow.indexOf('run: node --test');
  const commit = syncWorkflow.indexOf('git commit');
  assert.ok(test > 0 && test < commit, 'the tests run before the commit');
  assert.match(syncWorkflow, /uses: \.\/\.github\/workflows\/pages\.yml/);
});
