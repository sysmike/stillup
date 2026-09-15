import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_MONITORS_HEADING,
  DEFAULT_WINDOW_HEADING,
  affectedMonitors,
  isMaintenance,
  marker,
  markedMonitor,
  stripMarker,
  windowStart,
} from '../scripts/lib/issues.mjs';

const issue = (labels, body = '') => ({ labels: labels.map((name) => ({ name })), body });

test('the marker names the monitor an issue belongs to', () => {
  assert.equal(marker('backup-mx'), '<!-- monitor:backup-mx -->');
  assert.equal(markedMonitor(`${marker('backup-mx')}\nBackup MX stopped responding.`), 'backup-mx');
  assert.equal(markedMonitor('Filed by hand'), null);
  assert.equal(markedMonitor(null), null);
});

test('the marker is stripped before the page renders a body', () => {
  assert.equal(stripMarker(`${marker('api')}\nText`).trim(), 'Text');
  assert.equal(stripMarker(null), '');
});

test('an issue filed through the template is maintenance', () => {
  assert.equal(isMaintenance(issue(['status', 'maintenance'], '### Window\n\nTonight')), true);
});

test('an outage the workflow opened is never maintenance, however it is labelled', () => {
  const opened = issue(['status', 'incident', 'maintenance'], `${marker('backupmx')}\nBackup MX is down`);
  assert.equal(isMaintenance(opened), false);
});

test('an ordinary incident is not maintenance', () => {
  assert.equal(isMaintenance(issue(['status', 'incident'], `${marker('api')}\ndown`)), false);
  assert.equal(isMaintenance(issue(['status'], 'Filed by hand')), false);
});

test('labels may arrive as plain strings', () => {
  assert.equal(isMaintenance({ labels: ['status', 'maintenance'], body: 'Planned' }), true);
  assert.equal(isMaintenance({ labels: [], body: '' }), false);
});

const monitors = [
  { slug: 'api', name: 'Public API' },
  { slug: 'docs', name: 'Documentation' },
];

const filed = (heading, value) => `### Window\n\nTonight\n\n### ${heading}\n\n${value}\n\n### Notes\n\nNone`;

test('the template names its monitors under the heading the form writes', () => {
  assert.deepEqual(affectedMonitors(filed(DEFAULT_MONITORS_HEADING, 'Public API, docs'), monitors), ['api', 'docs']);
  assert.deepEqual(affectedMonitors(filed(DEFAULT_MONITORS_HEADING, 'Nothing we monitor'), monitors), []);
});

test('a renamed heading is found once it is configured', () => {
  const body = filed('Betroffene Monitore', 'Public API');
  assert.deepEqual(affectedMonitors(body, monitors, 'Betroffene Monitore'), ['api']);
  // The point of the setting: left at the default, the section is not seen.
  assert.deepEqual(affectedMonitors(body, monitors), []);
});

test('a heading is matched as text, not as a pattern', () => {
  const body = filed('Affected monitor(s)', 'docs');
  assert.deepEqual(affectedMonitors(body, monitors, 'Affected monitor(s)'), ['docs']);
  assert.deepEqual(affectedMonitors(filed('Affected monitors', 'docs'), monitors, 'Affected monitor(s)'), []);
});

test('a field left empty names nothing', () => {
  assert.deepEqual(affectedMonitors(filed(DEFAULT_MONITORS_HEADING, '_No response_'), monitors), []);
  assert.deepEqual(affectedMonitors(null, monitors), []);
});

test('an issue the workflow opened is linked by its marker alone', () => {
  assert.deepEqual(affectedMonitors(`${marker('api')}\nPublic API is down`, monitors), ['api']);
});

// The translated template and the instructions for it are edited apart, and a
// mismatch between them shows up as monitors quietly not linking.
const labelOf = (file, field) =>
  readFileSync(new URL(file, import.meta.url), 'utf8').match(
    new RegExp(`id: ${field}\\n\\s+attributes:\\n\\s+label: (.+)`),
  )?.[1];

test('the English template names the heading the parser looks for by default', () => {
  const label = labelOf('../.github/ISSUE_TEMPLATE/maintenance.yml', 'monitors');
  assert.equal(label, DEFAULT_MONITORS_HEADING);
});

test('the German template works with the heading its instructions name', () => {
  const file = '../docs/maintenance.de.yml';
  const label = labelOf(file, 'monitors');
  assert.equal(label, 'Betroffene Monitore');

  const told = readFileSync(new URL(file, import.meta.url), 'utf8').match(/MONITORS_HEADING auf "([^"]+)"/)?.[1];
  assert.equal(told, label, 'the file tells the reader to set a heading it does not use');

  const body = `### Zeitfenster\n\nHeute Nacht\n\n### ${label}\n\nPublic API`;
  assert.deepEqual(affectedMonitors(body, monitors, label), ['api']);
});

test('the window says when planned work starts', () => {
  const body = (window) => `### Window\n\n${window}\n\n### Expected impact\n\nBriefly slower`;
  assert.equal(windowStart(body('2026-03-14 02:00 - 04:00 UTC')), '2026-03-14T02:00:00.000Z');
  assert.equal(windowStart(body('2026-03-14')), '2026-03-14T00:00:00.000Z');
  assert.equal(windowStart(body('2026-03-14T02:00Z')), '2026-03-14T02:00:00.000Z');
  assert.equal(windowStart(body('  2026-03-14 2:05 until whenever ')), '2026-03-14T02:05:00.000Z');
});

test('a window nobody can read leaves the entry where it was', () => {
  const body = (window) => `### Window\n\n${window}`;
  // Free text, so most of what can be written in it is not a date at all. The
  // entry stays listed as it would have been before any of this existed.
  assert.equal(windowStart(body('next Tuesday')), null);
  assert.equal(windowStart(body('14 Mar 2026')), null);
  assert.equal(windowStart(body('_No response_')), null);
  assert.equal(windowStart('### Expected impact\n\nNo window given'), null);
  assert.equal(windowStart(null), null);
});

test('a date that does not exist is not one', () => {
  const body = (window) => `### Window\n\n${window}`;
  // Date.UTC rolls these forward rather than refusing them.
  assert.equal(windowStart(body('2026-13-01')), null);
  assert.equal(windowStart(body('2026-02-30')), null);
  assert.equal(windowStart(body('2026-02-28')), '2026-02-28T00:00:00.000Z');
});

test('a translated form is read once its heading is named', () => {
  const body = '### Zeitfenster\n\n2026-03-14 02:00 UTC';
  assert.equal(windowStart(body, 'Zeitfenster'), '2026-03-14T02:00:00.000Z');
  assert.equal(windowStart(body), null, 'the default heading is not in this issue');
});

test('both templates name the window heading their instructions expect', () => {
  assert.equal(labelOf('../.github/ISSUE_TEMPLATE/maintenance.yml', 'window'), DEFAULT_WINDOW_HEADING);

  const file = '../docs/maintenance.de.yml';
  const label = labelOf(file, 'window');
  assert.equal(label, 'Zeitfenster');
  const told = readFileSync(new URL(file, import.meta.url), 'utf8').match(/WINDOW_HEADING auf "([^"]+)"/)?.[1];
  assert.equal(told, label, 'the file tells the reader to set a heading it does not use');
});
