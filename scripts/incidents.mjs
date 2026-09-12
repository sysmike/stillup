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
const RESULTS_FILE = `${ROOT}scripts/.results.json`;

const marker = (slug) => `<!-- monitor:${slug} -->`;

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

const { incidents: settings } = loadConfig(process.env.CONFIG_VARS, process.env.CONFIG_SECRETS);
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

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

// Snapshot of recent incidents so the site builds without further API calls.
const recent = await api(
  `/repos/${repo}/issues?state=all&labels=${encodeURIComponent(primaryLabel)}&per_page=30&sort=created&direction=desc`,
);

writeFileSync(
  INCIDENTS_FILE,
  `${JSON.stringify(
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
        maintenance: issue.labels.some((label) => label.name === 'maintenance'),
      })),
    null,
    2,
  )}\n`,
);
