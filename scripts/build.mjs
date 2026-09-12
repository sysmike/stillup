// Builds the static site into _site/: the page shell plus the JSON the page
// fetches at runtime.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { RAW_DAYS, readDaily, readRaw } from './lib/history.mjs';
import { dayKeys, dayViews, uptimeWindows } from './lib/summary.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, '_site');
const DAYS = 90;

function readJson(file, fallback) {
  const path = join(ROOT, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

const { site, groups, monitors } = loadConfig(process.env.CONFIG_VARS, process.env.CONFIG_SECRETS);
const state = readJson('history/state.json', {});
const incidents = readJson('history/incidents.json', []);
const keys = dayKeys(DAYS);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'api', 'monitor'), { recursive: true });
cpSync(join(ROOT, 'site'), OUT, { recursive: true });

const summaryMonitors = monitors.map((monitor) => {
  const daily = readDaily(monitor.slug);
  const days = dayViews(daily, keys);

  const raw = readRaw(monitor.slug);
  const latest = raw.at(-1);

  writeFileSync(
    join(OUT, 'api', 'monitor', `${monitor.slug}.json`),
    JSON.stringify({
      slug: monitor.slug,
      name: monitor.name,
      rawDays: RAW_DAYS,
      points: raw.map((entry) => [entry.timestamp, entry.status, entry.ms]),
    }),
  );

  return {
    slug: monitor.slug,
    name: monitor.name,
    url: monitor.private ? monitor.link : monitor.link || (monitor.type === 'http' ? monitor.url : null),
    group: monitor.group,
    description: monitor.description,
    status: state[monitor.slug]?.status || latest?.status || 'none',
    since: state[monitor.slug]?.since || null,
    lastCheck: latest?.timestamp || null,
    lastMs: latest?.ms || null, // 0 means nothing was measured, as for a dummy
    lastCode: latest?.code ?? null,
    uptime: uptimeWindows(daily, keys, DAYS),
    days,
  };
});

const active = summaryMonitors.filter((monitor) => monitor.status !== 'none');
const overall = active.some((monitor) => monitor.status === 'down')
  ? active.every((monitor) => monitor.status === 'down')
    ? 'down'
    : 'partial'
  : active.some((monitor) => monitor.status === 'degraded')
    ? 'degraded'
    : active.length
      ? 'up'
      : 'none';

// Where the page can read the current state without a redeployment. Empty
// outside Actions, which keeps a local build self-contained.
const live = process.env.GITHUB_REPOSITORY
  ? `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_REF_NAME || 'main'}/history/live.json`
  : null;

writeFileSync(
  join(OUT, 'api', 'summary.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      live,
      site,
      groups,
      overall,
      days: DAYS,
      monitors: summaryMonitors,
      incidents: incidents.slice(0, 20),
    },
    null,
    2,
  ),
);

console.log(`built ${summaryMonitors.length} monitor(s) into _site/`);
