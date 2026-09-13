// Sends an outage or a recovery to the places a repository has configured.
//
// A target is a NOTIFY_<NAME> variable, or secret for anything carrying a
// token. Its kind follows from the URL, so a Slack or Discord webhook needs no
// further configuration; a self-hosted Mattermost says so explicitly.

import { sendMail } from './smtp.mjs';

const COLORS = { down: '#f04438', degraded: '#f79009', up: '#12b76a' };
const MARKS = { down: '🔴', degraded: '🟠', up: '🟢' };

export const SEND_TIMEOUT = 10000;

// Every kind is named in the configuration. Nothing is read off the URL: a
// self-hosted Mattermost or Teams proxy is indistinguishable from anything
// else, and a guess that lands wrong sends a payload the receiver drops
// without saying why.
export const TARGET_TYPES = ['slack', 'mattermost', 'discord', 'teams', 'teams-connector', 'email', 'custom'];

// What every builder writes from. `event.status` is where the monitor is now,
// so a recovery is 'up' and an outage is 'down' or 'degraded'.
export function headline(event) {
  const mark = MARKS[event.status] || '';
  if (event.status === 'up') {
    return `${mark} ${event.name} is back up${event.downFor ? ` after ${event.downFor}` : ''}`;
  }
  return `${mark} ${event.name} is ${event.status === 'degraded' ? 'degraded' : 'down'}`;
}

function lines(event) {
  return [
    event.error ? `Error: ${event.error}` : null,
    event.code ? `Response code: ${event.code}` : null,
    event.url ? `URL: ${event.url}` : null,
    event.issueUrl ? `Issue: ${event.issueUrl}` : null,
  ].filter(Boolean);
}

const slackPayload = (event) => ({
  text: headline(event),
  attachments: [
    {
      color: COLORS[event.status] || COLORS.down,
      fallback: headline(event),
      text: lines(event).join('\n'),
      footer: event.site,
      ts: Math.floor(new Date(event.at).getTime() / 1000),
    },
  ],
});

const discordPayload = (event) => ({
  embeds: [
    {
      title: headline(event),
      url: event.issueUrl || event.url || undefined,
      description: lines(event).join('\n') || undefined,
      color: Number.parseInt((COLORS[event.status] || COLORS.down).slice(1), 16),
      timestamp: event.at,
      footer: event.site ? { text: event.site } : undefined,
    },
  ],
});

// A Workflows webhook accepts an adaptive card; a retired Office 365 connector
// only ever understood a message card.
function teamsPayload(event, legacy) {
  const facts = lines(event).map((line) => {
    const [name, ...rest] = line.split(': ');
    return { name, value: rest.join(': ') };
  });

  if (legacy) {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor: (COLORS[event.status] || COLORS.down).slice(1),
      summary: headline(event),
      title: headline(event),
      sections: [{ facts }],
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
            { type: 'TextBlock', size: 'Medium', weight: 'Bolder', wrap: true, text: headline(event) },
            { type: 'FactSet', facts: facts.map(({ name, value }) => ({ title: `${name}:`, value })) },
          ],
        },
      },
    ],
  };
}

// Nothing is assumed about a custom endpoint, so it receives the event itself.
const customPayload = (event) => ({
  event: event.status === 'up' ? 'recovered' : 'down',
  status: event.status,
  previousStatus: event.previousStatus,
  monitor: { slug: event.slug, name: event.name, url: event.url || null },
  error: event.error || null,
  code: event.code || null,
  downFor: event.downFor || null,
  issue: event.issueUrl ? { number: event.issueNumber, url: event.issueUrl } : null,
  site: event.site || null,
  at: event.at,
  text: headline(event),
});

// Slack and Mattermost speak the same webhook dialect, so one builder serves
// both.
export function buildPayload(target, event) {
  switch (target.type) {
    case 'slack':
    case 'mattermost':
      return slackPayload(event);
    case 'discord':
      return discordPayload(event);
    case 'teams':
      return teamsPayload(event, false);
    case 'teams-connector':
      return teamsPayload(event, true);
    default:
      return customPayload(event);
  }
}

// The body a mailbox gets: the same facts, without the markup a chat client
// would have rendered.
export function buildMail(target, event) {
  const body = [headline(event), '', ...lines(event)];
  if (event.site) body.push('', event.site);
  return { subject: headline(event), text: `${body.join('\n')}\n` };
}

// A notification is never worth failing a run over: a target that is down, slow
// or misconfigured is reported and the next one is tried.
export async function send(target, event, fetchImpl = fetch) {
  if (target.type === 'email') {
    // GitHub's runners are Azure VMs, where outbound port 25 is blocked. The
    // attempt is still made — a self-hosted runner is free of that — but the
    // stall that follows is worth explaining in the log first.
    if (new URL(target.url).port === '25') {
      console.log(`${target.name}: port 25 is blocked on GitHub's runners, use 587 or 465`);
    }

    const { subject, text } = buildMail(target, event);
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

  const body = JSON.stringify(buildPayload(target, event));
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

export async function notify(targets, event, { fetchImpl = fetch, log = console.log } = {}) {
  let sent = 0;
  for (const target of targets) {
    if (!target.events.includes(event.status === 'up' ? 'up' : event.status)) continue;
    try {
      await send(target, event, fetchImpl);
      sent += 1;
      log(`notified ${target.name} (${target.type})`);
    } catch (error) {
      log(`notifying ${target.name} (${target.type}) failed: ${error.message}`);
    }
  }
  return sent;
}
