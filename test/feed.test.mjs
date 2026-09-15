import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atom, escape } from '../scripts/lib/feed.mjs';
import { english } from '../site/lang/i18n.mjs';

const { t, duration } = english;

const incident = (over = {}) => ({
  number: 12,
  title: 'Documentation is down',
  state: 'closed',
  createdAt: '2026-03-01T12:00:00Z',
  closedAt: '2026-03-01T13:35:00Z',
  url: 'https://github.com/acme/status/issues/12',
  body: 'Edge node returned 502.',
  maintenance: false,
  ...over,
});

const build = (over = {}) =>
  atom({
    title: 'Acme Status',
    url: 'https://status.example.com',
    repoUrl: 'https://github.com/acme/status',
    incidents: [incident()],
    t,
    duration,
    ...over,
  });

test('the feed says what it is and where it lives', () => {
  const xml = build();
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(xml, /<title>Acme Status<\/title>/);
  assert.match(xml, /<id>https:\/\/github\.com\/acme\/status<\/id>/);
  assert.match(xml, /<link rel="self" href="https:\/\/status\.example\.com\/feed\.xml"\/>/);
  assert.match(xml, /<link rel="alternate" href="https:\/\/status\.example\.com\/"\/>/);
  assert.match(xml, /<\/feed>\n$/);
});

test('an entry is identified by the issue it came from', () => {
  const xml = build();
  assert.match(xml, /<id>https:\/\/github\.com\/acme\/status\/issues\/12<\/id>/);
  assert.match(xml, /<title>Documentation is down<\/title>/);
  assert.match(xml, /<published>2026-03-01T12:00:00Z<\/published>/);
  // Moving with the resolution is what tells a reader's client to show it again.
  assert.match(xml, /<updated>2026-03-01T13:35:00Z<\/updated>/);
  assert.match(xml, /Resolved after 1h 35m/);
  assert.match(xml, /Edge node returned 502\./);
});

test('an incident still open says so instead of claiming a duration', () => {
  const xml = build({ incidents: [incident({ state: 'open', closedAt: null })] });
  assert.match(xml, /<content type="text">Ongoing/);
  assert.doesNotMatch(xml, /Resolved after/);
  assert.match(xml, /<updated>2026-03-01T12:00:00Z<\/updated>/);
});

test('planned work is completed rather than resolved', () => {
  const xml = build({ incidents: [incident({ maintenance: true })] });
  assert.match(xml, /Completed after 1h 35m/);
});

test('the newest incident comes first, and the feed is as new as it is', () => {
  const xml = build({
    incidents: [
      incident({
        number: 1,
        title: 'Older',
        url: 'https://x/1',
        createdAt: '2026-01-01T00:00:00Z',
        closedAt: '2026-01-01T01:00:00Z',
      }),
      incident({
        number: 2,
        title: 'Newer',
        url: 'https://x/2',
        createdAt: '2026-05-01T00:00:00Z',
        closedAt: '2026-05-01T01:00:00Z',
      }),
    ],
  });
  assert.ok(xml.indexOf('Newer') < xml.indexOf('Older'));
  assert.match(xml, /<updated>2026-05-01T01:00:00Z<\/updated>\n  <entry>/);
});

test('an issue body cannot break out of the document it is quoted in', () => {
  const xml = build({
    incidents: [incident({ title: 'API & <b>docs</b> down', body: '</content><script>alert(1)</script>' })],
  });
  assert.match(xml, /<title>API &amp; &lt;b&gt;docs&lt;\/b&gt; down<\/title>/);
  assert.doesNotMatch(xml, /<script>/);
  assert.equal(xml.match(/<\/content>/g).length, 1, 'the body cannot close the element it sits in');
});

test('characters XML cannot represent are dropped rather than escaped', () => {
  const nul = String.fromCharCode(0);
  const backspace = String.fromCharCode(8);
  assert.equal(escape(`a${nul}b${backspace}c`), 'abc');
  // Tab and newline are representable, and a body full of them should survive.
  assert.equal(escape('tab\tand\nnewline'), 'tab\tand\nnewline');
});

test('a feed with nothing in it is still a feed', () => {
  const xml = build({ incidents: [], now: new Date('2026-03-01T12:00:00Z') });
  assert.match(xml, /<updated>2026-03-01T12:00:00\.000Z<\/updated>/);
  assert.doesNotMatch(xml, /<entry>/);
});

test('a site that does not know its own address still produces a valid feed', () => {
  const xml = build({ url: '' });
  assert.doesNotMatch(xml, /<link rel="self"/);
  assert.match(xml, /<id>https:\/\/github\.com\/acme\/status<\/id>/);
});

test('at most fifty entries, so the file cannot grow without bound', () => {
  const many = Array.from({ length: 80 }, (_, index) =>
    incident({
      number: index,
      url: `https://x/${index}`,
      createdAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    }),
  );
  assert.equal(build({ incidents: many }).match(/<entry>/g).length, 50);
});
