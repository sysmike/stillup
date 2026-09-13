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
