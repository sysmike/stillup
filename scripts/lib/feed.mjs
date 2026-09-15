// An Atom feed of the incidents, so a reader can follow the page without
// polling it and without needing a GitHub account.
//
// One entry per incident rather than per update: the entry appears when the
// incident is opened and its `updated` moves when it is resolved, which is how
// a reader's client knows to show it again.

// XML has five named entities and no others. Control characters are not
// representable in XML 1.0 at all, and an issue body is written by whoever
// filed it, so they are dropped rather than escaped.
export function escape(value) {
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const tag = (name, value) => `    <${name}>${escape(value)}</${name}>`;

function entry(incident, t, duration) {
  const closed = incident.state !== 'open' && incident.closedAt;
  const standing = closed
    ? t(incident.maintenance ? 'feed.completedAfter' : 'feed.resolvedAfter', {
        duration: duration(incident.createdAt, incident.closedAt),
      })
    : t('feed.ongoing');

  const body = (incident.body || '').trim();
  return [
    '  <entry>',
    tag('id', incident.url),
    tag('title', incident.title),
    `    <link rel="alternate" href="${escape(incident.url)}"/>`,
    tag('published', incident.createdAt),
    tag('updated', closed || incident.createdAt),
    `    <content type="text">${escape(body ? `${standing}\n\n${body}` : standing)}</content>`,
    '  </entry>',
  ].join('\n');
}

// `url` is where the page itself lives; it is the one thing this cannot work
// out on its own, and the feed is still valid without it.
export function atom({ title, url, repoUrl, incidents, t, duration, now = new Date() }) {
  const listed = incidents
    .slice()
    .sort((a, b) => (b.closedAt || b.createdAt).localeCompare(a.closedAt || a.createdAt))
    .slice(0, 50);

  const updated = listed.length ? listed[0].closedAt || listed[0].createdAt : now.toISOString();
  const links = [
    url ? `  <link rel="self" href="${escape(`${url}/feed.xml`)}"/>` : null,
    url ? `  <link rel="alternate" href="${escape(`${url}/`)}"/>` : null,
  ].filter(Boolean);

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escape(title)}</title>`,
    `  <subtitle>${escape(t('incidents.title'))}</subtitle>`,
    `  <id>${escape(repoUrl || url || 'urn:status-page')}</id>`,
    ...links,
    `  <updated>${escape(updated)}</updated>`,
    ...listed.map((incident) => entry(incident, t, duration)),
    '</feed>',
    '',
  ].join('\n');
}
