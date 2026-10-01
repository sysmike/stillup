import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { english } from '../site/lang/i18n.mjs';
import { UPDATE_MARKER, findNotice, noticeBody } from '../scripts/lib/update-notice.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/sync-notice.mjs', import.meta.url));
const SHA = 'cc9ab97e0123456789abcdef0123456789abcdef';
const NEWER = '783a6240123456789abcdef0123456789abcdef0';

const bot = { login: 'github-actions[bot]', type: 'Bot' };

test('the notice links the update and says where to apply it', () => {
  const body = noticeBody({
    t: english.t,
    upstream: 'sysmike/stillup',
    sha: SHA,
    syncUrl: 'https://github.com/acme/status/actions/workflows/sync.yml',
  });
  assert.match(body, /\[sysmike\/stillup@cc9ab97\]\(https:\/\/github\.com\/sysmike\/stillup\/commit\/cc9ab97e/);
  assert.match(body, /\[Sync\]\(https:\/\/github\.com\/acme\/status\/actions\/workflows\/sync\.yml\)/);
  assert.ok(body.endsWith(UPDATE_MARKER));
});

test('only the workflow’s own issue is taken for the notice', () => {
  const body = `text\n\n${UPDATE_MARKER}`;
  // Anyone who can open an issue can type the marker.
  const stranger = { number: 1, user: { login: 'someone', type: 'User' }, body };
  const pull = { number: 2, user: bot, body, pull_request: {} };
  const unmarked = { number: 3, user: bot, body: 'an incident' };
  const notice = { number: 4, user: bot, body };
  assert.equal(findNotice([stranger, pull, unmarked]), null);
  assert.equal(findNotice([stranger, pull, unmarked, notice]), notice);
});

// A GitHub that keeps its issues in memory, for the script to talk to.
function fakeGitHub(issues) {
  const calls = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const path = request.url.split('?')[0];
      calls.push(`${request.method} ${path}`);
      const reply = (status, data) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(data));
      };
      let match;
      if (request.method === 'GET' && path === '/repos/acme/status/issues') {
        return reply(200, issues.filter((issue) => issue.state === 'open'));
      }
      if (request.method === 'POST' && path === '/repos/acme/status/issues') {
        const issue = { number: issues.length + 1, state: 'open', user: bot, comments: [], ...body };
        issues.push(issue);
        return reply(201, issue);
      }
      if ((match = path.match(/^\/repos\/acme\/status\/issues\/(\d+)(\/comments)?$/))) {
        const issue = issues.find((item) => item.number === Number(match[1]));
        if (match[2]) issue.comments.push(body.body);
        else Object.assign(issue, body);
        return reply(200, issue);
      }
      reply(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, calls })));
}

function run(server, mode, sha) {
  const env = {
    ...process.env,
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_REPOSITORY: 'acme/status',
    GITHUB_TOKEN: 'token',
    SYNC_UPSTREAM: 'sysmike/stillup',
    SYNC_SHA: sha,
    CONFIG_VARS: JSON.stringify({ SITE_TITLE: 'Acme Status' }),
    CONFIG_SECRETS: '{}',
  };
  return new Promise((resolve, reject) =>
    execFile(process.execPath, [SCRIPT, mode], { env }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr || error.message)) : resolve(stdout),
    ),
  );
}

test('one issue stands for whatever update waits, and closes once one is applied', async () => {
  const issues = [{ number: 1, state: 'open', user: bot, body: 'an incident', comments: [] }];
  const { server, calls } = await fakeGitHub(issues);
  try {
    // Even with no notification target, there is the issue.
    assert.match(await run(server, 'waiting', SHA), /Opened #2\./);
    assert.equal(issues[1].title, english.t('issue.updateTitle'));
    assert.equal(issues[1].labels, undefined, 'no label, so the page never shows it');
    assert.match(issues[1].body, /@cc9ab97/);

    // The next night, nothing new: nothing is written.
    calls.length = 0;
    await run(server, 'waiting', SHA);
    assert.deepEqual(calls, ['GET /repos/acme/status/issues']);

    // A newer update takes its place in the same issue.
    assert.match(await run(server, 'waiting', NEWER), /Updated #2\./);
    assert.match(issues[1].body, /@783a624/);
    assert.equal(issues.length, 2);

    assert.match(await run(server, 'applied', NEWER), /Closed #2\./);
    assert.equal(issues[1].state, 'closed');
    assert.match(issues[1].comments[0], /@783a624/);
    assert.equal(issues[0].state, 'open', 'the incident is left alone');

    // With nothing waiting, a sync closes nothing.
    calls.length = 0;
    await run(server, 'applied', NEWER);
    assert.deepEqual(calls, ['GET /repos/acme/status/issues']);
  } finally {
    server.close();
  }
});
