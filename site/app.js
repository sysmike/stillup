const STATUS_TEXT = {
  up: 'Operational',
  degraded: 'Degraded performance',
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

const svgNS = 'http://www.w3.org/2000/svg';
const tooltip = document.getElementById('tooltip');
const monitorsEl = document.getElementById('monitors');
let range = 90;
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

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatUptime(value) {
  return value === null ? '—' : `${value.toFixed(value >= 99.995 ? 0 : 2)}%`;
}

function showTooltip(event, lines) {
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

const rangeKey = () => (range === 7 ? 'week' : range === 30 ? 'month' : 'quarter');

// Bars stay readable by dropping the oldest days when the viewport is narrow.
function visibleDays() {
  const width = monitorsEl.clientWidth - 40;
  return Math.max(7, Math.min(range, Math.floor(width / 5)));
}

function renderBars(monitor) {
  const bars = el('div', 'bars');
  const days = monitor.days.slice(-visibleDays());
  for (const day of days) {
    const bar = el('div', `bar bar-${day.state}`);
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
  }

  const scale = el('div', 'scale');
  scale.append(el('span', null, `${days.length} days ago`), el('span'), el('span', null, 'Today'));
  return [bars, scale];
}

function renderChart(container, payload) {
  const points = payload.points.filter(([, , ms]) => ms > 0);
  container.replaceChildren();
  if (points.length < 2) {
    container.append(el('p', 'card-sub', 'Not enough response time data yet.'));
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

function renderCard(monitor) {
  const card = el('div', 'card');
  card.style.setProperty('--status', `var(--${monitor.status === 'none' ? 'none' : monitor.status})`);

  const head = el('div', 'card-head');
  const left = el('div');
  const name = el('div', 'card-name');
  name.append(el('span', 'dot'));
  if (monitor.url) {
    const link = el('a', null, monitor.name);
    link.href = monitor.url;
    link.rel = 'noopener';
    name.append(link);
  } else {
    name.append(el('span', null, monitor.name));
  }
  left.append(name);
  if (monitor.description) left.append(el('p', 'card-desc', monitor.description));

  const right = el('div', 'card-status');
  right.append(el('div', 'card-uptime', formatUptime(monitor.uptime[rangeKey()])));
  right.append(el('div', 'card-sub', STATUS_TEXT[monitor.status] || monitor.status));
  head.append(left, right);
  card.append(head, ...renderBars(monitor));

  const footer = el('div', 'card-footer');
  const toggle = el('button', 'toggle-chart');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(el('span', null, 'Response time'));
  const caret = svg('svg', { viewBox: '0 0 24 24' });
  caret.append(svg('path', { d: 'M6 9l6 6 6-6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  toggle.append(caret);

  const meta = monitor.lastMs !== null ? `${monitor.lastMs}ms · checked ${relative(monitor.lastCheck)}` : 'No checks yet';
  footer.append(toggle, el('span', null, meta));
  card.append(footer);

  const chart = el('div', 'chart');
  chart.hidden = true;
  card.append(chart);

  toggle.addEventListener('click', async () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    chart.hidden = open;
    if (!open && !chart.dataset.loaded) {
      chart.dataset.loaded = '1';
      chart.append(el('p', 'card-sub', 'Loading…'));
      try {
        const response = await fetch(`api/monitor/${monitor.slug}.json`, { cache: 'no-cache' });
        renderChart(chart, await response.json());
      } catch {
        chart.replaceChildren(el('p', 'card-sub', 'Could not load response times.'));
      }
    }
  });

  return card;
}

function renderIncidents(incidents) {
  const section = document.getElementById('incidents');
  const list = document.getElementById('incident-list');
  const recent = incidents.filter(
    (incident) => incident.state === 'open' || Date.now() - new Date(incident.createdAt) < 30 * 86400000,
  );
  if (recent.length === 0) {
    section.hidden = true;
    return;
  }

  list.replaceChildren();
  for (const incident of recent.slice(0, 10)) {
    const item = el('li');
    const link = el('a', null, incident.title);
    link.href = incident.url;
    link.rel = 'noopener';
    item.append(link);

    const meta = el('div', 'incident-meta');
    const state = incident.maintenance ? 'maintenance' : incident.state === 'open' ? 'open' : 'resolved';
    meta.append(el('span', `tag tag-${state}`, state));
    // Maintenance is announced ahead of time, so it is never "started".
    meta.append(
      el(
        'span',
        null,
        incident.state === 'open'
          ? `${incident.maintenance ? 'opened' : 'started'} ${relative(incident.createdAt)}`
          : `${formatDate(incident.createdAt)} · ${incident.maintenance ? 'completed' : 'resolved'} ${relative(incident.closedAt)}`,
      ),
    );
    item.append(meta);
    list.append(item);
  }
  section.hidden = false;
}

function renderMonitors() {
  monitorsEl.replaceChildren();
  const groups = new Map();
  for (const monitor of data.monitors) {
    const key = monitor.group || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(monitor);
  }
  for (const [group, monitors] of groups) {
    if (group) monitorsEl.append(el('h3', 'group-title', group));
    for (const monitor of monitors) monitorsEl.append(renderCard(monitor));
  }
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

for (const button of document.querySelectorAll('.range button')) {
  button.addEventListener('click', () => {
    range = Number(button.dataset.range);
    for (const other of document.querySelectorAll('.range button')) {
      other.classList.toggle('is-active', other === button);
    }
    renderMonitors();
  });
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
  setInterval(() => {
    document.getElementById('updated').textContent = `Checked ${relative(data.generatedAt)}`;
  }, 30000);
} catch (error) {
  document.getElementById('banner-title').textContent = 'Status data unavailable';
  document.getElementById('banner-meta').textContent = String(error.message || error);
}
