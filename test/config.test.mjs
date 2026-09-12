import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, redact, statusMatches } from '../scripts/lib/config.mjs';

const vars = (object) => JSON.stringify(object);

test('a bare URL becomes an http monitor with the defaults', () => {
  const { monitors } = loadConfig(vars({ MONITOR_PUBLIC_API: 'https://example.com/health' }));
  assert.equal(monitors.length, 1);
  assert.partialDeepStrictEqual(monitors[0], {
    slug: 'public-api',
    name: 'Public Api',
    type: 'http',
    url: 'https://example.com/health',
    method: 'GET',
    timeout: 10000,
    retries: 1,
    expectedStatus: '2xx',
    private: false,
  });
});

test('a JSON value overrides the defaults', () => {
  const { monitors } = loadConfig(
    vars({
      MONITOR_API: JSON.stringify({
        url: 'https://example.com',
        name: 'Public API',
        group: 'Public',
        method: 'head',
        timeout: 2500,
        degradedMs: 800,
        expectedStatus: ['200', '301'],
      }),
    }),
  );
  assert.partialDeepStrictEqual(monitors[0], {
    name: 'Public API',
    group: 'Public',
    method: 'HEAD',
    timeout: 2500,
    degradedMs: 800,
  });
});

test('the scheme picks the check type', () => {
  const { monitors } = loadConfig(
    vars({
      MONITOR_A: 'https://example.com',
      MONITOR_B: 'tcp://example.com:25',
      MONITOR_C: 'ping://example.com',
      MONITOR_D: 'dummy://placeholder',
    }),
  );
  assert.deepEqual(
    monitors.map((monitor) => [monitor.slug, monitor.type]).sort(),
    [
      ['a', 'http'],
      ['b', 'tcp'],
      ['c', 'ping'],
      ['d', 'dummy'],
    ],
  );
});

test('a tcp monitor without a port is rejected', () => {
  assert.throws(() => loadConfig(vars({ MONITOR_MAIL: 'tcp://example.com' })), /needs a port/);
});

test('a ping host that could pass for an option is rejected', () => {
  assert.throws(() => loadConfig(vars({ MONITOR_X: 'ping://-oProxyCommand' })), /unusable host/);
});

test('a monitor without a url is rejected', () => {
  assert.throws(() => loadConfig(vars({ MONITOR_X: JSON.stringify({ name: 'X' }) })), /has no url/);
});

test('a malformed JSON value names the variable', () => {
  assert.throws(() => loadConfig(vars({ MONITOR_X: '{oops' })), /MONITOR_X is not valid JSON/);
});

test('a monitor defined as a secret is private, a variable is not', () => {
  const { monitors } = loadConfig(
    vars({ MONITOR_PUBLIC: 'https://example.com' }),
    vars({ MONITOR_INTERNAL: 'https://intranet.example.com' }),
  );
  const bySlug = Object.fromEntries(monitors.map((monitor) => [monitor.slug, monitor]));
  assert.equal(bySlug.public.private, false);
  assert.equal(bySlug.internal.private, true);
});

test('private can be set explicitly on a variable', () => {
  const { monitors } = loadConfig(
    vars({ MONITOR_X: JSON.stringify({ url: 'https://example.com', private: true }) }),
  );
  assert.equal(monitors[0].private, true);
});

test('monitors sort by order, then by name', () => {
  const { monitors } = loadConfig(
    vars({
      MONITOR_B: JSON.stringify({ url: 'https://b.example.com', name: 'Beta' }),
      MONITOR_A: JSON.stringify({ url: 'https://a.example.com', name: 'Alpha' }),
      MONITOR_F: JSON.stringify({ url: 'https://f.example.com', name: 'First', order: 1 }),
    }),
  );
  assert.deepEqual(
    monitors.map((monitor) => monitor.name),
    ['First', 'Alpha', 'Beta'],
  );
});

test('a group variable carries the order and keeps the name the monitors use', () => {
  const { groups } = loadConfig(
    vars({
      MONITOR_A: JSON.stringify({ url: 'https://example.com', group: 'Public API' }),
      GROUP_PUBLIC_API: '2',
      GROUP_INTERNAL: JSON.stringify({ order: 1 }),
    }),
  );
  assert.deepEqual(groups, { 'Public API': { order: 2 }, Internal: { order: 1 } });
});

test('a group without a usable order is ignored', () => {
  const { groups } = loadConfig(vars({ GROUP_PUBLIC: 'first', GROUP_OTHER: '' }));
  assert.deepEqual(groups, {});
});

test('site settings fall back and the theme is limited to the three values', () => {
  assert.partialDeepStrictEqual(loadConfig(vars({})).site, { title: 'Status', theme: 'auto' });
  assert.equal(loadConfig(vars({ SITE_THEME: 'dark' })).site.theme, 'dark');
  assert.equal(loadConfig(vars({ SITE_THEME: 'neon' })).site.theme, 'auto');
});

test('incident settings fall back', () => {
  assert.deepEqual(loadConfig(vars({})).incidents, { threshold: 2, labels: ['status', 'incident'] });
  assert.deepEqual(loadConfig(vars({ INCIDENT_THRESHOLD: '4', INCIDENT_LABELS: 'status, outage ,' })).incidents, {
    threshold: 4,
    labels: ['status', 'outage'],
  });
});

test('statusMatches understands codes, classes, ranges and lists', () => {
  assert.equal(statusMatches(200, '2xx'), true);
  assert.equal(statusMatches(304, '2xx'), false);
  assert.equal(statusMatches(301, '301'), true);
  assert.equal(statusMatches(204, '200-299'), true);
  assert.equal(statusMatches(400, '200-299'), false);
  assert.equal(statusMatches(301, ['2xx', '301']), true);
  assert.equal(statusMatches(500, ['2xx', '301']), false);
});

test('redact removes the url, the bare host and any address that leaked with it', () => {
  const url = 'https://intranet.example.com:8443/health';
  assert.equal(redact(`request to ${url} failed`, url), 'request to [redacted] failed');
  assert.equal(redact('getaddrinfo ENOTFOUND intranet.example.com', url), 'getaddrinfo ENOTFOUND [redacted]');
  assert.equal(redact('connect ECONNREFUSED 10.0.0.4:8443', url), 'connect ECONNREFUSED [redacted]:8443');
  assert.equal(redact('connect ECONNREFUSED [2001:db8::1]:443', url), 'connect ECONNREFUSED [redacted]:443');
  assert.equal(redact('INTRANET.EXAMPLE.COM refused', url), '[redacted] refused');
  assert.equal(redact('connect ECONNREFUSED intranet.example.com:8443', url), 'connect ECONNREFUSED [redacted]');
});

test('redact passes empty messages through', () => {
  assert.equal(redact(null, 'https://example.com'), null);
  assert.equal(redact('', 'https://example.com'), '');
});
