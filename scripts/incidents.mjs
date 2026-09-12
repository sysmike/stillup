// Turns check results into GitHub issues: one open issue per ongoing outage,
// closed with a summary comment once the monitor recovers.
//
// Issues carry a `<!-- monitor:<slug> -->` marker so runs stay stateless-safe,
// and history/state.json remembers how long the current state has lasted.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { api, ensureLabel, repo } from './lib/github.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STATE_FILE = `${ROOT}history/state.json`;
const INCIDENTS_FILE = `${ROOT}history/incidents.json`;
const LIVE_FILE = `${ROOT}history/live.json`;
const RESULTS_FILE = `${ROOT}scripts/.results.json`;

const marker = (slug) => `<!-- monitor:${slug} -->`;

// Issues this workflow opens name their monitor in a marker. One filed through
// the maintenance template names them in prose instead, under a heading the
// form generates, so both are resolved to slugs for the page to filter on.
function affectedMonitors(body) {
  const found = new Set();
  const tagged = (body || '').match(/<!-- monitor:([a-z0-9-]+) -->/)?.[1];
  if (tagged) found.add(tagged);

  const section = (body || '').match(/###\s*Affected monitors\s*\n+([^\n#]+)/i)?.[1];
  for (const token of (section || '').split(/[,;]/)) {
    const name = token.trim().toLowerCase();
    if (!name || name === '_no response_') continue;
    const match = monitors.find(
      (monitor) => monitor.slug === name || monitor.name.toLowerCase() === name,
    );
    if (match) found.add(match.slug);
  }
  return [...found];
}

function readJson(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}

function duration(from, to) {
  const minutes = Math.max(1, Math.round((new Date(to) - new Date(from)) / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return `${hours}h ${rest}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const { incidents: settings, monitors } = loadConfig(process.env.CONFIG_VARS, process.env.CONFIG_SECRETS);
const results = readJson(RESULTS_FILE, []);
const state = readJson(STATE_FILE, {});
let changed = false;

const [primaryLabel] = settings.labels;
for (const label of settings.labels) {
  await ensureLabel(label, 'd73a4a', 'Status page incident');
}
// The maintenance issue template applies this label, so it has to exist.
await ensureLabel('maintenance', '0969da', 'Planned maintenance shown on the status page');

const open = await api(
  `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(primaryLabel)}&per_page=100`,
);

for (const result of results) {
  const previous = state[result.slug] || { status: 'up', since: result.timestamp, failures: 0 };
  const issue = open.find((candidate) => (candidate.body || '').includes(marker(result.slug)));
  const down = result.status === 'down';
  const failures = down ? previous.failures + 1 : 0;
  if (previous.status !== result.status) changed = true;

  if (down && failures >= settings.threshold && !issue) {
    const created = await api(`/repos/${repo}/issues`, {
      method: 'POST',
      body: {
        title: `${result.name} is down`,
        labels: settings.labels,
        body: [
          marker(result.slug),
          `**${result.name}** stopped responding as expected.`,
          '',
          result.url ? `- URL: ${result.url}` : null,
          `- Error: ${result.error || 'unknown'}`,
          `- Response code: ${result.code || 'none'}`,
          `- First failure: ${previous.status === 'down' ? previous.since : result.timestamp}`,
          '',
          'This issue closes automatically once the monitor recovers.',
        ]
          .filter((line) => line !== null)
          .join('\n'),
      },
    });
    console.log(`opened #${created.number} for ${result.slug}`);
    state[result.slug] = {
      status: 'down',
      since: previous.status === 'down' ? previous.since : result.timestamp,
      failures,
      issue: created.number,
    };
    continue;
  }

  if (!down && issue) {
    const since = previous.status === 'down' ? previous.since : issue.created_at;
    await api(`/repos/${repo}/issues/${issue.number}/comments`, {
      method: 'POST',
      body: { body: `Recovered after ${duration(since, result.timestamp)} — ${result.code} in ${result.ms}ms.` },
    });
    await api(`/repos/${repo}/issues/${issue.number}`, {
      method: 'PATCH',
      body: { state: 'closed', state_reason: 'completed' },
    });
    console.log(`closed #${issue.number} for ${result.slug}`);
  }

  state[result.slug] = {
    status: result.status,
    since: previous.status === result.status ? previous.since : result.timestamp,
    failures,
    issue: down && issue ? issue.number : null,
  };
}

writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

// Snapshot of recent incidents so the site builds without further API calls.
const recent = await api(
  `/repos/${repo}/issues?state=all&labels=${encodeURIComponent(primaryLabel)}&per_page=30&sort=created&direction=desc`,
);

const snapshot = JSON.stringify(
  recent
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      state: issue.state,
      createdAt: issue.created_at,
      closedAt: issue.closed_at,
      labels: issue.labels.map((label) => label.name),
      monitor: (issue.body || '').match(/<!-- monitor:([a-z0-9-]+) -->/)?.[1] || null,
      monitors: affectedMonitors(issue.body),
      // The page renders this itself so a reader never has to leave for GitHub.
      body: (issue.body || '')
        .replace(/<!-- monitor:[a-z0-9-]+ -->/g, '')
        .trim()
        .slice(0, 2000),
      maintenance: issue.labels.some((label) => label.name === 'maintenance'),
    })),
  null,
  2,
);

// An incident opened or closed by hand, planned maintenance included, changes
// what the page shows just as much as a monitor going down does.
if (snapshot !== JSON.stringify(readJson(INCIDENTS_FILE, []), null, 2)) changed = true;
writeFileSync(INCIDENTS_FILE, `${snapshot}\n`);

// The deployed page fetches this file straight from the repository, so the
// numbers refresh between deployments instead of freezing at build time. It
// holds only what changes every run; the 90 day history stays in the build.
writeFileSync(
  LIVE_FILE,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      monitors: Object.fromEntries(
        results.map((result) => [
          result.slug,
          {
            status: result.status,
            lastCheck: result.timestamp,
            lastMs: result.ms,
            lastCode: result.code,
            since: state[result.slug]?.since ?? null,
          },
        ]),
      ),
      incidents: JSON.parse(snapshot).slice(0, 20),
    },
    null,
    2,
  )}\n`,
);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
