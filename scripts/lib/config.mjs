// Reads monitor and site configuration out of GitHub Actions variables and
// secrets.
//
// Every monitor is its own repository variable named MONITOR_<SLUG>. The value
// is either a bare URL or a JSON object with per-monitor options. An http(s)
// URL is requested, a tcp://host:port URL is checked by opening a connection,
// and a ping://host URL is checked with an ICMP echo. A monitor
// defined as a secret instead of a variable is private by default: its URL is
// kept out of the published site and out of incident issues.

const MONITOR_PREFIX = 'MONITOR_';
const GROUP_PREFIX = 'GROUP_';

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

// A group is compact when collapsed: true always, false never, 'auto' when the
// site rule says so.
function normalizeCompact(value) {
  const word = String(value).trim().toLowerCase();
  if (['true', 'always', 'compact', 'yes'].includes(word)) return true;
  if (['false', 'never', 'expanded', 'no'].includes(word)) return false;
  return 'auto';
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
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }
  let result = text.split(url).join('[redacted]');
  if (host) result = result.replace(new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[redacted]');
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
    const type = parsed.url.startsWith('tcp://')
      ? 'tcp'
      : parsed.url.startsWith('ping://')
        ? 'ping'
        : 'http';
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

  // GROUP_<NAME> overrides the site rule for one group.
  const groups = {};
  for (const [name, raw] of Object.entries({ ...vars, ...secrets })) {
    if (!name.startsWith(GROUP_PREFIX)) continue;
    const value = raw.trim();
    if (!value) continue;
    const parsed = value.startsWith('{') ? JSON.parse(value) : { compact: value };
    const slug = slugify(name.slice(GROUP_PREFIX.length));
    const match = monitors.find((monitor) => monitor.group && slugify(monitor.group) === slug);
    groups[match?.group || titleize(slug)] = { compact: normalizeCompact(parsed.compact) };
  }

  const compact = String(vars.SITE_GROUP_COMPACT || 'auto').trim().toLowerCase();
  const site = {
    groupCompact: /^\d+$/.test(compact)
      ? { mode: 'auto', threshold: Number(compact) }
      : { mode: ['always', 'never'].includes(compact) ? compact : 'auto', threshold: 4 },
    title: vars.SITE_TITLE || 'Status',
    description: vars.SITE_DESCRIPTION || '',
    link: vars.SITE_LINK || '',
    logo: vars.SITE_LOGO || '',
    theme: vars.SITE_THEME === 'light' ? 'light' : vars.SITE_THEME === 'dark' ? 'dark' : 'auto',
  };

  const incidents = {
    threshold: Number(vars.INCIDENT_THRESHOLD || 2),
    labels: (vars.INCIDENT_LABELS || 'status,incident')
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean),
  };

  return { site, groups, monitors, incidents };
}
