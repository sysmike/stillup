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

import { LANGUAGES } from '../../site/lang/i18n.mjs';
import { DEFAULT_MONITORS_HEADING, DEFAULT_WINDOW_HEADING, MAINTENANCE_LABEL } from './issues.mjs';
import { TARGET_TYPES } from './notify.mjs';

const MONITOR_PREFIX = 'MONITOR_';
const GROUP_PREFIX = 'GROUP_';
const NOTIFY_PREFIX = 'NOTIFY_';
const NOTIFY_EVENTS = ['down', 'degraded', 'up', 'cert'];
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

// SITE_SCRIPTS adds tags to the page's head: an analytics snippet, most often.
// A bare URL is the whole of the common case; an object carries the attributes
// a vendor asks for alongside it, and a list adds more than one.
//
// Whoever sets this can already commit to the repository that builds the page,
// so the question is not whether they may run a script but whether a mistake in
// one fails loudly. It is checked here so a typo stops the build rather than
// quietly producing a page that no longer works.
const ATTRIBUTE = /^[A-Za-z][A-Za-z0-9:_.-]*$/;
const RESERVED = new Set(['code']);

function scripts(raw) {
  const value = (raw || '').trim();
  if (!value) return [];

  let parsed;
  try {
    parsed = value.startsWith('[') || value.startsWith('{') ? JSON.parse(value) : { src: value };
  } catch (error) {
    throw new Error(`Variable SITE_SCRIPTS is not valid JSON: ${error.message}`);
  }

  return (Array.isArray(parsed) ? parsed : [parsed]).map((entry, index) => {
    const at = `SITE_SCRIPTS[${index}]`;
    const script = typeof entry === 'string' ? { src: entry } : entry;
    if (!script || typeof script !== 'object') throw new Error(`${at} is not a URL or an object`);
    if (!script.src && !script.code) throw new Error(`${at} has neither "src" nor "code"`);

    if (script.src) {
      // Resolved against a base, so a path to a script committed under site/ is
      // as acceptable as a vendor's absolute URL, while a javascript: or data:
      // src still shows itself for what it is — in a page built from a
      // repository variable that is a mistake far more often than a plan.
      let url;
      try {
        url = new URL(script.src, 'https://example.invalid/');
      } catch {
        throw new Error(`${at} has an unusable src "${script.src}"`);
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`${at} has a ${url.protocol} src, expected http, https or a path`);
      }
    }

    // The closing tag ends the element wherever it appears, including inside a
    // string, so an inline script carrying one would cut the page in half.
    if (script.code && /<\/script/i.test(script.code)) {
      throw new Error(`${at} has "</script" in its code, which would end the tag early`);
    }

    for (const name of Object.keys(script)) {
      if (RESERVED.has(name)) continue;
      if (!ATTRIBUTE.test(name)) throw new Error(`${at} has an unusable attribute name "${name}"`);
    }
    return script;
  });
}

function siteUrl(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Variable SITE_URL is not a URL: "${raw}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Variable SITE_URL is ${url.protocol}, expected http or https`);
  }
  // Stored without its trailing slash, so joining a path to it is unambiguous.
  return url.href.replace(/\/+$/, '');
}

// A language the site has no dictionary for would leave the page in English
// with no explanation, so it is refused while the site is being built.
function language(value) {
  const lang = (value || '').trim();
  if (!lang) return 'en';
  if (!LANGUAGES.includes(lang)) {
    throw new Error(`Variable SITE_LANG is "${lang}", expected one of ${LANGUAGES.join(', ')}`);
  }
  return lang;
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
      // An https monitor presents a certificate as a matter of course. A tcp
      // one may or may not, and its port is no evidence either way, so it says
      // so itself — implicit TLS only, not STARTTLS.
      cert: parsed.cert ?? (type === 'http' && parsed.url.startsWith('https://')),
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
    // The language the page's own text is written in, which is what decides its
    // labels and how dates and durations are worded. Times are still shown in
    // the reader's zone, whatever this says.
    lang: language(vars.SITE_LANG),
    description: vars.SITE_DESCRIPTION || '',
    link: vars.SITE_LINK || '',
    logo: vars.SITE_LOGO || '',
    theme: vars.SITE_THEME === 'light' ? 'light' : vars.SITE_THEME === 'dark' ? 'dark' : 'auto',
    // Where the page will be served from, which nothing in the repository knows
    // once a custom domain is involved. Only the feed needs it, and the feed is
    // still valid without it.
    url: siteUrl(vars.SITE_URL),
    // Not read from secrets: whatever goes here ends up in the page's source,
    // where a reader can see it, so a secret would only be one by accident.
    scripts: scripts(vars.SITE_SCRIPTS),
  };

  // The maintenance label marks planned work, so an automatic incident must
  // never carry it however INCIDENT_LABELS is written.
  const labels = (vars.INCIDENT_LABELS || DEFAULT_INCIDENT_LABELS.join(','))
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label && label !== MAINTENANCE_LABEL);

  // Days before a certificate runs out that are worth hearing about. Zero
  // turns the warnings off along with the probe behind them.
  const certWarnDays = Math.max(0, Number(vars.CERT_WARN_DAYS ?? 14));
  if (!Number.isFinite(certWarnDays)) throw new Error('Variable CERT_WARN_DAYS is not a number');

  // Minutes without a check before the page stops vouching for what it shows.
  // Six missed runs at the default five minute schedule, which leaves room for
  // the drift a cron on a shared runner has anyway. Zero turns the warning off,
  // for a repository that deliberately checks rarely.
  const staleAfter = Math.max(0, Number(vars.STALE_AFTER ?? 30));
  if (!Number.isFinite(staleAfter)) throw new Error('Variable STALE_AFTER is not a number');

  const incidents = {
    threshold: Number(vars.INCIDENT_THRESHOLD || 2),
    labels: labels.length ? labels : DEFAULT_INCIDENT_LABELS,
    // Must match the label on the maintenance form's monitors field, which is
    // what GitHub turns into the heading this is looked for under.
    monitorsHeading: (vars.MONITORS_HEADING || '').trim() || DEFAULT_MONITORS_HEADING,
    // Likewise the window field, which decides whether planned work is
    // happening or still to come.
    windowHeading: (vars.WINDOW_HEADING || '').trim() || DEFAULT_WINDOW_HEADING,
  };

  return { site, groups, monitors, incidents, notifications, staleAfter, certWarnDays };
}
