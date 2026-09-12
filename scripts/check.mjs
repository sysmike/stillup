// Checks every configured monitor, appends the result to history and writes
// scripts/.results.json for the incident step.

import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import { loadConfig, redact, statusMatches } from './lib/config.mjs';
import { appendResult } from './lib/history.mjs';

// Opens a TCP connection and times how long the handshake took. With a
// keyword set it also waits for the first chunk the server sends, which is
// how a banner protocol such as SMTP or SSH gets verified.
function tcpRequest(monitor) {
  const { hostname, port } = new URL(monitor.url);
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = connect({ host: hostname, port: Number(port) });
    const elapsed = () => Math.round(performance.now() - started);
    const done = (fn, value) => {
      socket.destroy();
      fn(value);
    };

    socket.setTimeout(monitor.timeout);
    socket.once('timeout', () =>
      done(reject, Object.assign(new Error(`timeout after ${monitor.timeout}ms`), { timeout: true })),
    );
    socket.once('error', (error) => done(reject, error));
    socket.once('connect', () => {
      if (!monitor.keyword) done(resolve, { code: 0, ms: elapsed(), text: '' });
    });
    socket.once('data', (chunk) => done(resolve, { code: 0, ms: elapsed(), text: chunk.toString('utf8') }));
  });
}

const run = promisify(execFile);

// One ICMP echo through the system ping binary; Node cannot open a raw socket
// on its own. Hosted runners usually cannot either, see the README.
async function pingRequest(monitor) {
  const host = new URL(monitor.url).hostname.replace(/^\[|\]$/g, '');
  const deadline = Math.max(1, Math.ceil(monitor.timeout / 1000));
  try {
    // LC_ALL keeps ping's diagnostics in English, whatever the host locale is.
    const { stdout } = await run('ping', ['-n', '-c', '1', '-W', String(deadline), host], {
      timeout: monitor.timeout + 1000,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    });
    const rtt = stdout.match(/time[=<]\s*([\d.]+)\s*ms/i);
    if (!rtt) throw new Error('no reply');
    return { code: 0, ms: Math.round(Number(rtt[1])), text: '' };
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('ping is not installed on this runner');
    const lines = `${error.stderr || ''}\n${error.stdout || ''}`
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    // ping reports its own failures on a "ping: ..." line; everything else is
    // an ordinary miss, which shows up as complete packet loss.
    const reported = lines.find((line) => line.startsWith('ping:'));
    if (reported) throw new Error(reported.replace(/^ping:\s*/, ''));
    throw new Error(lines.some((line) => line.includes('100% packet loss')) ? 'no reply' : error.message);
  }
}

async function httpRequest(monitor) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeout);
  const started = performance.now();
  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      headers: { 'user-agent': 'status-page-monitor', ...monitor.headers },
      body: monitor.body,
      redirect: monitor.followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
    });
    const text = monitor.keyword ? await response.text() : '';
    return { code: response.status, ms: Math.round(performance.now() - started), text };
  } finally {
    clearTimeout(timer);
  }
}

const requests = { tcp: tcpRequest, ping: pingRequest, http: httpRequest };
const request = (monitor) => requests[monitor.type](monitor);

async function check(monitor) {
  let last;
  for (let attempt = 0; attempt <= monitor.retries; attempt += 1) {
    try {
      const { code, ms, text } = await request(monitor);
      if (monitor.type === 'http' && !statusMatches(code, monitor.expectedStatus)) {
        last = { status: 'down', code, ms, error: `unexpected status ${code}` };
      } else if (monitor.keyword && !text.includes(monitor.keyword)) {
        last = { status: 'down', code, ms, error: `keyword "${monitor.keyword}" not found` };
      } else if (monitor.degradedMs > 0 && ms > monitor.degradedMs) {
        last = { status: 'degraded', code, ms, error: `slower than ${monitor.degradedMs}ms` };
      } else {
        return { status: 'up', code, ms, error: null };
      }
    } catch (error) {
      const aborted = error.timeout || error.name === 'AbortError' || error.name === 'TimeoutError';
      last = {
        status: 'down',
        code: 0,
        ms: 0,
        error: aborted
          ? `timeout after ${monitor.timeout}ms`
          : String(error.cause?.message || error.message),
      };
    }
  }
  return last;
}

const { monitors } = loadConfig(process.env.CONFIG_VARS, process.env.CONFIG_SECRETS);
if (monitors.length === 0) {
  console.log('No MONITOR_* variables configured.');
}

const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const results = [];

// A private monitor never hands its URL on: results feed the incident issues
// and the published site, so this is the single place to strip it.
for (const monitor of monitors) {
  const outcome = await check(monitor);
  const result = {
    slug: monitor.slug,
    name: monitor.name,
    url: monitor.private ? monitor.link : monitor.url,
    timestamp,
    ...outcome,
    error: monitor.private ? redact(outcome.error, monitor.url) : outcome.error,
  };
  appendResult(monitor.slug, result);
  results.push(result);
  console.log(
    `${result.status.padEnd(8)} ${monitor.name} — ${result.code || '—'} in ${result.ms}ms` +
      (result.error ? ` (${result.error})` : ''),
  );
}

writeFileSync(new URL('.results.json', import.meta.url), JSON.stringify(results, null, 2));
