// How an issue is read back: which monitor it belongs to, and whether it is
// planned maintenance or an outage.

// Reserved. The maintenance issue template applies it and the page renders
// anything carrying it as planned work, so it is never applied to an incident.
export const MAINTENANCE_LABEL = 'maintenance';

const MARKER = /<!-- monitor:([a-z0-9-]+) -->/;

export const marker = (slug) => `<!-- monitor:${slug} -->`;

export const markedMonitor = (body) => (body || '').match(MARKER)?.[1] || null;

export const stripMarker = (body) => (body || '').replace(new RegExp(MARKER, 'g'), '');

// An issue this workflow opened carries the marker, and it only opens issues
// for monitors that stopped answering. Such an issue is an outage whatever
// labels it ended up with, which keeps a stray maintenance label from
// presenting an outage as planned work.
export function isMaintenance(issue) {
  const labels = (issue.labels || []).map((label) => label.name ?? label);
  return labels.includes(MAINTENANCE_LABEL) && !markedMonitor(issue.body);
}

// GitHub renders an issue form's field as a heading taken from its label, so
// the section naming the affected monitors is found by that label's text. A
// translated form renames the heading with it, which is why the name is
// configuration (MONITORS_HEADING) rather than a literal: get the two out of
// step and monitors stop linking, silently.
export const DEFAULT_MONITORS_HEADING = 'Affected monitors';

// A heading is written by a human and lands in a pattern, so anything that
// would otherwise be read as syntax is escaped.
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The maintenance form asks for a window, and it is worth reading: work
// announced for next Tuesday should not sit under Active all week. Like the
// monitors field, GitHub renders the heading from the field's label, so a
// translated form renames it and WINDOW_HEADING follows.
export const DEFAULT_WINDOW_HEADING = 'Window';

// Written by hand into a free text field, so only what the form asks for is
// understood: a date, optionally a time, read as UTC because that is what the
// field says. Anything else reads as no window at all, which leaves the entry
// where it was before this could be read.
const WINDOW = /(\d{4})-(\d{2})-(\d{2})(?:[T ]+(\d{1,2}):(\d{2}))?/;

export function windowStart(body, heading = DEFAULT_WINDOW_HEADING) {
  const pattern = new RegExp(`###\\s*${escape(heading)}\\s*\\n+([^\\n#]+)`, 'i');
  const section = (body || '').match(pattern)?.[1];
  const found = (section || '').match(WINDOW);
  if (!found) return null;

  const [, year, month, day, hour = '0', minute = '0'] = found;
  const at = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)),
  );
  if (Number.isNaN(at.getTime())) return null;
  // Date.UTC rolls a month of 13 into the next year rather than refusing it, so
  // what went in is checked against what came out.
  if (at.getUTCMonth() !== Number(month) - 1 || at.getUTCDate() !== Number(day)) return null;
  return at.toISOString();
}

// Issues this workflow opens name their monitor in a marker. One filed through
// the maintenance template names them in prose instead, so both are resolved to
// slugs for the page to filter on.
export function affectedMonitors(body, monitors, heading = DEFAULT_MONITORS_HEADING) {
  const found = new Set();
  const tagged = markedMonitor(body);
  if (tagged) found.add(tagged);

  const pattern = new RegExp(`###\\s*${escape(heading)}\\s*\\n+([^\\n#]+)`, 'i');
  const section = (body || '').match(pattern)?.[1];
  for (const token of (section || '').split(/[,;]/)) {
    const name = token.trim().toLowerCase();
    // GitHub writes this for a field left empty, in English, whatever the form
    // around it says.
    if (!name || name === '_no response_') continue;
    const match = monitors.find(
      (monitor) => monitor.slug === name || monitor.name.toLowerCase() === name,
    );
    if (match) found.add(match.slug);
  }
  return [...found];
}
