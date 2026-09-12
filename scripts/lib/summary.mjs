// Turns the daily history into the figures the page shows. The build writes
// them into the site and every check run writes the newest of them into
// history/live.json, so the page can refresh them between deployments.

import { readDaily } from './history.mjs';

// Day rows live.json carries. Only today's row normally changes, but a second
// one covers the turn of the day and a deployment that was skipped.
export const LIVE_DAYS = 3;

export function dayKeys(count, today = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (count - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

export function classify(day) {
  if (!day || day.checks === 0) return 'none';
  if (day.down >= day.checks) return 'down';
  if (day.down > 0) return 'partial';
  if (day.degraded > 0) return 'degraded';
  return 'up';
}

// Share of checks that answered, degraded ones included: the page reports
// reachability, and a slow answer is still an answer.
export function uptime(days) {
  const checks = days.reduce((total, day) => total + day.checks, 0);
  if (checks === 0) return null;
  const ok = days.reduce((total, day) => total + day.up + day.degraded, 0);
  return Math.round((ok / checks) * 10000) / 100;
}

// One bar of the strip. A date with no row of its own is a day the monitor did
// not exist yet, or one the workflow never ran on.
export function dayView(date, day) {
  return {
    date,
    state: classify(day),
    checks: day?.checks ?? 0,
    down: day?.down ?? 0,
    degraded: day?.degraded ?? 0,
    avg: day?.avg ?? 0,
  };
}

export function dayViews(daily, keys) {
  const byDate = new Map(daily.map((day) => [day.date, day]));
  return keys.map((date) => dayView(date, byDate.get(date)));
}

// The four figures the detail dialog shows, over the last N days including
// today. `keys` is the full window the caller works in.
export function uptimeWindows(daily, keys, quarter = keys.length) {
  const window = (count) => {
    const dates = new Set(keys.slice(-count));
    return daily.filter((day) => dates.has(day.date));
  };
  return {
    day: uptime(window(1)),
    week: uptime(window(7)),
    month: uptime(window(30)),
    quarter: uptime(window(quarter)),
  };
}

// What a check run publishes per monitor: the figures that moved, plus the
// newest day rows so the strip does not wait for the next deployment.
export function liveMonitor(slug, keys) {
  const daily = readDaily(slug);
  return {
    uptime: uptimeWindows(daily, keys),
    days: dayViews(daily, keys.slice(-LIVE_DAYS)),
  };
}
