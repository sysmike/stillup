// Reads monitor and site configuration out of GitHub Actions variables and
// secrets.
//
// Every monitor is its own repository variable named MONITOR_<SLUG>. The value
// is either a bare URL or a JSON object with per-monitor options. An http(s)
// URL is requested, a tcp://host:port URL is checked by opening a connection,
// a ping://host URL is checked with an ICMP echo, and a dummy:// URL is
// reported up without anything being checked. A monitor
// defined as a secret instead of a variable is private by default: its URL is
// kept out of the published site and out of incident issues.

import { MAINTENANCE_LABEL } from './issues.mjs';
import { TARGET_TYPES } from './notify.mjs';

const MONITOR_PREFIX = 'MONITOR_';
const GROUP_PREFIX = 'GROUP_';
const NOTIFY_PREFIX = 'NOTIFY_';
const NOTIFY_EVENTS = ['down', 'degraded', 'up'];
const DEFAULT_INCIDENT_LABELS = ['status', 'incident'];

const DEFAULTS = {
  method: 'GET',
  timeout: 10000,
  retries: 1,
  degradedMs: 0,
  expectedStatus: '2xx',
  followRedirects: true,
};

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleize(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseValue(name, raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Variable ${name} is not valid JSON: ${error.message}`);
    }
  }
  return { url: trimmed };
}

function normalizeExpected(expected) {
  const list = Array.isArray(expected) ? expected : [expected];
  return list.map((entry) => String(entry).toLowerCase());
}

export function statusMatches(code, expected) {
  return normalizeExpected(expected).some((pattern) => {
    if (/^\d{3}$/.test(pattern)) return Number(pattern) === code;
    if (/^\dxx$/.test(pattern)) return Math.floor(code / 100) === Number(pattern[0]);
    if (pattern.includes('-')) {
      const [low, high] = pattern.split('-').map(Number);
      return code >= low && code <= high;
    }
    return false;
  });
}

// Replaces every occurrence of a private URL, and of its host on its own, with
// a placeholder. Network errors quote the host, so the message needs scrubbing
// before it reaches an issue.
export function redact(text, url) {
  if (!text) return text;
  let hosts = [];
  try {
    const parsed = new URL(url);
    // host carries the port, hostname does not: a DNS failure quotes the bare
    // name, a refused connection quotes the pair. Longest first, so the pair
    // collapses into one placeholder instead of leaving the port behind.
    hosts = [...new Set([parsed.host, parsed.hostname])].filter(Boolean).sort((a, b) => b.length - a.length);
  } catch {
    hosts = [];
  }
  let result = text.split(url).join('[redacted]');
  for (const host of hosts) {
    result = result.replace(new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[redacted]');
  }
  // Connection errors quote the resolved address rather than the host name.
  return result.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b|\[[0-9a-f:]+\]/gi, '[redacted]');
}

// `vars` and `secrets` are the JSON serializations of the Actions contexts of
// the same name.
export function loadConfig(varsJson, secretsJson) {
  const vars = JSON.parse(varsJson || '{}');
  const secrets = JSON.parse(secretsJson || '{}');
  const monitors = [];

  for (const [name, raw] of Object.entries({ ...vars, ...secrets })) {
    if (!name.startsWith(MONITOR_PREFIX)) continue;
    const parsed = parseValue(name, raw);
    if (!parsed) continue;
    if (!parsed.url) throw new Error(`Variable ${name} has no url`);

    const slug = slugify(parsed.slug || name.slice(MONITOR_PREFIX.length));
    const type = ['tcp', 'ping', 'dummy'].find((scheme) => parsed.url.startsWith(`${scheme}://`)) || 'http';
    if (type === 'tcp' && !new URL(parsed.url).port) {
      throw new Error(`Monitor ${name} needs a port, for example tcp://example.com:443`);
    }
    // The host reaches the ping binary as an argument, so anything that could
    // pass for an option is rejected rather than escaped.
    if (type === 'ping' && !/^[a-z0-9][a-z0-9.:_-]*$/i.test(new URL(parsed.url).hostname.replace(/^\[|\]$/g, ''))) {
      throw new Error(`Monitor ${name} has an unusable host, expected ping://example.com`);
    }

    monitors.push({
      ...DEFAULTS,
      ...parsed,
      slug,
      type,
      name: parsed.name || titleize(slug),
      method: String(parsed.method || DEFAULTS.method).toUpperCase(),
      group: parsed.group || null,
      description: parsed.description || null,
      headers: parsed.headers || {},
      link: parsed.link || null,
      private: parsed.private ?? Object.hasOwn(secrets, name),
    });
  }

  monitors.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));

  // GROUP_<NAME> sets where one group sits: a bare number, or JSON with order.
  const groups = {};
  for (const [name, raw] of Object.entries({ ...vars, ...secrets })) {
    if (!name.startsWith(GROUP_PREFIX)) continue;
    const value = raw.trim();
    if (!value) continue;
    const parsed = value.startsWith('{') ? JSON.parse(value) : { order: value };
    const order = Number(parsed.order);
    if (!Number.isFinite(order)) continue;
    const slug = slugify(name.slice(GROUP_PREFIX.length));
    const match = monitors.find((monitor) => monitor.group && slugify(monitor.group) === slug);
    groups[match?.group || titleize(slug)] = { order };
  }

  // NOTIFY_<NAME> is a webhook URL, or JSON when the kind cannot be read off
  // the URL — a self-hosted Mattermost — or when only some events are wanted.
  const notifications = [];
  for (const [name, raw] of Object.entries({ ...vars, ...secrets })) {
    if (!name.startsWith(NOTIFY_PREFIX)) continue;
    const parsed = parseValue(name, raw);
    if (!parsed) continue;
    if (!parsed.url) throw new Error(`Variable ${name} has no url`);

    const events = (Array.isArray(parsed.events) ? parsed.events : NOTIFY_EVENTS)
      .map((event) => String(event).toLowerCase())
      .filter((event) => NOTIFY_EVENTS.includes(event));

    // A destination says what it is. Only the URL scheme of a mailbox is
    // unambiguous enough to stand in for that; everything else without a type
    // is a plain webhook receiving the event as JSON.
    const type = parsed.type
      ? String(parsed.type).toLowerCase()
      : /^smtps?:/i.test(parsed.url)
        ? 'email'
        : 'custom';
    if (!TARGET_TYPES.includes(type)) {
      throw new Error(`Variable ${name} has an unknown type "${type}", expected one of ${TARGET_TYPES.join(', ')}`);
    }

    // A mailbox needs recipients, and a sender the server will accept. The
    // login name stands in for the sender when it is an address itself.
    let to = [];
    let from = parsed.from || '';
    if (type === 'email') {
      to = (Array.isArray(parsed.to) ? parsed.to : String(parsed.to || '').split(','))
        .map((address) => address.trim())
        .filter(Boolean);
      if (!to.length) throw new Error(`Variable ${name} has no recipient, add "to"`);
      if (!from) {
        const login = decodeURIComponent(new URL(parsed.url).username || '');
        if (!login.includes('@')) throw new Error(`Variable ${name} has no sender, add "from"`);
        from = login;
      }
    }

    notifications.push({
      name: titleize(slugify(name.slice(NOTIFY_PREFIX.length))),
      url: parsed.url,
      type,
      events: events.length ? events : NOTIFY_EVENTS,
      headers: parsed.headers || {},
      method: String(parsed.method || 'POST').toUpperCase(),
      ...(type === 'email' ? { to, from, insecureTls: parsed.insecureTls === true } : {}),
    });
  }
  notifications.sort((a, b) => a.name.localeCompare(b.name));

  const site = {
    title: vars.SITE_TITLE || 'Status',
    description: vars.SITE_DESCRIPTION || '',
    link: vars.SITE_LINK || '',
    logo: vars.SITE_LOGO || '',
    theme: vars.SITE_THEME === 'light' ? 'light' : vars.SITE_THEME === 'dark' ? 'dark' : 'auto',
  };

  // The maintenance label marks planned work, so an automatic incident must
  // never carry it however INCIDENT_LABELS is written.
  const labels = (vars.INCIDENT_LABELS || DEFAULT_INCIDENT_LABELS.join(','))
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label && label !== MAINTENANCE_LABEL);

  const incidents = {
    threshold: Number(vars.INCIDENT_THRESHOLD || 2),
    labels: labels.length ? labels : DEFAULT_INCIDENT_LABELS,
  };

  return { site, groups, monitors, incidents, notifications };
}
