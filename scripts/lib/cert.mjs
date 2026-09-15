// When the TLS certificate behind a monitor runs out.
//
// An expiry is the one outage that is knowable in advance, and the check that
// finds it is a handshake the monitor is making anyway — but only once a day,
// not every five minutes: a certificate changes a few times a year, and an
// extra connection per monitor per run would be paid for nothing.

import { connect } from 'node:tls';
import { isIP } from 'node:net';

export const PROBE_TIMEOUT = 10000;
export const PROBE_EVERY_HOURS = 12;

// Days at which an expiry is worth mentioning again. Warning once is too easy
// to miss and warning every run is noise, so it steps down instead.
export function buckets(threshold) {
  return [...new Set([threshold, 7, 3, 1])]
    .filter((days) => days > 0 && days <= threshold)
    .sort((a, b) => b - a);
}

export const daysUntil = (validTo, now = new Date()) =>
  Math.floor((new Date(validTo) - now) / 86400000);

// Whether this monitor's certificate is worth looking at again yet.
export function due(record, now = new Date(), hours = PROBE_EVERY_HOURS) {
  if (!record?.checkedAt) return true;
  return now - new Date(record.checkedAt) >= hours * 3600000;
}

// The step this many days has come down to, or null while there is still more
// time than the largest one.
export function reached(days, threshold) {
  const passed = buckets(threshold).filter((step) => days <= step);
  return passed.length ? Math.min(...passed) : null;
}

// A warning is due when the expiry has reached a step that has not been
// announced for this certificate yet. Renewing resets it, because the record
// is keyed on the expiry it was announced for.
export function warning(record, threshold, now = new Date()) {
  if (!record?.validTo || !threshold) return null;
  const days = daysUntil(record.validTo, now);
  const step = reached(days, threshold);
  if (step === null) return null;

  const announced = record.notified;
  if (announced?.validTo === record.validTo && announced.step <= step) return null;
  return { days, step };
}

// `connector` exists so a test can hand in its own socket.
export function peerCertificate(host, port, { timeout = PROBE_TIMEOUT } = {}, connector = connect) {
  return new Promise((resolve, reject) => {
    const socket = connector({
      host,
      port: Number(port),
      // SNI takes a name; an address is not one.
      ...(isIP(host) ? {} : { servername: host }),
      // The certificate is read, not trusted. An expiry is worth knowing about
      // even on a chain this runner would refuse, and refusing here would turn
      // a self-signed monitor into a permanent probe failure instead.
      rejectUnauthorized: false,
    });

    const fail = (error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeout);
    socket.once('timeout', () => fail(new Error(`timeout after ${timeout}ms`)));
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      socket.destroy();

      if (!cert?.valid_to) return reject(new Error('no certificate offered'));
      const validTo = new Date(cert.valid_to);
      if (Number.isNaN(validTo.getTime())) {
        return reject(new Error(`unreadable expiry "${cert.valid_to}"`));
      }
      resolve({
        validTo: validTo.toISOString(),
        issuer: cert.issuer?.O || cert.issuer?.CN || null,
      });
    });
  });
}

// Where a monitor's certificate is presented, or null when it has none to
// present. A tcp monitor says so itself, since a port is not evidence of TLS.
export function endpoint(monitor) {
  if (!monitor.cert) return null;
  const url = new URL(monitor.url);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = url.port || (monitor.type === 'http' ? 443 : null);
  return port ? { host, port: Number(port) } : null;
}
