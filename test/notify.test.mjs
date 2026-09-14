import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TARGET_TYPES, buildMail, buildPayload, headline, notify } from '../scripts/lib/notify.mjs';
import { load } from '../site/lang/i18n.mjs';

const target = (type, url = 'https://example.com/hook') => ({
  name: 'Test',
  url,
  type,
  events: ['down', 'degraded', 'up'],
  headers: {},
  method: 'POST',
});

const outage = {
  slug: 'db',
  name: 'Database',
  status: 'down',
  previousStatus: 'up',
  url: 'https://db.example.com',
  error: 'connect ECONNREFUSED',
  code: 0,
  issueNumber: 42,
  issueUrl: 'https://github.com/acme/status/issues/42',
  site: 'Acme Status',
  at: '2026-03-01T12:00:00Z',
};

const recovery = { ...outage, status: 'up', error: null, code: 200, downFor: '1h 35m' };

test('every kind a destination may declare has a builder', () => {
  for (const type of TARGET_TYPES) {
    if (type === 'email') continue; // mail is built by buildMail, not buildPayload
    assert.ok(buildPayload(target(type), outage), `${type} builds a payload`);
  }
});

test('the headline says what happened', () => {
  assert.equal(headline(outage), '🔴 Database is down');
  assert.equal(headline({ ...outage, status: 'degraded' }), '🟠 Database is degraded');
  assert.equal(headline(recovery), '🟢 Database is back up after 1h 35m');
  assert.equal(headline({ ...recovery, downFor: null }), '🟢 Database is back up');
});

test('Slack and Mattermost get the same payload', () => {
  const slack = buildPayload(target('slack'), outage);
  assert.deepEqual(buildPayload(target('mattermost'), outage), slack);
  assert.equal(slack.text, '🔴 Database is down');
  assert.equal(slack.attachments[0].color, '#f04438');
  assert.match(slack.attachments[0].text, /connect ECONNREFUSED/);
  assert.match(slack.attachments[0].text, /issues\/42/);
});

test('a recovery is green', () => {
  assert.equal(buildPayload(target('slack'), recovery).attachments[0].color, '#12b76a');
  assert.equal(buildPayload(target('discord'), recovery).embeds[0].color, 0x12b76a);
});

test('Discord gets an embed that links to the issue', () => {
  const payload = buildPayload(target('discord'), outage);
  assert.equal(payload.embeds[0].title, '🔴 Database is down');
  assert.equal(payload.embeds[0].url, 'https://github.com/acme/status/issues/42');
  assert.equal(payload.embeds[0].color, 0xf04438);
  assert.equal(payload.embeds[0].timestamp, '2026-03-01T12:00:00Z');
});

test('a fact keeps its label apart from its value', () => {
  // The label used to be recovered by splitting on ": ", which a translated
  // label is under no obligation to survive.
  const card = buildPayload(target('teams'), { ...outage, error: 'read ETIMEDOUT: after 10s' });
  assert.deepEqual(card.attachments[0].content.body[1].facts[0], {
    title: 'Error:',
    value: 'read ETIMEDOUT: after 10s',
  });
});

test('a site with a language sends in it', async () => {
  const { t } = await load('de');
  assert.equal(headline(outage, t), '🔴 Database ist ausgefallen');
  assert.equal(headline(recovery, t), '🟢 Database ist wieder erreichbar nach 1h 35m');
  assert.equal(headline({ ...outage, status: 'degraded' }, t), '🟠 Database ist beeinträchtigt');

  const slack = buildPayload(target('slack'), outage, t);
  assert.equal(slack.text, '🔴 Database ist ausgefallen');
  assert.match(slack.attachments[0].text, /^Fehler: connect ECONNREFUSED$/m);

  const card = buildPayload(target('teams'), outage, t).attachments[0].content;
  assert.deepEqual(card.body[1].facts[0], { title: 'Fehler:', value: 'connect ECONNREFUSED' });

  const mail = buildMail(target('email'), outage, t);
  assert.equal(mail.subject, '🔴 Database ist ausgefallen');
  assert.match(mail.text, /^Fehler: connect ECONNREFUSED$/m);
  assert.match(mail.text, /^URL: https:\/\/db\.example\.com$/m);
});

test('the event a custom endpoint receives stays in the field names it knows', async () => {
  const { t } = await load('de');
  const payload = buildPayload(target('custom'), outage, t);
  // Translating the keys would break every receiver; only the prose moves.
  assert.equal(payload.event, 'down');
  assert.equal(payload.status, 'down');
  assert.equal(payload.text, '🔴 Database ist ausgefallen');
});

test('Teams gets an adaptive card', () => {
  const payload = buildPayload(target('teams', 'https://prod-12.westeurope.logic.azure.com/workflows/x'), outage);
  assert.equal(payload.type, 'message');
  const card = payload.attachments[0].content;
  assert.equal(card.type, 'AdaptiveCard');
  assert.equal(card.body[0].text, '🔴 Database is down');
  assert.deepEqual(card.body[1].facts[0], { title: 'Error:', value: 'connect ECONNREFUSED' });
});

test('a retired Office 365 connector still gets a message card', () => {
  const payload = buildPayload(target('teams-connector', 'https://acme.webhook.office.com/webhookb2/x'), outage);
  assert.equal(payload['@type'], 'MessageCard');
  assert.equal(payload.themeColor, 'f04438');
  assert.deepEqual(payload.sections[0].facts[0], { name: 'Error', value: 'connect ECONNREFUSED' });
});

test('a custom endpoint receives the event itself', () => {
  const payload = buildPayload(target('custom'), outage);
  assert.partialDeepStrictEqual(payload, {
    event: 'down',
    status: 'down',
    previousStatus: 'up',
    monitor: { slug: 'db', name: 'Database', url: 'https://db.example.com' },
    error: 'connect ECONNREFUSED',
    issue: { number: 42, url: 'https://github.com/acme/status/issues/42' },
    at: '2026-03-01T12:00:00Z',
  });
  assert.equal(buildPayload(target('custom'), recovery).event, 'recovered');
});

test('a private monitor sends no URL it was not given', () => {
  const payload = buildPayload(target('custom'), { ...outage, url: null });
  assert.equal(payload.monitor.url, null);
  assert.doesNotMatch(JSON.stringify(payload), /db\.example\.com/);
});

test('a target only hears about the events it asked for', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => '' };
  };
  const targets = [
    { ...target('slack', 'https://hooks.slack.com/a'), events: ['down'] },
    { ...target('slack', 'https://hooks.slack.com/b'), events: ['up'] },
  ];
  await notify(targets, outage, { fetchImpl, log: () => {} });
  assert.deepEqual(calls, ['https://hooks.slack.com/a']);

  calls.length = 0;
  await notify(targets, recovery, { fetchImpl, log: () => {} });
  assert.deepEqual(calls, ['https://hooks.slack.com/b']);
});

test('one failing target does not stop the others, or the run', async () => {
  const logged = [];
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1) throw new Error('socket hang up');
    if (call === 2) return { ok: false, status: 404, text: async () => 'no_such_hook' };
    return { ok: true, status: 200, text: async () => '' };
  };
  const targets = [target('slack'), target('discord'), target('custom')];
  const sent = await notify(targets, outage, { fetchImpl, log: (line) => logged.push(line) });

  assert.equal(sent, 1, 'the third target still went out');
  assert.match(logged[0], /failed: socket hang up/);
  assert.match(logged[1], /failed: 404 no_such_hook/);
});
