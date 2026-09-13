import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMaintenance, marker, markedMonitor, stripMarker } from '../scripts/lib/issues.mjs';

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
