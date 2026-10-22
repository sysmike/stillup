import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOpenIncident, marker } from '../scripts/lib/issues.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const bot = { login: 'github-actions[bot]', type: 'Bot' };

test('an open incident is open, trusted and marked for its monitor', () => {
  const incident = { state: 'open', user: bot, body: `${marker('mail')}\nMailserver is down` };
  assert.equal(isOpenIncident(incident, 'mail'), true);
  assert.equal(isOpenIncident({ ...incident, state: 'closed' }, 'mail'), false);
  assert.equal(isOpenIncident(incident, 'backupmx'), false);
  assert.equal(isOpenIncident({ ...incident, user: { login: 'someone', type: 'User' } }, 'mail'), false);
  assert.equal(isOpenIncident({ ...incident, pull_request: {} }, 'mail'), false);
  assert.equal(isOpenIncident(null, 'mail'), false);
});

// A GitHub that keeps its issues in memory. Its listings can be made to answer
// with nothing, as GitHub's own have been seen to, and never include an issue
// opened during the run that lists them, as GitHub's do not either.
function fakeGitHub(state) {
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const url = new URL(request.url, 'http://localhost');
      const reply = (status, data) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(data));
      };
      let match;
      if (url.pathname === '/repos/acme/status/labels') return reply(422, {});
      if (request.method === 'GET' && url.pathname === '/repos/acme/status/issues') {
        if (state.emptyListings) return reply(200, []);
        const wanted = url.searchParams.get('state');
        const listed = state.issues.filter(
          (issue) => !state.fresh.has(issue.number) && (wanted === 'all' || issue.state === wanted),
        );
        return reply(200, [...listed].reverse());
      }
      if (request.method === 'POST' && url.pathname === '/repos/acme/status/issues') {
        const number = state.issues.length + 1;
        const issue = {
          number,
          state: 'open',
          user: bot,
          html_url: `https://github.com/acme/status/issues/${number}`,
          created_at: '2026-10-22T15:30:16Z',
          closed_at: null,
          comments: 0,
          thread: [],
          ...body,
          labels: body.labels.map((name) => ({ name })),
        };
        state.issues.push(issue);
        state.fresh.add(number);
        return reply(201, issue);
      }
      if ((match = url.pathname.match(/^\/repos\/acme\/status\/issues\/(\d+)(\/comments)?$/))) {
        const issue = state.issues.find((item) => item.number === Number(match[1]));
        if (!issue) return reply(404, {});
        if (match[2] && request.method === 'GET') return reply(200, []);
        if (match[2]) {
          issue.thread.push(body.body);
          issue.comments += 1;
        } else if (request.method === 'PATCH') Object.assign(issue, body);
        return reply(200, issue);
      }
      reply(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

// incidents.mjs keeps its history next to itself, so each run works on a copy.
function page() {
  const dir = mkdtempSync(join(tmpdir(), 'stillup-incidents-'));
  cpSync(join(ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'site'), join(dir, 'site'), { recursive: true });
  mkdirSync(join(dir, 'history'));
  return dir;
}

function incidents(dir, server, status) {
  writeFileSync(
    join(dir, 'scripts/.results.json'),
    JSON.stringify([
      {
        slug: 'mail',
        name: 'Mailserver',
        url: 'https://mail.example.com',
        status,
        timestamp: '2026-10-22T15:30:10Z',
        error: status === 'down' ? 'fetch failed' : null,
        code: status === 'down' ? null : 200,
        ms: status === 'down' ? null : 120,
      },
    ]),
  );
  const env = {
    ...process.env,
    CONFIG_VARS: JSON.stringify({ MONITOR_MAIL: JSON.stringify({ url: 'https://mail.example.com', name: 'Mailserver' }) }),
    CONFIG_SECRETS: '{}',
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_REPOSITORY: 'acme/status',
    GITHUB_TOKEN: 'token',
    GITHUB_OUTPUT: '',
  };
  return new Promise((resolve, reject) =>
    execFile(process.execPath, [join(dir, 'scripts/incidents.mjs')], { env }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr || error.message)) : resolve(stdout),
    ),
  );
}

const read = (dir, file) => JSON.parse(readFileSync(join(dir, 'history', file), 'utf8'));

test('a listing that comes back empty neither duplicates an incident nor takes it off the page', async () => {
  const state = { issues: [], fresh: new Set(), emptyListings: false };
  const server = await fakeGitHub(state);
  const dir = page();
  try {
    writeFileSync(
      join(dir, 'history/state.json'),
      JSON.stringify({ mail: { status: 'down', since: '2026-10-22T15:25:10Z', failures: 1, issue: null } }),
    );

    // The second failure opens the incident, and the page shows it straight
    // away although the listing does not have it yet.
    assert.match(await incidents(dir, server, 'down'), /opened #1 for mail/);
    assert.deepEqual(
      read(dir, 'incidents.json').map(({ number, state: open }) => [number, open]),
      [[1, 'open']],
    );
    assert.equal(read(dir, 'state.json').mail.issue, 1);
    state.fresh.clear();

    // GitHub lists nothing while the monitor is still down.
    state.emptyListings = true;
    const quiet = await incidents(dir, server, 'down');
    assert.doesNotMatch(quiet, /opened/);
    assert.match(quiet, /left out open #1; keeping the previous incident snapshot/);
    assert.equal(state.issues.length, 1, 'no second issue');
    assert.equal(read(dir, 'state.json').mail.issue, 1);
    assert.deepEqual(
      read(dir, 'incidents.json').map(({ number }) => number),
      [1],
    );
    assert.equal(read(dir, 'live.json').incidents.length, 1);

    // It recovers while the listing is still empty, and its issue is closed.
    assert.match(await incidents(dir, server, 'up'), /closed #1 for mail/);
    assert.equal(state.issues[0].state, 'closed');
    assert.equal(state.issues[0].thread.length, 1);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an incident closed by hand while its monitor is still down is opened again', async () => {
  const state = { issues: [], fresh: new Set(), emptyListings: false };
  const server = await fakeGitHub(state);
  const dir = page();
  try {
    writeFileSync(
      join(dir, 'history/state.json'),
      JSON.stringify({ mail: { status: 'down', since: '2026-10-22T15:25:10Z', failures: 1, issue: null } }),
    );
    await incidents(dir, server, 'down');
    state.fresh.clear();
    state.issues[0].state = 'closed';

    state.emptyListings = true;
    assert.match(await incidents(dir, server, 'down'), /opened #2 for mail/);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
