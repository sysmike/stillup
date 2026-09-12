import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, dayKeys, dayView, dayViews, uptime, uptimeWindows } from '../scripts/lib/summary.mjs';

const day = (date, values = {}) => ({
  date,
  checks: 0,
  up: 0,
  degraded: 0,
  down: 0,
  avg: 0,
  min: 0,
  max: 0,
  ...values,
});

test('dayKeys ends on the given day and counts back in UTC', () => {
  const keys = dayKeys(3, new Date('2026-03-01T00:30:00Z'));
  assert.deepEqual(keys, ['2026-02-27', '2026-02-28', '2026-03-01']);
});

test('dayKeys crosses a year boundary', () => {
  assert.deepEqual(dayKeys(2, new Date('2026-01-01T12:00:00Z')), ['2025-12-31', '2026-01-01']);
});

test('classify reports the worst thing that happened that day', () => {
  assert.equal(classify(undefined), 'none');
  assert.equal(classify(day('2026-03-01')), 'none');
  assert.equal(classify(day('2026-03-01', { checks: 10, up: 10 })), 'up');
  assert.equal(classify(day('2026-03-01', { checks: 10, up: 9, degraded: 1 })), 'degraded');
  assert.equal(classify(day('2026-03-01', { checks: 10, up: 9, down: 1 })), 'partial');
  assert.equal(classify(day('2026-03-01', { checks: 10, down: 10 })), 'down');
});

test('a degraded check still counts as reachable', () => {
  assert.equal(uptime([day('2026-03-01', { checks: 100, up: 90, degraded: 10 })]), 100);
  assert.equal(uptime([day('2026-03-01', { checks: 100, up: 90, down: 10 })]), 90);
});

test('uptime is rounded to two decimals and spans the days it is given', () => {
  const days = [
    day('2026-03-01', { checks: 288, up: 287, down: 1 }),
    day('2026-03-02', { checks: 288, up: 288 }),
  ];
  assert.equal(uptime(days), 99.83);
});

test('uptime of nothing is null, not zero', () => {
  assert.equal(uptime([]), null);
  assert.equal(uptime([day('2026-03-01')]), null);
});

test('dayView fills in a day the history does not have', () => {
  assert.deepEqual(dayView('2026-03-01', undefined), {
    date: '2026-03-01',
    state: 'none',
    checks: 0,
    down: 0,
    degraded: 0,
    avg: 0,
  });
});

test('dayViews returns one entry per key, in key order', () => {
  const daily = [day('2026-03-02', { checks: 10, up: 10, avg: 120 })];
  const views = dayViews(daily, ['2026-03-01', '2026-03-02', '2026-03-03']);
  assert.deepEqual(
    views.map((view) => [view.date, view.state]),
    [
      ['2026-03-01', 'none'],
      ['2026-03-02', 'up'],
      ['2026-03-03', 'none'],
    ],
  );
  assert.equal(views[1].avg, 120);
});

test('the uptime windows each cover their own span', () => {
  const keys = dayKeys(30, new Date('2026-03-30T00:00:00Z'));
  const daily = keys.map((date) => day(date, { checks: 100, up: 100 }));
  // Today perfect, one older day half down.
  daily[daily.length - 8] = day(keys[keys.length - 8], { checks: 100, up: 50, down: 50 });

  const windows = uptimeWindows(daily, keys);
  assert.equal(windows.day, 100);
  assert.equal(windows.week, 100, 'the bad day falls outside the last 7');
  assert.equal(windows.month, 98.33);
  assert.equal(windows.quarter, windows.month, 'the window defaults to every key given');
});

test('a monitor with no history reports null rather than a figure', () => {
  const keys = dayKeys(30, new Date('2026-03-30T00:00:00Z'));
  assert.deepEqual(uptimeWindows([], keys), { day: null, week: null, month: null, quarter: null });
});

test('history older than the window does not count towards the figures', () => {
  const keys = dayKeys(7, new Date('2026-03-30T00:00:00Z'));
  const daily = [day('2026-01-01', { checks: 100, down: 100 }), ...keys.map((date) => day(date, { checks: 10, up: 10 }))];
  assert.equal(uptimeWindows(daily, keys).week, 100);
});
