// Builds the static site into _site/: the page shell plus the JSON the page
// fetches at runtime.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../site/lang/i18n.mjs';
import { loadConfig } from './lib/config.mjs';
import { RAW_DAYS, readDaily, readRaw } from './lib/history.mjs';
import { stamp } from './lib/shell.mjs';
import { dayKeys, dayViews, uptimeWindows } from './lib/summary.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, '_site');
const DAYS = 90;

function readJson(file, fallback) {
  const path = join(ROOT, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

const { site, groups, monitors, incidents: incidentSettings } = loadConfig(
  process.env.CONFIG_VARS,
  process.env.CONFIG_SECRETS,
);
const state = readJson('history/state.json', {});
const incidents = readJson('history/incidents.json', []);
const keys = dayKeys(DAYS);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'api', 'monitor'), { recursive: true });
cpSync(join(ROOT, 'site'), OUT, { recursive: true });

// The language has to be on the document before app.js can ask for anything,
// which also lets the right dictionary load alongside the first fetch rather
// than after it. The rest is for whatever never runs a script — a chat client
// unfurling the link, a search result — which would otherwise be told this is
// a page called "Status" in English, whatever it was configured as.
const i18n = await load(site.lang);
const indexFile = join(OUT, 'index.html');
writeFileSync(
  indexFile,
  stamp(readFileSync(indexFile, 'utf8'), {
    title: site.title,
    lang: i18n.locale,
    dir: i18n.dir,
    t: i18n.t,
    scripts: site.scripts,
  }),
);

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
    uptime: uptimeWindows(daily, keys),
    days,
  };
});

// The page works this out again whenever it refreshes from live.json, so the
// two have to agree. See computeOverall in site/app.js.
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

// Where a reader goes for incidents older than the page lists. Empty outside
// Actions, where the repository is not known.
const issuesUrl = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}/issues?q=${encodeURIComponent(
      `is:issue label:${incidentSettings.labels[0]}`,
    )}`
  : null;

// Where the page can read the current state without a redeployment. Empty
// outside Actions, which keeps a local build self-contained.
const live = process.env.GITHUB_REPOSITORY
  ? `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_REF_NAME || 'main'}/history/live.json`
  : null;

// What the page reads of the configuration. SITE_SCRIPTS is a build
// instruction rather than status, and the tags it asked for are in the document
// already, so it is not part of the snapshot.
const { scripts: _scripts, ...published } = site;

writeFileSync(
  join(OUT, 'api', 'summary.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      live,
      issuesUrl,
      monitorsHeading: incidentSettings.monitorsHeading,
      site: published,
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
