// History lives in two CSV files per monitor:
//   history/raw/<slug>.csv    every check of the last RAW_DAYS days
//   history/daily/<slug>.csv  one aggregated row per day, kept forever

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAW_DAYS = 7;
export const RAW_HEADER = 'timestamp,status,code,ms';
export const DAILY_HEADER = 'date,checks,up,degraded,down,avg,min,max';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Drops the header row: a file written by an older run still parses as long
// as the columns it does have line up.
export function parseCsv(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .map((line) => line.split(','));
}

export function formatCsv(header, rows) {
  return `${header}\n${rows.map((row) => row.join(',')).join('\n')}\n`;
}

function read(file) {
  if (!existsSync(file)) return [];
  return parseCsv(readFileSync(file, 'utf8'));
}

function write(file, header, rows) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, formatCsv(header, rows));
}

export const rawPath = (slug) => join(ROOT, 'history', 'raw', `${slug}.csv`);
export const dailyPath = (slug) => join(ROOT, 'history', 'daily', `${slug}.csv`);

export function readRaw(slug) {
  return read(rawPath(slug)).map(([timestamp, status, code, ms]) => ({
    timestamp,
    status,
    code: Number(code),
    ms: Number(ms),
  }));
}

export function readDaily(slug) {
  return read(dailyPath(slug)).map(([date, checks, up, degraded, down, avg, min, max]) => ({
    date,
    checks: Number(checks),
    up: Number(up),
    degraded: Number(degraded),
    down: Number(down),
    avg: Number(avg),
    min: Number(min),
    max: Number(max),
  }));
}

// Raw history covers a moving window; anything older only survives in the
// daily rollup.
export function pruneRaw(entries, now = new Date()) {
  const cutoff = new Date(now.getTime() - RAW_DAYS * 86400000).toISOString();
  return entries.filter((entry) => entry.timestamp >= cutoff);
}

export const emptyDay = (date) => ({ date, checks: 0, up: 0, degraded: 0, down: 0, avg: 0, min: 0, max: 0 });

// Folds one result into a day, returning a new row. The average covers the
// checks that measured something: a down check reports no time, and neither
// does a dummy monitor, so counting either would drag the average to zero.
export function rollupDay(day, result) {
  const next = { ...day, checks: day.checks + 1 };
  next[result.status] += 1;
  if (result.status === 'down' || result.ms <= 0) return next;

  const measured = day.checks - day.down;
  const count = measured + 1;
  next.avg = Math.round((day.avg * measured + result.ms) / count);
  next.min = day.min === 0 ? result.ms : Math.min(day.min, result.ms);
  next.max = Math.max(day.max, result.ms);
  return next;
}

export function appendResult(slug, result, now = new Date()) {
  const entries = pruneRaw(readRaw(slug), now);
  entries.push({
    timestamp: result.timestamp,
    status: result.status,
    code: result.code,
    ms: result.ms,
  });
  write(
    rawPath(slug),
    RAW_HEADER,
    entries.map((entry) => [entry.timestamp, entry.status, entry.code, entry.ms]),
  );

  const date = result.timestamp.slice(0, 10);
  const days = readDaily(slug);
  const index = days.findIndex((entry) => entry.date === date);
  const day = rollupDay(index === -1 ? emptyDay(date) : days[index], result);
  if (index === -1) days.push(day);
  else days[index] = day;

  days.sort((a, b) => a.date.localeCompare(b.date));
  write(
    dailyPath(slug),
    DAILY_HEADER,
    days.map((entry) => [
      entry.date,
      entry.checks,
      entry.up,
      entry.degraded,
      entry.down,
      entry.avg,
      entry.min,
      entry.max,
    ]),
  );
}
