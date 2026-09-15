// Every string the page can show. A translation is laid over this one, so a key
// it is missing still says something rather than nothing — a safety net, not a
// licence to ship half of one: the test suite holds every language to the keys
// listed here.
//
// A value that counts something is an object of plural categories. English
// needs `one` and `other`; a translation may need more, or fewer, and says so
// in its own file.

export default {
  'common.loading': 'Loading…',
  'common.never': 'never',

  // Kept short: this label shares a fixed column with the figure beside it.
  'status.up': 'Operational',
  'status.degraded': 'Degraded',
  'status.partial': 'Partial outage',
  'status.down': 'Down',
  'status.none': 'No data',

  'banner.up': 'All systems operational',
  'banner.degraded': 'Degraded performance',
  'banner.partial': 'Partial outage',
  'banner.down': 'Major outage',
  'banner.none': 'Waiting for the first check',
  'banner.stale': 'Status may be out of date',
  'banner.staleMeta': 'The last check was {when}',
  'banner.loading': 'Loading status…',
  // `monitors` is the list of names; `count` is how many, for a language whose
  // verb changes with it.
  'banner.notResponding': {
    one: '{monitors} not responding',
    other: '{monitors} not responding',
  },

  'count.monitors': { one: '{count} monitor', other: '{count} monitors' },
  'group.allOperational': 'all operational',
  'group.down': '{count} down',
  'group.degraded': '{count} degraded',

  'strip.today': 'Today',
  'strip.noData': 'No data',
  'strip.uptime': '{percent}% up',
  'strip.checks': { one: '{count} check', other: '{count} checks' },
  'strip.avg': '{ms}ms avg',

  'chart.empty': 'Not enough response time data yet.',
  'chart.failed': 'Could not load response times.',
  'chart.range': '{days}d response time',
  'chart.legend': 'min {min}ms · avg {avg}ms · max {max}ms',

  'figure.today': 'Today',
  'figure.days': { one: '{count} day', other: '{count} days' },
  'figure.lastCheck': 'Last check',

  'detail.since': 'since {date}',
  'detail.history': '{days} day history',
  'detail.certExpires': {
    one: 'Certificate expires in {count} day, on {date}',
    other: 'Certificate expires in {count} days, on {date}',
  },
  'detail.certExpired': 'Certificate expired on {date}',
  'detail.responseTime': 'Response time',
  'detail.noIncidents': 'No incidents recorded for this monitor.',

  'incidents.title': 'Incidents',
  'incidents.active': 'Active',
  'incidents.earlier': 'Earlier',
  'incidents.empty': {
    one: 'No incidents in the last day.',
    other: 'No incidents in the last {count} days.',
  },
  'incidents.all': 'All incidents on GitHub',

  'feed.ongoing': 'Ongoing',
  'feed.resolvedAfter': 'Resolved after {duration}',
  'feed.completedAfter': 'Completed after {duration}',
  'incidents.feed': 'Atom feed',
  'incident.downFor': 'Down for {duration}',
  'incident.maintenanceOpened': 'Maintenance, opened {when}',
  'incident.resolved': 'Resolved {when} after {duration}',
  'incident.completed': 'Completed {when} after {duration}',
  'incident.state.open': 'open',
  'incident.state.maintenance': 'maintenance',
  'incident.state.resolved': 'resolved',
  'incident.opened': 'opened {date}',
  'incident.started': 'started {date}',
  'incident.completedOn': 'completed {date} after {duration}',
  'incident.resolvedOn': 'resolved {date} after {duration}',
  'incident.noBody': 'No description was given.',
  'incident.issueLink': 'Issue #{number} on GitHub',

  'comments.count': { one: '{count} comment', other: '{count} comments' },
  'comments.bot': 'bot',
  'comments.more': {
    one: '{count} earlier comment on GitHub',
    other: '{count} earlier comments on GitHub',
  },

  'footer.checked': 'Checked {when}',
  'footer.source': 'Source',

  'error.title': 'Status data unavailable',
  // `{name}` is replaced by the variable name, set in a <code> element, so a
  // translation is free to put it wherever the sentence needs it.
  'empty.monitors': 'No monitors configured. Add a repository variable named {name} to get started.',

  // Written by the workflow rather than by the page: the labels on an outage's
  // facts, shared between the issue it opens and the notifications it sends.
  'field.url': 'URL',
  'field.error': 'Error',
  'field.code': 'Response code',
  'field.issue': 'Issue',
  'field.firstFailure': 'First failure',
  'field.unknown': 'unknown',
  'field.none': 'none',

  'field.expires': 'Expires',
  'field.issuer': 'Issuer',
  'notify.cert': {
    one: 'Certificate for {name} expires in {count} day',
    other: 'Certificate for {name} expires in {count} days',
  },
  'issue.title': '{name} is down',
  'issue.intro': '**{name}** stopped responding as expected.',
  'issue.autoClose': 'This issue closes automatically once the monitor recovers.',
  'issue.recovered': 'Recovered after {duration} — {code} in {ms}ms.',

  'notify.down': '{name} is down',
  'notify.degraded': '{name} is degraded',
  'notify.up': '{name} is back up',
  'notify.upAfter': '{name} is back up after {duration}',

  'a11y.toggleTheme': 'Toggle theme',
  'a11y.close': 'Close',
  'meta.description': 'Service status and uptime history',
};
