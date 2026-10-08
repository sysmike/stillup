import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { english } from '../site/lang/i18n.mjs';
import { HELD_MARKER, heldBody, heldSince } from '../scripts/lib/held.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/watch.mjs', import.meta.url));
const bot = { login: 'github-actions[bot]', type: 'Bot' };

const run = (conclusion, created_at, event = 'schedule') => ({ conclusion, created_at, event });

test('a workflow is held when its newest run is, since the first of that stretch', () => {
  assert.equal(
    heldSince([
      run('action_required', '2026-10-07T10:24:26Z'),
      run('action_required', '2026-10-06T10:32:23Z'),
      run('success', '2026-10-01T15:19:58Z'),
      run('action_required', '2026-09-26T19:30:03Z'),
    ]),
    '2026-10-06T10:32:23Z',
  );
});

test('a held run that a later one overtook is history', () => {
  assert.equal(heldSince([run('success', '2026-10-08T06:00:00Z'), run('action_required', '2026-10-07T10:24:26Z')]), null);
  // Still running says nothing either way.
  assert.equal(heldSince([run(null, '2026-10-08T06:00:00Z'), run('action_required', '2026-10-07T10:24:26Z')]), null);
  assert.equal(heldSince([]), null);
});

test('a pull request from outside waiting for approval is not a hold on the page', () => {
  assert.equal(
    heldSince([run('action_required', '2026-10-08T06:00:00Z', 'pull_request'), run('success', '2026-10-08T05:00:00Z')]),
    null,
  );
});

test('the issue names each held workflow without changing on every run', () => {
  const body = heldBody({
    t: english.t,
    held: [{ name: 'Uptime', url: 'https://github.com/acme/status/actions/workflows/uptime.yml', since: '2026-09-25T11:00:03Z' }],
  });
  assert.match(body, /^- \[Uptime\]\(https:\/\/github\.com\/acme\/status\/actions\/workflows\/uptime\.yml\), held since 2026-09-25 11:00 UTC$/m);
  assert.ok(body.endsWith(HELD_MARKER));
});

// A GitHub that keeps its workflows, runs and issues in memory.
function fakeGitHub(state) {
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
      if (path === '/repos/acme/status/actions/workflows') return reply(200, { workflows: state.workflows });
      if ((match = path.match(/^\/repos\/acme\/status\/actions\/workflows\/(\d+)\/runs$/))) {
        return reply(200, { workflow_runs: state.runs[match[1]] || [] });
      }
      if (request.method === 'GET' && path === '/repos/acme/status/issues') {
        return reply(200, state.issues.filter((issue) => issue.state === 'open'));
      }
      if (request.method === 'POST' && path === '/repos/acme/status/issues') {
        const issue = { number: state.issues.length + 1, state: 'open', user: bot, comments: [], ...body };
        state.issues.push(issue);
        return reply(201, issue);
      }
      if ((match = path.match(/^\/repos\/acme\/status\/issues\/(\d+)(\/comments)?$/))) {
        const issue = state.issues.find((item) => item.number === Number(match[1]));
        if (match[2]) issue.comments.push(body.body);
        else Object.assign(issue, body);
        return reply(200, issue);
      }
      reply(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, calls })));
}

function watch(server) {
  const env = {
    ...process.env,
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_REPOSITORY: 'acme/status',
    GITHUB_TOKEN: 'token',
    SITE_LANG: '',
  };
  return new Promise((resolve, reject) =>
    execFile(process.execPath, [SCRIPT], { env }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr || error.message)) : resolve(stdout),
    ),
  );
}

test('an issue stays open for as long as anything is held', async () => {
  const workflow = (id, name, file, state = 'active') => ({ id, name, path: `.github/workflows/${file}`, state });
  const state = {
    workflows: [
      workflow(1, 'Uptime', 'uptime.yml'),
      workflow(2, 'Sync', 'sync.yml'),
      workflow(3, 'Pages', 'pages.yml', 'disabled_manually'),
      workflow(4, 'Watch', 'watch.yml'),
    ],
    runs: {
      1: [run('success', '2026-10-08T06:00:03Z')],
      2: [run('action_required', '2026-10-07T10:24:26Z'), run('action_required', '2026-10-06T10:32:23Z')],
      // Neither a disabled workflow nor Watch itself is asked about.
      3: [run('action_required', '2026-10-08T06:00:00Z')],
      4: [run('action_required', '2026-10-08T06:00:00Z')],
    },
    issues: [{ number: 1, state: 'open', user: bot, body: 'an incident', comments: [] }],
  };
  const { server, calls } = await fakeGitHub(state);
  try {
    assert.match(await watch(server), /Held: Sync\. Opened #2\./);
    const notice = state.issues[1];
    assert.equal(notice.title, english.t('issue.heldTitle'));
    assert.equal(notice.labels, undefined, 'no label, so the page never shows it');
    assert.match(notice.body, /\[Sync\]\(https:\/\/github\.com\/acme\/status\/actions\/workflows\/sync\.yml\), held since 2026-10-06 10:32 UTC/);
    assert.doesNotMatch(notice.body, /Pages|Watch/);
    assert.ok(!calls.some((call) => /workflows\/(3|4)\/runs/.test(call)));

    // Another night held: the issue already says so.
    state.runs[2].unshift(run('action_required', '2026-10-08T10:20:00Z'));
    calls.length = 0;
    assert.match(await watch(server), /#2 already says so/);
    assert.ok(!calls.some((call) => call.startsWith('PATCH') || call.startsWith('POST')));

    // Uptime is held as well.
    state.runs[1].unshift(run('action_required', '2026-10-08T10:30:03Z'));
    assert.match(await watch(server), /Held: Uptime, Sync\. Updated #2\./);
    assert.match(notice.body, /\[Uptime\]/);
    assert.equal(state.issues.length, 2);

    // Both approved: their newest runs go through.
    state.runs[1].unshift(run('success', '2026-10-08T11:00:03Z'));
    state.runs[2].unshift(run('success', '2026-10-08T11:05:00Z'));
    assert.match(await watch(server), /Nothing is held\. Closed #2\./);
    assert.equal(notice.state, 'closed');
    assert.deepEqual(notice.comments, [english.t('issue.heldCleared')]);
    assert.equal(state.issues[0].state, 'open', 'the incident is left alone');

    assert.match(await watch(server), /^Nothing is held\.$/m);
  } finally {
    server.close();
  }
});
