// Builds the static site into _site/: the page shell plus the JSON the page
// fetches at runtime.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { RAW_DAYS, readDaily, readRaw } from './lib/history.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, '_site');
const DAYS = 90;

function readJson(file, fallback) {
  const path = join(ROOT, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function dayKeys(count) {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (count - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

function classify(day) {
  if (!day || day.checks === 0) return 'none';
  if (day.down >= day.checks) return 'down';
  if (day.down > 0) return 'partial';
  if (day.degraded > 0) return 'degraded';
  return 'up';
}

function uptime(days) {
  const checks = days.reduce((total, day) => total + day.checks, 0);
  if (checks === 0) return null;
  const ok = days.reduce((total, day) => total + day.up + day.degraded, 0);
  return Math.round((ok / checks) * 10000) / 100;
}

const { site, monitors } = loadConfig(process.env.CONFIG_VARS, process.env.CONFIG_SECRETS);
const state = readJson('history/state.json', {});
const incidents = readJson('history/incidents.json', []);
const keys = dayKeys(DAYS);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'api', 'monitor'), { recursive: true });
cpSync(join(ROOT, 'site'), OUT, { recursive: true });

const summaryMonitors = monitors.map((monitor) => {
  const daily = readDaily(monitor.slug);
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const days = keys.map((date) => {
    const day = byDate.get(date);
    return {
      date,
      state: classify(day),
      checks: day?.checks ?? 0,
      down: day?.down ?? 0,
      degraded: day?.degraded ?? 0,
      avg: day?.avg ?? 0,
    };
  });

  const raw = readRaw(monitor.slug);
  const latest = raw.at(-1);
  const window = (count) => daily.filter((day) => keys.slice(-count).includes(day.date));
  const measured = raw.filter((entry) => entry.ms > 0);

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
    lastMs: latest?.ms ?? null,
    lastCode: latest?.code ?? null,
    avgMs: measured.length
      ? Math.round(measured.reduce((total, entry) => total + entry.ms, 0) / measured.length)
      : null,
    uptime: {
      day: uptime(window(1)),
      week: uptime(window(7)),
      month: uptime(window(30)),
      quarter: uptime(window(DAYS)),
    },
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
