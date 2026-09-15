// Sends an outage or a recovery to the places a repository has configured.
//
// A target is a NOTIFY_<NAME> variable, or secret for anything carrying a
// token, and says which kind it is.
//
// Everything a receiver reads comes from the dictionary the page uses, so a
// site set to a language sounds like itself in chat as well. `t` defaults to
// English, which is what SITE_LANG defaults to.

import { english } from '../../site/lang/i18n.mjs';
import { sendMail } from './smtp.mjs';

const COLORS = { down: '#f04438', degraded: '#f79009', up: '#12b76a', cert: '#f79009' };
const MARKS = { down: '🔴', degraded: '🟠', up: '🟢', cert: '🟡' };

export const SEND_TIMEOUT = 10000;

// Every kind is named in the configuration. Nothing is read off the URL: a
// self-hosted Mattermost or Teams proxy is indistinguishable from anything
// else, and a guess that lands wrong sends a payload the receiver drops
// without saying why.
export const TARGET_TYPES = ['slack', 'mattermost', 'discord', 'teams', 'teams-connector', 'email', 'custom'];

// What every builder writes from. `event.status` is where the monitor is now,
// so a recovery is 'up' and an outage is 'down' or 'degraded'. The mark is not
// language, so it is put in front rather than kept in the dictionary.
export function headline(event, t = english.t) {
  const mark = MARKS[event.status] || '';
  if (event.status === 'cert') {
    return `${mark} ${t('notify.cert', { name: event.name, count: event.daysLeft })}`;
  }
  const key =
    event.status === 'up'
      ? event.downFor
        ? 'notify.upAfter'
        : 'notify.up'
      : event.status === 'degraded'
        ? 'notify.degraded'
        : 'notify.down';
  return `${mark} ${t(key, { name: event.name, duration: event.downFor })}`;
}

// Label and value are kept apart rather than joined and split again: a card
// wants the two separately, and a translated label is not reliably one word
// followed by a colon.
function facts(event, t) {
  return [
    event.validTo ? { label: t('field.expires'), value: event.validTo } : null,
    event.issuer ? { label: t('field.issuer'), value: event.issuer } : null,
    event.error ? { label: t('field.error'), value: event.error } : null,
    event.code ? { label: t('field.code'), value: String(event.code) } : null,
    event.url ? { label: t('field.url'), value: event.url } : null,
    event.issueUrl ? { label: t('field.issue'), value: event.issueUrl } : null,
  ].filter(Boolean);
}

const asLines = (list) => list.map(({ label, value }) => `${label}: ${value}`).join('\n');

const slackPayload = (event, t) => ({
  text: headline(event, t),
  attachments: [
    {
      color: COLORS[event.status] || COLORS.down,
      fallback: headline(event, t),
      text: asLines(facts(event, t)),
      footer: event.site,
      ts: Math.floor(new Date(event.at).getTime() / 1000),
    },
  ],
});

const discordPayload = (event, t) => ({
  embeds: [
    {
      title: headline(event, t),
      url: event.issueUrl || event.url || undefined,
      description: asLines(facts(event, t)) || undefined,
      color: Number.parseInt((COLORS[event.status] || COLORS.down).slice(1), 16),
      timestamp: event.at,
      footer: event.site ? { text: event.site } : undefined,
    },
  ],
});

// A Workflows webhook accepts an adaptive card; a retired Office 365 connector
// only ever understood a message card.
function teamsPayload(event, t, legacy) {
  const list = facts(event, t);

  if (legacy) {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor: (COLORS[event.status] || COLORS.down).slice(1),
      summary: headline(event, t),
      title: headline(event, t),
      sections: [{ facts: list.map(({ label, value }) => ({ name: label, value })) }],
    };
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', size: 'Medium', weight: 'Bolder', wrap: true, text: headline(event, t) },
            { type: 'FactSet', facts: list.map(({ label, value }) => ({ title: `${label}:`, value })) },
          ],
        },
      },
    ],
  };
}

// Nothing is assumed about a custom endpoint, so it receives the event itself.
const EVENT_NAMES = { up: 'recovered', cert: 'certificate', down: 'down', degraded: 'down' };

const customPayload = (event, t) => ({
  event: EVENT_NAMES[event.status] || 'down',
  status: event.status,
  previousStatus: event.previousStatus,
  monitor: { slug: event.slug, name: event.name, url: event.url || null },
  error: event.error || null,
  code: event.code || null,
  downFor: event.downFor || null,
  certificate: event.validTo ? { validTo: event.validTo, daysLeft: event.daysLeft, issuer: event.issuer || null } : null,
  issue: event.issueUrl ? { number: event.issueNumber, url: event.issueUrl } : null,
  site: event.site || null,
  at: event.at,
  text: headline(event, t),
});

// Slack and Mattermost speak the same webhook dialect, so one builder serves
// both.
export function buildPayload(target, event, t = english.t) {
  switch (target.type) {
    case 'slack':
    case 'mattermost':
      return slackPayload(event, t);
    case 'discord':
      return discordPayload(event, t);
    case 'teams':
      return teamsPayload(event, t, false);
    case 'teams-connector':
      return teamsPayload(event, t, true);
    default:
      return customPayload(event, t);
  }
}

// The body a mailbox gets: the same facts, without the markup a chat client
// would have rendered.
export function buildMail(target, event, t = english.t) {
  const body = [headline(event, t), '', asLines(facts(event, t))];
  if (event.site) body.push('', event.site);
  return { subject: headline(event, t), text: `${body.join('\n')}\n` };
}

// A notification is never worth failing a run over: a target that is down, slow
// or misconfigured is reported and the next one is tried.
export async function send(target, event, fetchImpl = fetch, t = english.t) {
  if (target.type === 'email') {
    // GitHub's runners are Azure VMs, where outbound port 25 is blocked. The
    // attempt is still made — a self-hosted runner is free of that — but the
    // stall that follows is worth explaining in the log first.
    if (new URL(target.url).port === '25') {
      console.log(`${target.name}: port 25 is blocked on GitHub's runners, use 587 or 465`);
    }

    const { subject, text } = buildMail(target, event, t);
    await sendMail({
      url: target.url,
      from: target.from,
      to: target.to,
      subject,
      text,
      // Only for a server presenting a certificate no public CA signed.
      tlsOptions: target.insecureTls ? { rejectUnauthorized: false } : undefined,
    });
    return true;
  }

  const body = JSON.stringify(buildPayload(target, event, t));
  const response = await fetchImpl(target.url, {
    method: target.method || 'POST',
    headers: { 'content-type': 'application/json', ...target.headers },
    body,
    signal: AbortSignal.timeout(SEND_TIMEOUT),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  return true;
}

export async function notify(targets, event, { fetchImpl = fetch, log = console.log, t = english.t } = {}) {
  let sent = 0;
  for (const target of targets) {
    if (!target.events.includes(event.status === 'up' ? 'up' : event.status)) continue;
    try {
      await send(target, event, fetchImpl, t);
      sent += 1;
      log(`notified ${target.name} (${target.type})`);
    } catch (error) {
      log(`notifying ${target.name} (${target.type}) failed: ${error.message}`);
    }
  }
  return sent;
}
