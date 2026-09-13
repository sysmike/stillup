// Kept short: this label shares a fixed column with the figure beside it.
const STATUS_TEXT = {
  up: 'Operational',
  degraded: 'Degraded',
  partial: 'Partial outage',
  down: 'Down',
  none: 'No data',
};

const BANNER_TEXT = {
  up: 'All systems operational',
  degraded: 'Degraded performance',
  partial: 'Partial outage',
  down: 'Major outage',
  none: 'Waiting for the first check',
};

// The tab icon carries the overall status, so a pinned tab still reports it.
const STATUS_COLOR = {
  up: '#12b76a',
  degraded: '#f79009',
  partial: '#f97316',
  down: '#f04438',
  none: '#9aa3ad',
};

const svgNS = 'http://www.w3.org/2000/svg';
const tooltip = document.getElementById('tooltip');
const monitorsEl = document.getElementById('monitors');
// The page shows a fixed window; the detail view shows the whole history.
const RANGE_DAYS = 30;
const BAR_WIDTH = 5;
// How far back the list reaches, and how many resolved entries it keeps. An
// open incident is always listed, however old it is.
const INCIDENT_DAYS = 30;
const PAST_INCIDENTS = 10;
let data;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

function relative(iso) {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const scales = [
    [60, 'minute'],
    [60, 'hour'],
    [24, 'day'],
    [30, 'month'],
  ];
  let value = seconds;
  let unit = 'second';
  for (const [size, next] of scales) {
    if (value < size) break;
    value /= size;
    unit = next;
  }
  const rounded = Math.round(value);
  return `${rounded} ${unit}${rounded === 1 ? '' : 's'} ago`;
}

function elapsed(from, to) {
  const minutes = Math.max(1, Math.round((new Date(to) - new Date(from)) / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// Date and time are formatted apart: asking for both at once gives some locales
// a connecting word in the middle. The year only earns its place once the entry
// is not from this one.
function formatDateTime(iso) {
  const at = new Date(iso);
  const thisYear = at.getUTCFullYear() === new Date().getUTCFullYear();
  const day = at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(thisYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
  const time = at.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  // A middle dot rather than a comma: a short month already ends in a period in
  // some locales, where "13. Sept., 19:27" reads as a stumble.
  return `${day} · ${time} UTC`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatUptime(value) {
  return value === null ? '—' : `${value.toFixed(value >= 99.995 ? 0 : 2)}%`;
}

function showTooltip(event, lines) {
  // A modal dialog paints in the browser's top layer, which no z-index in the
  // normal layer can reach, so the tooltip has to join it there.
  const host = event.target.closest('dialog') || document.body;
  if (tooltip.parentElement !== host) host.append(tooltip);

  tooltip.replaceChildren(...lines);
  tooltip.hidden = false;
  const box = tooltip.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX - box.width / 2, 8), innerWidth - box.width - 8);
  const y = event.clientY - box.height - 10;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y < 8 ? event.clientY + 16 : y}px`;
}

const hideTooltip = () => {
  tooltip.hidden = true;
};

// Bars are laid out on whole pixels: a bar of `targetBar` where there is room
// for one, narrower where there is not, and a gap that narrows with it so a
// cramped strip does not end up mostly gap.
function stripLayout(width, gap, count, targetBar) {
  const fit = Math.max(2, Math.floor((width + gap) / count));
  const cell = targetBar ? Math.min(targetBar + gap, fit) : fit;
  return { cell, gap: cell >= 4 ? gap : 1, count };
}

// Fills an existing strip, so a row can be measured first and filled after.
function fillBars(bars, monitor, width, gap, count, targetBar = 0) {
  const layout = stripLayout(width, gap, count, targetBar);
  const base = layout.cell - layout.gap;
  bars.style.setProperty('--bar', `${base}px`);
  bars.style.setProperty('--gap', `${layout.gap}px`);
  bars.replaceChildren();

  // A strip without a target bar width fills its space instead. Whole pixel
  // bars rarely divide it exactly, so the remainder is spread one pixel at a
  // time across the strip rather than leaving it short.
  const spare = targetBar
    ? 0
    : Math.max(0, Math.floor(width) - (layout.count * layout.cell - layout.gap));
  const days = monitor.days.slice(-layout.count);
  days.forEach((day, index) => {
    const bar = el('div', `bar bar-${day.state}`);
    const extra =
      Math.floor(((index + 1) * spare) / layout.count) - Math.floor((index * spare) / layout.count);
    if (extra) bar.style.flex = `0 0 ${base + extra}px`;
    bar.addEventListener('mouseenter', (event) => {
      const ratio = day.checks ? ((day.checks - day.down) / day.checks) * 100 : null;
      showTooltip(event, [
        el('b', null, formatDate(day.date)),
        el(
          'span',
          null,
          day.checks
            ? `${ratio.toFixed(2)}% up · ${day.checks} checks${day.avg ? ` · ${day.avg}ms avg` : ''}`
            : 'No data',
        ),
      ]);
    });
    bar.addEventListener('mouseleave', hideTooltip);
    bars.append(bar);
  });
  return { days: days.length, width: layout.count * layout.cell - layout.gap + spare };
}

function renderBars(monitor, width, gap, count) {
  const bars = el('div', 'bars');
  const painted = fillBars(bars, monitor, width, gap, count);
  const scale = el('div', 'scale');
  scale.append(el('span', null, `${painted.days} days ago`), el('span'), el('span', null, 'Today'));
  return [bars, scale];
}

function renderChart(container, payload) {
  const points = payload.points.filter(([, , ms]) => ms > 0);
  container.replaceChildren();
  if (points.length < 2) {
    container.append(el('p', 'detail-empty', 'Not enough response time data yet.'));
    return;
  }

  const width = 720;
  const height = 120;
  const max = Math.max(...points.map(([, , ms]) => ms));
  const min = Math.min(...points.map(([, , ms]) => ms));
  const top = Math.ceil((max * 1.15) / 10) * 10;
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' });

  for (let index = 0; index <= 2; index += 1) {
    const y = (height / 2) * index;
    chart.append(svg('line', { class: 'chart-grid', x1: 0, x2: width, y1: y, y2: y }));
  }

  const coords = points.map(([, , ms], index) => [
    (index / (points.length - 1)) * width,
    height - (ms / top) * height,
  ]);
  const line = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  chart.append(svg('path', { class: 'chart-area', d: `${line} L${width} ${height} L0 ${height} Z` }));
  chart.append(svg('path', { class: 'chart-line', d: line, 'vector-effect': 'non-scaling-stroke' }));
  container.append(chart);

  const legend = el('div', 'chart-legend');
  const average = Math.round(points.reduce((total, [, , ms]) => total + ms, 0) / points.length);
  legend.append(
    el('span', null, `${payload.rawDays}d response time`),
    el('span', null, `min ${min}ms · avg ${average}ms · max ${max}ms`),
  );
  container.append(legend);
}

const dialog = document.getElementById('detail');
const detailBody = document.getElementById('detail-body');
const chartCache = new Map();

// Rows are click targets rather than links: on a status page the interesting
// destination is the history, not the monitored site.
function makeOpener(element, monitor) {
  const open = () => {
    const hash = `#/${monitor.slug}`;
    if (location.hash === hash) openDetail(monitor.slug);
    else location.hash = hash;
  };
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  element.addEventListener('click', open);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
}

function figure(value, label) {
  const box = el('div', 'figure');
  box.append(el('div', 'figure-value', value), el('div', 'figure-label', label));
  return box;
}

const INCIDENT_ICONS = {
  open: 'M12 3.5a6 6 0 0 1 6 6v4l1.6 3H4.4L6 13.5v-4a6 6 0 0 1 6-6zM9.7 19.5a2.4 2.4 0 0 0 4.6 0',
  maintenance: 'M4 7.5h16v12.5H4zM8 4v5M16 4v5M4 12h16',
  resolved: 'M5 12.5 10 17.5 19 7',
};

// A speech bubble and a number: the entry says a conversation is attached
// without the reader having to open it.
function commentCount(count) {
  const tag = el('span', 'comment-count');
  const mark = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  mark.append(
    svg('path', {
      d: 'M4.5 5.5h15v11h-9l-4.5 3.5v-3.5h-1.5z',
      'stroke-linejoin': 'round',
    }),
  );
  tag.append(mark, el('span', null, String(count)));
  tag.title = `${count} comment${count === 1 ? '' : 's'}`;
  return tag;
}

// One entry of the timeline: when it happened, what happened, and how it went.
function renderIncidentItem(incident, active = false) {
  const state = incident.maintenance ? 'maintenance' : incident.state === 'open' ? 'open' : 'resolved';
  const item = el('li', active ? 'event is-active' : 'event');
  item.dataset.state = state;

  const icon = el('span', 'event-icon');
  const mark = svg('svg', { viewBox: '0 0 24 24' });
  mark.append(svg('path', { d: INCIDENT_ICONS[state], 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  icon.append(mark);

  const body = el('div', 'event-body');
  body.append(el('div', 'event-date', formatDateTime(incident.createdAt)));

  const title = el('button', 'incident-title', incident.title);
  title.type = 'button';
  title.addEventListener('click', () => {
    const hash = `#/incident/${incident.number}`;
    if (location.hash === hash) openIncident(incident.number);
    else location.hash = hash;
  });
  // The count belongs to the title, not to the state line below it.
  const heading = el('div', 'incident-heading');
  heading.append(title);
  if (incident.commentCount) heading.append(commentCount(incident.commentCount));
  body.append(heading);

  // The icon and its colour already say what state this is, so the line says it
  // in words once rather than repeating it as a chip beside them.
  const meta = el('div', 'incident-meta');
  meta.append(
    el(
      'span',
      'incident-state',
      incident.state === 'open'
        ? incident.maintenance
          ? `Maintenance, opened ${relative(incident.createdAt)}`
          : `Down for ${elapsed(incident.createdAt, Date.now())}`
        : `${incident.maintenance ? 'Completed' : 'Resolved'} ${relative(incident.closedAt)} after ${elapsed(incident.createdAt, incident.closedAt)}`,
    ),
  );
  body.append(meta);

  item.append(icon, body);
  return item;
}

// Issue bodies are written by whoever filed the issue, so they are never
// inserted as markup. This walks the few constructs the templates produce and
// builds text nodes for everything else.
function inline(target, text) {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) target.append(text.slice(last, match.index));
    const [, label, href, bare, bold, code] = match;
    if (href) {
      const link = el('a', null, label);
      link.href = href;
      link.rel = 'noopener';
      target.append(link);
    } else if (bare) {
      const link = el('a', null, bare.replace(/^https?:\/\//, ''));
      link.href = bare;
      link.rel = 'noopener';
      target.append(link);
    } else if (bold) {
      target.append(el('strong', null, bold));
    } else {
      target.append(el('code', null, code));
    }
    last = match.index + match[0].length;
  }
  target.append(text.slice(last));
}

function renderBody(container, body, skip = []) {
  let list = null;
  let skipping = false;
  // A heading is only worth showing once something follows it, so it waits here
  // until the section turns out to have content.
  let heading = null;
  const place = (node) => {
    if (heading) container.append(heading);
    heading = null;
    container.append(node);
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) {
      list = null;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      const text = line.replace(/^#{1,6}\s*/, '');
      list = null;
      skipping = skip.includes(text.toLowerCase());
      heading = skipping ? null : el('h4', 'body-heading', text);
      continue;
    }
    if (skipping) continue;
    // What an issue form writes into an optional field that was left blank.
    if (line === '_No response_') {
      list = null;
      heading = null;
      skipping = true;
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      if (!list) place((list = el('ul', 'body-list')));
      const item = el('li');
      inline(item, line.replace(/^[-*]\s*/, ''));
      list.append(item);
      continue;
    }
    list = null;
    const paragraph = el('p', 'body-text');
    inline(paragraph, line);
    place(paragraph);
  }
}

// The conversation on the issue, as far as the snapshot carries it. Bodies are
// written by whoever commented, so they go through the same text-only renderer
// as the issue body.
function renderComments(incident) {
  const comments = incident.comments || [];
  if (!comments.length) return;

  const section = el('div', 'detail-section');
  const heading = el('h3', 'section-title', comments.length === 1 ? '1 comment' : `${comments.length} comments`);
  section.append(heading);

  for (const comment of comments) {
    const entry = el('div', 'comment');
    const head = el('div', 'comment-head');
    head.append(el('span', 'comment-author', comment.author));
    if (comment.bot) head.append(el('span', 'comment-bot', 'bot'));
    head.append(el('span', 'comment-time', relative(comment.createdAt)));
    entry.append(head);

    const text = el('div', 'comment-body');
    renderBody(text, comment.body || '');
    entry.append(text);
    section.append(entry);
  }

  // The snapshot keeps only the newest few, so say when there are more.
  const hidden = (incident.commentCount || comments.length) - comments.length;
  if (hidden > 0) {
    const more = el('p', 'detail-empty');
    more.append(`${hidden} earlier comment${hidden === 1 ? '' : 's'} on GitHub`);
    section.append(more);
  }

  detailBody.append(section);
}

function openIncident(number) {
  const incident = (data.incidents || []).find((candidate) => candidate.number === Number(number));
  if (!incident) return;

  detailBody.replaceChildren();
  const state = incident.maintenance ? 'maintenance' : incident.state === 'open' ? 'open' : 'resolved';
  const head = el('h2', 'detail-head');
  head.id = 'detail-title';
  head.append(el('span', null, incident.title));
  detailBody.append(head);

  const meta = el('p', 'detail-meta');
  meta.append(el('span', `tag tag-${state}`, state));
  meta.append(
    el(
      'span',
      null,
      ` ${incident.maintenance ? 'opened' : 'started'} ${formatDate(incident.createdAt)}` +
        (incident.closedAt
          ? ` · ${incident.maintenance ? 'completed' : 'resolved'} ${formatDate(incident.closedAt)} after ${elapsed(incident.createdAt, incident.closedAt)}`
          : ` · ${relative(incident.createdAt)}`),
    ),
  );
  detailBody.append(meta);

  const affected = (incident.monitors || [])
    .map((slug) => data.monitors.find((monitor) => monitor.slug === slug))
    .filter(Boolean);
  if (affected.length) {
    const chips = el('p', 'chips');
    for (const monitor of affected) {
      const chip = el('button', 'chip', monitor.name);
      chip.type = 'button';
      chip.style.setProperty('--status', `var(--${monitor.status === 'none' ? 'none' : monitor.status})`);
      chip.addEventListener('click', () => {
        location.hash = `#/${monitor.slug}`;
      });
      chips.append(chip);
    }
    detailBody.append(chips);
  }

  // The chips above already name the monitors, so the section the maintenance
  // template writes would only repeat them. It stays when nothing resolved.
  const section = el('div', 'detail-section');
  if (incident.body) renderBody(section, incident.body, affected.length ? ['affected monitors'] : []);
  if (!section.childElementCount) section.append(el('p', 'detail-empty', 'No description was given.'));
  detailBody.append(section);

  renderComments(incident);

  const footer = el('p', 'detail-meta detail-source');
  const link = el('a', null, `Issue #${incident.number} on GitHub`);
  link.href = incident.url;
  link.rel = 'noopener';
  link.target = '_blank';
  footer.append(link);
  detailBody.append(footer);

  if (!dialog.open) dialog.showModal();
}

async function openDetail(slug) {
  const monitor = data.monitors.find((candidate) => candidate.slug === slug);
  if (!monitor) return;

  detailBody.replaceChildren();
  // The dialog is named by this heading, so it announces what opened.
  const head = el('h2', 'detail-head');
  head.id = 'detail-title';
  head.style.setProperty('--status', `var(--${monitor.status === 'none' ? 'none' : monitor.status})`);
  head.append(el('span', monitor.status === 'none' ? 'dot is-idle' : 'dot'), el('span', null, monitor.name));
  detailBody.append(head);

  const meta = el('p', 'detail-meta');
  meta.append(el('span', null, STATUS_TEXT[monitor.status] || monitor.status));
  if (monitor.since) meta.append(el('span', null, ` since ${formatDate(monitor.since)}`));
  if (monitor.group) meta.append(el('span', null, ` · ${monitor.group}`));
  if (monitor.url) {
    meta.append(el('span', null, ' · '));
    const link = el('a', null, monitor.url.replace(/^https?:\/\//, ''));
    link.href = monitor.url;
    link.rel = 'noopener';
    meta.append(link);
  }
  detailBody.append(meta);
  if (monitor.description) detailBody.append(el('p', 'detail-meta', monitor.description));

  const figures = el('div', 'detail-figures');
  figures.append(
    figure(formatUptime(monitor.uptime.day), 'Today'),
    figure(formatUptime(monitor.uptime.week), '7 days'),
    figure(formatUptime(monitor.uptime.month), '30 days'),
    figure(monitor.lastMs === null ? '—' : `${monitor.lastMs}ms`, 'Last check'),
  );
  detailBody.append(figures);

  const history = el('div', 'detail-section');
  history.append(el('h3', 'section-title', `${data.days} day history`));
  detailBody.append(history);

  const chartSection = el('div', 'detail-section');
  chartSection.append(el('h3', 'section-title', 'Response time'));
  const chart = el('div', 'chart');
  chart.append(el('p', 'detail-empty', 'Loading…'));
  chartSection.append(chart);
  detailBody.append(chartSection);

  const related = (data.incidents || []).filter(
    (incident) => incident.monitors?.includes(slug) || incident.monitor === slug,
  );
  const incidentSection = el('div', 'detail-section');
  incidentSection.append(el('h3', 'section-title', 'Incidents'));
  if (related.length) {
    const list = el('ul', 'incident-list');
    // An open incident looks open wherever it is listed.
    for (const incident of related) list.append(renderIncidentItem(incident, incident.state === 'open'));
    incidentSection.append(list);
  } else {
    incidentSection.append(el('p', 'detail-empty', 'No incidents recorded for this monitor.'));
  }
  detailBody.append(incidentSection);

  if (!dialog.open) dialog.showModal();
  // Bars need the dialog's width, which only exists once it is open.
  // The detail view shows the whole history regardless of the range buttons.
  // Strip and scale share a block so the labels stay aligned with the strip.
  const strip = el('div', 'strip-block');
  strip.append(...renderBars(monitor, detailBody.clientWidth, 2, data.days));
  history.append(strip);

  try {
    if (!chartCache.has(slug)) {
      const response = await fetch(`api/monitor/${slug}.json`, { cache: 'no-cache' });
      chartCache.set(slug, await response.json());
    }
    renderChart(chart, chartCache.get(slug));
  } catch {
    chart.replaceChildren(el('p', 'detail-empty', 'Could not load response times.'));
  }
}

function syncDialog() {
  const route = location.hash.startsWith('#/') ? decodeURIComponent(location.hash.slice(2)) : '';
  if (!route) {
    if (dialog.open) dialog.close();
    return;
  }
  const incident = route.match(/^incident\/(\d+)$/);
  if (incident) openIncident(incident[1]);
  else openDetail(route);
}

// Closing is driven explicitly rather than from the dialog's own close event,
// which not every engine delivers when the dialog is closed from script.
function closeDetail() {
  hideTooltip();
  if (dialog.open) dialog.close();
  if (location.hash.startsWith('#/')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeDetail();
});
dialog.addEventListener('close', closeDetail);
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeDetail();
});
document.getElementById('detail-close').addEventListener('click', closeDetail);
addEventListener('hashchange', syncDialog);

function renderIncidents(incidents) {
  const section = document.getElementById('incidents');
  const list = document.getElementById('incident-list');
  const empty = document.getElementById('incidents-empty');
  const more = document.getElementById('incidents-more');

  const recent = incidents.filter(
    (incident) => incident.state === 'open' || Date.now() - new Date(incident.createdAt) < INCIDENT_DAYS * 86400000,
  );
  // An outage that is still open leads, whatever its date: one opened days ago
  // would otherwise sink below incidents that have since been resolved. Within
  // each group the newest comes first, rather than trusting the order the
  // snapshot happens to have.
  const newestFirst = (a, b) => b.createdAt.localeCompare(a.createdAt);
  const active = recent.filter((incident) => incident.state === 'open').sort(newestFirst);
  const past = recent
    .filter((incident) => incident.state !== 'open')
    .sort(newestFirst)
    .slice(0, PAST_INCIDENTS);

  list.replaceChildren();
  if (active.length && past.length) list.append(el('li', 'event-group', 'Active'));
  for (const incident of active) list.append(renderIncidentItem(incident, true));
  if (active.length && past.length) list.append(el('li', 'event-group', 'Earlier'));
  for (const incident of past) list.append(renderIncidentItem(incident));

  // Nothing having happened is the good news a status page is there to give,
  // so it is said rather than left to an absent section.
  empty.textContent = `No incidents in the last ${INCIDENT_DAYS} days.`;
  empty.hidden = recent.length > 0;
  more.hidden = !data.issuesUrl;
  if (data.issuesUrl) document.getElementById('incidents-link').href = data.issuesUrl;
  section.hidden = false;
}

function summarize(monitors) {
  const broken = monitors.filter((monitor) => monitor.status === 'down' || monitor.status === 'partial');
  const degraded = monitors.filter((monitor) => monitor.status === 'degraded');
  const parts = [`${monitors.length} monitors`];
  if (broken.length) parts.push(`${broken.length} down`);
  else if (degraded.length) parts.push(`${degraded.length} degraded`);
  else parts.push('all operational');
  return parts.join(' · ');
}

// Strips are filled once the page has been laid out, because how much room
// they get depends on the name, status and figure beside them. Guessing at it
// is what used to leave them clipped.
const pendingStrips = [];

function registerStrip(bars, monitor, gap, wrapper = null) {
  pendingStrips.push({ bars, monitor, gap, wrapper });
}

function fillPendingStrips() {
  for (const { bars, monitor, gap, wrapper } of pendingStrips.splice(0)) {
    const painted = fillBars(bars, monitor, (wrapper || bars).clientWidth, gap, RANGE_DAYS, BAR_WIDTH);
    if (wrapper) {
      // Reported as a property rather than a width, so a media query can still
      // lay the strip out differently without fighting an inline style.
      wrapper.style.setProperty('--strip-width', `${painted.width}px`);
      wrapper.classList.add('is-sized');
    }
  }
}

function renderRow(monitor) {
  const row = el('div', 'row');
  row.style.setProperty('--status', `var(--${monitor.status === 'none' ? 'none' : monitor.status})`);
  row.append(el('span', monitor.status === 'none' ? 'dot is-idle' : 'dot'), el('span', 'row-name', monitor.name));

  // How much room the strip gets depends on the name, status and figure beside
  // it, which is only known once the row is laid out. It is filled afterwards
  // rather than guessed at, which is what used to leave it clipped.
  const bars = el('div', 'bars bars-row');
  row.append(bars);
  registerStrip(bars, monitor, 2);

  row.append(el('span', 'row-status', STATUS_TEXT[monitor.status] || monitor.status));
  row.append(el('span', 'row-uptime', formatUptime(monitor.uptime.month)));
  makeOpener(row, monitor);
  return row;
}

function renderGroup(group, monitors) {
  if (group) {
    const head = el('div', 'group-head');
    head.append(el('span', 'group-title', group), el('span', 'group-summary', summarize(monitors)));
    monitorsEl.append(head);
  }
  const list = el('div', 'rows');
  for (const monitor of monitors) list.append(renderRow(monitor));
  monitorsEl.append(list);
}

function renderMonitors() {
  monitorsEl.replaceChildren();
  const groups = new Map();
  for (const monitor of data.monitors) {
    const key = monitor.group || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(monitor);
  }
  // Groups follow their configured order; ties keep the order their monitors
  // put them in, which is what happens when nothing is configured at all.
  const ordered = [...groups.entries()].sort(
    ([a], [b]) => (data.groups?.[a]?.order ?? 100) - (data.groups?.[b]?.order ?? 100),
  );
  for (const [group, monitors] of ordered) renderGroup(group, monitors);
  fillPendingStrips();
}

function computeOverall(monitors) {
  const active = monitors.filter((monitor) => monitor.status !== 'none');
  if (active.some((monitor) => monitor.status === 'down')) {
    return active.every((monitor) => monitor.status === 'down') ? 'down' : 'partial';
  }
  if (active.some((monitor) => monitor.status === 'degraded')) return 'degraded';
  return active.length ? 'up' : 'none';
}

// live.json carries only the newest day rows. They replace the ones the build
// shipped, a day that turned over since is appended, and the window keeps its
// length, so the strip stays current between deployments.
function mergeDays(days, updates) {
  const merged = days.slice();
  for (const day of updates) {
    const index = merged.findIndex((entry) => entry.date === day.date);
    if (index === -1) merged.push(day);
    else merged[index] = day;
  }
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged.slice(-data.days);
}

// The build is a snapshot. live.json is committed by every check run and served
// straight from the repository, so an open tab keeps up without a deployment.
// Any failure here leaves the page on its build time data.
async function refresh() {
  if (!data.live) return;
  try {
    const response = await fetch(data.live, { cache: 'no-store' });
    if (!response.ok) return;
    const live = await response.json();
    if (!(new Date(live.generatedAt) > new Date(data.generatedAt))) return;

    for (const monitor of data.monitors) {
      const update = live.monitors?.[monitor.slug];
      if (!update) continue;
      const { days, ...fields } = update;
      Object.assign(monitor, fields);
      if (days) monitor.days = mergeDays(monitor.days, days);
    }
    data.incidents = live.incidents ?? data.incidents;
    data.generatedAt = live.generatedAt;
    data.overall = computeOverall(data.monitors);
    render();
  } catch {
    // offline, rate limited or blocked: keep what the build gave us
  }
}

function setFavicon(status) {
  const color = STATUS_COLOR[status] || STATUS_COLOR.none;
  const mark =
    `<svg xmlns="${svgNS}" viewBox="0 0 32 32">` +
    `<circle cx="16" cy="16" r="11.3" fill="none" stroke="${color}" stroke-width="2.8"/>` +
    `<circle cx="16" cy="16" r="5.2" fill="${color}"/></svg>`;
  document.getElementById('favicon').href = `data:image/svg+xml,${encodeURIComponent(mark)}`;
}

function render() {
  document.title = data.site.title;
  document.getElementById('brand-title').textContent = data.site.title;
  if (data.site.logo) {
    const logo = document.getElementById('brand-logo');
    logo.src = data.site.logo;
    logo.hidden = false;
  }
  if (data.site.link) {
    const link = document.getElementById('repo-link');
    link.href = data.site.link;
    link.hidden = false;
  }

  const banner = document.getElementById('banner');
  banner.className = `banner banner-${data.overall}`;
  setFavicon(data.overall);
  document.getElementById('banner-title').textContent = BANNER_TEXT[data.overall];
  const down = data.monitors.filter((monitor) => monitor.status === 'down');
  document.getElementById('banner-meta').textContent =
    data.site.description ||
    (down.length ? `${down.map((monitor) => monitor.name).join(', ')} not responding` : `${data.monitors.length} monitors`);

  document.getElementById('empty').hidden = data.monitors.length > 0;
  document.getElementById('updated').textContent = `Checked ${relative(data.generatedAt)}`;

  renderIncidents(data.incidents);
  renderMonitors();
}

const root = document.documentElement;
const stored = localStorage.getItem('theme');
if (stored) root.dataset.theme = stored;
document.getElementById('theme-toggle').addEventListener('click', () => {
  const dark = getComputedStyle(root).colorScheme === 'dark';
  root.dataset.theme = dark ? 'light' : 'dark';
  localStorage.setItem('theme', root.dataset.theme);
});

addEventListener('scroll', hideTooltip, { passive: true });
dialog.addEventListener('scroll', hideTooltip, { passive: true });

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => data && renderMonitors(), 150);
});

try {
  const response = await fetch('api/summary.json', { cache: 'no-cache' });
  data = await response.json();
  if (!stored && data.site.theme !== 'auto') root.dataset.theme = data.site.theme;
  render();
  syncDialog();
  setInterval(() => {
    document.getElementById('updated').textContent = `Checked ${relative(data.generatedAt)}`;
  }, 30000);
  refresh();
  setInterval(refresh, 60000);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
} catch (error) {
  setFavicon('none');
  document.getElementById('banner-title').textContent = 'Status data unavailable';
  document.getElementById('banner-meta').textContent = String(error.message || error);
}
