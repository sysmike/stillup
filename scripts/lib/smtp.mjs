// A small SMTP client: enough of the protocol to hand one short message to a
// server, so notifications reach a mailbox without a dependency.
//
// Covers implicit TLS (smtps://, usually port 465), STARTTLS on a plain
// connection when the server offers it, AUTH PLAIN and AUTH LOGIN, and a UTF-8
// body. Anything beyond that — attachments, pipelining, DSN — is out of scope.

import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { hostname } from 'node:os';

const CRLF = '\r\n';
export const SMTP_TIMEOUT = 20000;

// A reply is one or more lines; every line but the last separates its code with
// a hyphen. Only a line that has arrived whole counts, or a chunk that happens
// to break after "250 HEL" would pass for the end of the reply — and only that
// reply is taken, in case the next one arrived in the same chunk.
export function replyEnd(text) {
  let offset = 0;
  for (;;) {
    const breakAt = text.indexOf(CRLF, offset);
    if (breakAt === -1) return -1;
    const line = text.slice(offset, breakAt);
    offset = breakAt + CRLF.length;
    if (/^\d{3} /.test(line)) return offset;
  }
}

class Session {
  constructor(socket) {
    this.pending = '';
    this.waiter = null;
    this.failure = null;
    this.attach(socket);
  }

  // Stops reading the current socket. The handshake that follows STARTTLS runs
  // over the plain socket, and those bytes are not SMTP: left attached, they
  // would be decoded as text and prepended to the next reply.
  detach() {
    for (const event of ['data', 'error', 'timeout', 'close']) {
      this.socket?.removeAllListeners(event);
    }
    this.pending = '';
  }

  attach(socket) {
    this.detach();
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(SMTP_TIMEOUT);
    socket.on('data', (chunk) => {
      this.pending += chunk;
      this.settle();
    });
    socket.on('error', (error) => this.abort(error));
    socket.on('timeout', () => this.abort(new Error(`no reply within ${SMTP_TIMEOUT}ms`)));
    socket.on('close', () => this.abort(new Error('connection closed')));
  }

  settle() {
    if (!this.waiter) return;
    const end = replyEnd(this.pending);
    if (end === -1) return;

    const text = this.pending.slice(0, end);
    this.pending = this.pending.slice(end);
    const { resolve } = this.waiter;
    this.waiter = null;
    resolve({ code: Number(text.split(CRLF).filter(Boolean).at(-1).slice(0, 3)), text: text.trim() });
  }

  abort(error) {
    this.failure = error;
    if (!this.waiter) return;
    const { reject } = this.waiter;
    this.waiter = null;
    reject(error);
  }

  read() {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
      this.settle();
    });
  }

  write(line) {
    this.socket.write(line + CRLF);
  }

  // Codes are matched exactly rather than by class: a server that answers EHLO
  // with some other 2xx has not said what the client needs to hear.
  async command(line, expected) {
    this.write(line);
    const reply = await this.read();
    if (!expected.includes(reply.code)) {
      // A password never reaches the log, so the command is named, not quoted.
      throw new Error(`${line.split(' ')[0]} rejected: ${reply.text.split(CRLF)[0]}`);
    }
    return reply;
  }
}

// A line of exactly "." would end the message early, so it is escaped, and the
// server expects CRLF throughout.
export function dotStuff(body) {
  return body.replace(/\r?\n/g, CRLF).replace(/^\./gm, '..');
}

// A header value outside ASCII travels as an encoded word; short subjects stay
// well inside the length a single word may have.
export function encodeHeader(value) {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function buildMessage({ from, to, subject, text, date = new Date(), id = randomId() }) {
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return `${headers.join(CRLF)}${CRLF}${CRLF}${dotStuff(text)}`;
}

const randomId = () => `${Date.now()}.${Math.random().toString(36).slice(2)}@status-page`;

// smtp://user:pass@host:port sends on a plain connection, upgrading with
// STARTTLS where it is offered; smtps:// opens TLS straight away.
export function parseUrl(url) {
  const parsed = new URL(url);
  const secure = parsed.protocol === 'smtps:';
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || (secure ? 465 : 587),
    secure,
    username: parsed.username ? decodeURIComponent(parsed.username) : '',
    password: parsed.password ? decodeURIComponent(parsed.password) : '',
  };
}

async function authenticate(session, capabilities, { username, password }) {
  if (!username) return;
  const offered = capabilities.find((line) => line.toUpperCase().startsWith('AUTH')) || '';
  const methods = offered.toUpperCase().split(/\s+/);

  if (methods.includes('PLAIN')) {
    const token = Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64');
    await session.command(`AUTH PLAIN ${token}`, [235]);
    return;
  }
  if (methods.includes('LOGIN') || !offered) {
    await session.command('AUTH LOGIN', [334]);
    await session.command(Buffer.from(username, 'utf8').toString('base64'), [334]);
    await session.command(Buffer.from(password, 'utf8').toString('base64'), [235]);
    return;
  }
  throw new Error(`no supported authentication method (server offers ${offered || 'none'})`);
}

const capabilitiesOf = (reply) => reply.text.split(CRLF).map((line) => line.slice(4).trim());

// `connectors` exists so a test can hand in its own sockets.
export async function sendMail(options, connectors = {}) {
  const { host, port, secure, username, password } = { ...parseUrl(options.url), ...options };
  const plain = connectors.net || netConnect;
  const tls = connectors.tls || tlsConnect;
  const client = hostname() || 'status-page';

  const socket = secure
    ? tls({ host, port, servername: host, ...options.tlsOptions })
    : plain({ host, port });

  const session = new Session(socket);
  try {
    await session.read(); // greeting
    let reply = await session.command(`EHLO ${client}`, [250]);
    let capabilities = capabilitiesOf(reply);

    if (!secure && capabilities.some((line) => line.toUpperCase().startsWith('STARTTLS'))) {
      await session.command('STARTTLS', [220]);
      session.detach();
      const upgraded = tls({ socket, host, servername: host, ...options.tlsOptions });
      await new Promise((resolve, reject) => {
        upgraded.once('secureConnect', resolve);
        upgraded.once('error', reject);
      });
      session.attach(upgraded);
      reply = await session.command(`EHLO ${client}`, [250]);
      capabilities = capabilitiesOf(reply);
    }

    await authenticate(session, capabilities, { username, password });

    await session.command(`MAIL FROM:<${options.from}>`, [250]);
    for (const recipient of options.to) {
      await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await session.command('DATA', [354]);
    session.write(buildMessage(options));
    await session.command('.', [250]);
    session.write('QUIT');
  } finally {
    session.socket.destroy();
  }
  return true;
}
