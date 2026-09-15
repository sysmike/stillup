import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buckets, daysUntil, due, endpoint, peerCertificate, reached, warning } from '../scripts/lib/cert.mjs';

const NOW = new Date('2026-03-01T12:00:00Z');
const inDays = (days) => new Date(NOW.getTime() + days * 86400000).toISOString();

test('a warning steps down rather than being said once or every run', () => {
  assert.deepEqual(buckets(14), [14, 7, 3, 1]);
  assert.deepEqual(buckets(7), [7, 3, 1]);
  assert.deepEqual(buckets(3), [3, 1]);
  // Nothing to warn about means no steps to warn at.
  assert.deepEqual(buckets(0), []);
});

test('the step a given number of days has come down to', () => {
  assert.equal(reached(30, 14), null, 'still further out than the first step');
  assert.equal(reached(14, 14), 14);
  assert.equal(reached(8, 14), 14);
  assert.equal(reached(7, 14), 7);
  assert.equal(reached(2, 14), 3);
  assert.equal(reached(0, 14), 1);
  assert.equal(reached(-5, 14), 1, 'expired is past every step, not before them');
});

test('days are counted down, not rounded to the nearest', () => {
  assert.equal(daysUntil(inDays(30), NOW), 30);
  // Most of a day left is not a whole day left.
  assert.equal(daysUntil(new Date(NOW.getTime() + 0.9 * 86400000).toISOString(), NOW), 0);
  assert.equal(daysUntil(inDays(-1), NOW), -1);
});

test('a certificate is looked at once a day, not once a run', () => {
  assert.equal(due(undefined, NOW), true, 'never looked at');
  assert.equal(due({ checkedAt: new Date(NOW.getTime() - 3600000).toISOString() }, NOW), false);
  assert.equal(due({ checkedAt: new Date(NOW.getTime() - 13 * 3600000).toISOString() }, NOW), true);
});

test('each step is announced once, and only as it is reached', () => {
  const record = { validTo: inDays(10), checkedAt: NOW.toISOString() };
  const first = warning(record, 14, NOW);
  assert.deepEqual(first, { days: 10, step: 14 });

  const announced = { ...record, notified: { validTo: record.validTo, step: 14 } };
  assert.equal(warning(announced, 14, NOW), null, 'the same step does not repeat');

  // Five days later the next step has been reached.
  const later = new Date(NOW.getTime() + 5 * 86400000);
  assert.deepEqual(warning(announced, 14, later), { days: 5, step: 7 });
});

test('renewing starts the warnings over, and a fresh certificate says nothing', () => {
  const expiring = { validTo: inDays(3), notified: { validTo: inDays(3), step: 3 } };
  assert.equal(warning(expiring, 14, NOW), null);

  const renewed = { ...expiring, validTo: inDays(90) };
  assert.equal(warning(renewed, 14, NOW), null, 'ninety days out is not worth saying');

  // Renewed, but only barely: the steps apply again because the expiry changed.
  const shortRenewal = { ...expiring, validTo: inDays(6) };
  assert.deepEqual(warning(shortRenewal, 14, NOW), { days: 6, step: 7 });
});

test('nothing is warned about without a certificate or without a threshold', () => {
  assert.equal(warning(undefined, 14, NOW), null);
  assert.equal(warning({ checkedAt: NOW.toISOString() }, 14, NOW), null);
  assert.equal(warning({ validTo: inDays(1) }, 0, NOW), null, 'zero turns the warnings off');
});

test('where a monitor presents its certificate, if it presents one', () => {
  assert.deepEqual(endpoint({ cert: true, type: 'http', url: 'https://example.com/health' }), {
    host: 'example.com',
    port: 443,
  });
  assert.deepEqual(endpoint({ cert: true, type: 'http', url: 'https://example.com:8443/' }), {
    host: 'example.com',
    port: 8443,
  });
  assert.deepEqual(endpoint({ cert: true, type: 'tcp', url: 'tcp://mail.example.com:465' }), {
    host: 'mail.example.com',
    port: 465,
  });
  assert.equal(endpoint({ cert: false, type: 'http', url: 'https://example.com' }), null);
  assert.equal(endpoint({ cert: true, type: 'ping', url: 'ping://example.com' }), null, 'no port, no handshake');
});

// A socket that behaves the way node:tls does, so the probe can be driven
// without a server to connect to.
function fakeSocket({ cert, fail } = {}) {
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.setTimeout = () => {};
  socket.destroy = () => {
    socket.destroyed = true;
  };
  socket.getPeerCertificate = () => cert;
  queueMicrotask(() => {
    if (fail) socket.emit('error', new Error(fail));
    else socket.emit('secureConnect');
  });
  return socket;
}

test('the expiry is read off the certificate and normalised', async () => {
  let asked;
  const connector = (options) => {
    asked = options;
    return fakeSocket({ cert: { valid_to: 'Dec  4 14:46:49 2026 GMT', issuer: { O: "Let's Encrypt" } } });
  };
  const result = await peerCertificate('status.example.com', 443, {}, connector);
  assert.deepEqual(result, { validTo: '2026-12-04T14:46:49.000Z', issuer: "Let's Encrypt" });
  assert.equal(asked.servername, 'status.example.com');
  // Read, not trusted: an expiry matters on a chain this runner would refuse.
  assert.equal(asked.rejectUnauthorized, false);
});

test('an address is not a server name, so SNI is left off', async () => {
  let asked;
  const connector = (options) => {
    asked = options;
    return fakeSocket({ cert: { valid_to: 'Dec  4 14:46:49 2026 GMT' } });
  };
  await peerCertificate('192.0.2.10', 443, {}, connector);
  assert.equal('servername' in asked, false);
});

test('a host that offers nothing readable fails rather than guessing', async () => {
  await assert.rejects(
    peerCertificate('example.com', 443, {}, () => fakeSocket({ cert: {} })),
    /no certificate offered/,
  );
  await assert.rejects(
    peerCertificate('example.com', 443, {}, () => fakeSocket({ cert: { valid_to: 'whenever' } })),
    /unreadable expiry/,
  );
  await assert.rejects(
    peerCertificate('example.com', 443, {}, () => fakeSocket({ fail: 'ECONNREFUSED' })),
    /ECONNREFUSED/,
  );
});
