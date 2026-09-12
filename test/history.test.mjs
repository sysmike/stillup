import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_HEADER,
  RAW_DAYS,
  RAW_HEADER,
  emptyDay,
  formatCsv,
  parseCsv,
  pruneRaw,
  rollupDay,
} from '../scripts/lib/history.mjs';

const at = (iso) => new Date(iso);
const days = (count) => count * 86400000;

test('parseCsv drops the header and ignores blank lines', () => {
  const text = `${RAW_HEADER}\n2026-09-01T00:00:00Z,up,200,120\n\n2026-09-01T00:05:00Z,down,503,0\n`;
  assert.deepEqual(parseCsv(text), [
    ['2026-09-01T00:00:00Z', 'up', '200', '120'],
    ['2026-09-01T00:05:00Z', 'down', '503', '0'],
  ]);
});

test('parseCsv on an empty or header-only file yields no rows', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv(`${DAILY_HEADER}\n`), []);
});

test('formatCsv round-trips through parseCsv', () => {
  const rows = [
    ['2026-09-01', '288', '286', '0', '2', '140', '90', '900'],
    ['2026-09-02', '288', '288', '0', '0', '138', '95', '410'],
  ];
  assert.deepEqual(parseCsv(formatCsv(DAILY_HEADER, rows)), rows);
});

test('pruneRaw keeps the window and drops what is older', () => {
  const now = at('2026-09-12T12:00:00Z');
  const entries = [
    { timestamp: '2026-09-01T12:00:00Z' },
    { timestamp: new Date(now.getTime() - days(RAW_DAYS) + 1000).toISOString() },
    { timestamp: '2026-09-12T11:55:00Z' },
  ];
  assert.deepEqual(
    pruneRaw(entries, now).map((entry) => entry.timestamp),
    [entries[1].timestamp, '2026-09-12T11:55:00Z'],
  );
});

test('pruneRaw keeps an entry exactly on the cutoff', () => {
  const now = at('2026-09-12T12:00:00Z');
  const entries = [{ timestamp: new Date(now.getTime() - days(RAW_DAYS)).toISOString() }];
  assert.equal(pruneRaw(entries, now).length, 1);
});

test('the first measured check seeds the average, the minimum and the maximum', () => {
  const day = rollupDay(emptyDay('2026-09-12'), { status: 'up', ms: 120 });
  assert.deepEqual(day, {
    date: '2026-09-12',
    checks: 1,
    up: 1,
    degraded: 0,
    down: 0,
    avg: 120,
    min: 120,
    max: 120,
  });
});

test('further checks average over what was measured', () => {
  let day = emptyDay('2026-09-12');
  for (const ms of [100, 200, 300]) day = rollupDay(day, { status: 'up', ms });
  assert.partialDeepStrictEqual(day, { checks: 3, up: 3, avg: 200, min: 100, max: 300 });
});

test('a down check counts but leaves the timings alone', () => {
  let day = rollupDay(emptyDay('2026-09-12'), { status: 'up', ms: 100 });
  day = rollupDay(day, { status: 'down', ms: 0 });
  assert.partialDeepStrictEqual(day, { checks: 2, up: 1, down: 1, avg: 100, min: 100, max: 100 });
});

test('a check that measured nothing does not drag the average down', () => {
  let day = rollupDay(emptyDay('2026-09-12'), { status: 'up', ms: 100 });
  day = rollupDay(day, { status: 'up', ms: 0 });
  assert.partialDeepStrictEqual(day, { checks: 2, up: 2, avg: 100, min: 100, max: 100 });
});

test('a degraded check is slow but still measured', () => {
  let day = rollupDay(emptyDay('2026-09-12'), { status: 'up', ms: 100 });
  day = rollupDay(day, { status: 'degraded', ms: 900 });
  assert.partialDeepStrictEqual(day, { checks: 2, up: 1, degraded: 1, avg: 500, min: 100, max: 900 });
});

test('the average recovers after a day that began with an outage', () => {
  let day = emptyDay('2026-09-12');
  day = rollupDay(day, { status: 'down', ms: 0 });
  day = rollupDay(day, { status: 'down', ms: 0 });
  day = rollupDay(day, { status: 'up', ms: 150 });
  assert.partialDeepStrictEqual(day, { checks: 3, down: 2, up: 1, avg: 150, min: 150, max: 150 });
});

test('rollupDay leaves the row it was given untouched', () => {
  const day = emptyDay('2026-09-12');
  rollupDay(day, { status: 'up', ms: 120 });
  assert.deepEqual(day, emptyDay('2026-09-12'));
});
