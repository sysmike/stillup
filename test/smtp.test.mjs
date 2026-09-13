import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { buildMessage, dotStuff, encodeHeader, parseUrl, sendMail } from '../scripts/lib/smtp.mjs';

// A server that speaks just enough SMTP to record what a client says to it.
// `replies` overrides what a given verb answers, which is how a rejection is
// staged.
function smtpServer({ capabilities = ['SIZE 10240000'], replies = {} } = {}) {
  const conversation = [];
  const server = createServer((socket) => {
    let inData = false;
    let message = '';
    socket.setEncoding('utf8');
    socket.write('220 mail.example.com ESMTP ready\r\n');

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            conversation.push({ verb: 'MESSAGE', line: message });
            socket.write('250 2.0.0 Ok: queued\r\n');
          } else {
            message += `${line}\r\n`;
          }
          continue;
        }

        const verb = line.split(' ')[0].toUpperCase();
        conversation.push({ verb, line });

        if (replies[verb]) {
          socket.write(`${replies[verb]}\r\n`);
          continue;
        }
        if (verb === 'EHLO') {
          const lines = ['250-mail.example.com', ...capabilities.map((c) => `250-${c}`)];
          lines.push('250 HELP');
          socket.write(`${lines.join('\r\n')}\r\n`);
        } else if (verb === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else if (verb === 'AUTH' && line.toUpperCase() === 'AUTH LOGIN') {
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (verb === 'AUTH') {
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (/^[A-Za-z0-9+/=]+$/.test(line) && !verb.includes(':')) {
          // A base64 line during AUTH LOGIN: username first, then password.
          const seen = conversation.filter((entry) => /^[A-Za-z0-9+/=]+$/.test(entry.line)).length;
          socket.write(seen === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 2.7.0 Authentication successful\r\n');
        } else {
          socket.write('250 2.1.0 Ok\r\n');
        }
      }
    });
    socket.on('error', () => {});
  });

  const started = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return { server, conversation, started, close: () => new Promise((resolve) => server.close(resolve)) };
}

const message = {
  from: 'status@example.com',
  to: ['ops@example.com'],
  subject: 'Database is down',
  text: 'Database stopped responding.',
};

test('a message is handed over in the right order', async () => {
  const smtp = smtpServer();
  const port = await smtp.started;
  await sendMail({ url: `smtp://127.0.0.1:${port}`, ...message });
  await smtp.close();

  assert.deepEqual(
    smtp.conversation.map((entry) => entry.verb),
    ['EHLO', 'MAIL', 'RCPT', 'DATA', 'MESSAGE', 'QUIT'],
  );
  assert.match(smtp.conversation[1].line, /^MAIL FROM:<status@example\.com>$/);
  assert.match(smtp.conversation[2].line, /^RCPT TO:<ops@example\.com>$/);
});

test('every recipient gets its own RCPT', async () => {
  const smtp = smtpServer();
  const port = await smtp.started;
  await sendMail({ url: `smtp://127.0.0.1:${port}`, ...message, to: ['a@example.com', 'b@example.com'] });
  await smtp.close();

  const rcpt = smtp.conversation.filter((entry) => entry.verb === 'RCPT').map((entry) => entry.line);
  assert.deepEqual(rcpt, ['RCPT TO:<a@example.com>', 'RCPT TO:<b@example.com>']);
  assert.match(smtp.conversation.find((e) => e.verb === 'MESSAGE').line, /^To: a@example\.com, b@example\.com$/m);
});

test('AUTH PLAIN is used where the server offers it', async () => {
  const smtp = smtpServer({ capabilities: ['AUTH PLAIN LOGIN'] });
  const port = await smtp.started;
  await sendMail({ url: `smtp://user%40example.com:s3cr3t@127.0.0.1:${port}`, ...message });
  await smtp.close();

  const auth = smtp.conversation.find((entry) => entry.verb === 'AUTH');
  const token = Buffer.from(auth.line.split(' ')[2], 'base64').toString('utf8');
  assert.equal(token, '\0user@example.com\0s3cr3t');
});

test('AUTH LOGIN is used where PLAIN is not offered', async () => {
  const smtp = smtpServer({ capabilities: ['AUTH LOGIN'] });
  const port = await smtp.started;
  await sendMail({ url: `smtp://user:pass@127.0.0.1:${port}`, ...message });
  await smtp.close();

  const lines = smtp.conversation.map((entry) => entry.line);
  assert.ok(lines.includes('AUTH LOGIN'));
  assert.ok(lines.includes(Buffer.from('user').toString('base64')));
  assert.ok(lines.includes(Buffer.from('pass').toString('base64')));
});

test('a server without credentials is not asked to authenticate', async () => {
  const smtp = smtpServer();
  const port = await smtp.started;
  await sendMail({ url: `smtp://127.0.0.1:${port}`, ...message });
  await smtp.close();
  assert.equal(smtp.conversation.some((entry) => entry.verb === 'AUTH'), false);
});

test('a rejected recipient fails the send without naming the password', async () => {
  const smtp = smtpServer({ replies: { RCPT: '550 5.1.1 <ops@example.com>: Recipient address rejected' } });
  const port = await smtp.started;
  await assert.rejects(
    sendMail({ url: `smtp://user:hunter2@127.0.0.1:${port}`, ...message }),
    (error) => {
      assert.match(error.message, /RCPT rejected: 550/);
      assert.doesNotMatch(error.message, /hunter2/);
      return true;
    },
  );
  await smtp.close();
});

test('a refused login fails the send', async () => {
  const smtp = smtpServer({ capabilities: ['AUTH PLAIN'], replies: { AUTH: '535 5.7.8 Authentication credentials invalid' } });
  const port = await smtp.started;
  await assert.rejects(sendMail({ url: `smtp://user:wrong@127.0.0.1:${port}`, ...message }), /AUTH rejected: 535/);
  await smtp.close();
});

test('the message carries the headers a server expects', async () => {
  const smtp = smtpServer();
  const port = await smtp.started;
  await sendMail({ url: `smtp://127.0.0.1:${port}`, ...message, subject: '🔴 Database is down' });
  await smtp.close();

  const sent = smtp.conversation.find((entry) => entry.verb === 'MESSAGE').line;
  assert.match(sent, /^From: status@example\.com$/m);
  assert.match(sent, /^Subject: =\?UTF-8\?B\?/m, 'a subject outside ASCII is an encoded word');
  assert.match(sent, /^MIME-Version: 1\.0$/m);
  assert.match(sent, /^Content-Type: text\/plain; charset=utf-8$/m);
  assert.match(sent, /^Message-ID: <.+@status-page>$/m);
  assert.match(sent, /Database stopped responding\./);
});

test('a line of a single dot cannot end the message early', () => {
  assert.equal(dotStuff('before\n.\nafter'), 'before\r\n..\r\nafter');
  assert.equal(dotStuff('. leading dot'), '.. leading dot');
  assert.equal(dotStuff('no dots here'), 'no dots here');
});

test('a header stays as it is while it is ASCII', () => {
  assert.equal(encodeHeader('Database is down'), 'Database is down');
  assert.equal(encodeHeader('🔴 down'), `=?UTF-8?B?${Buffer.from('🔴 down').toString('base64')}?=`);
});

test('the message ends its headers with a blank line', () => {
  const built = buildMessage({ ...message, date: new Date('2026-03-01T12:00:00Z'), id: 'fixed@status-page' });
  const [headers, body] = built.split('\r\n\r\n');
  assert.match(headers, /^From: status@example\.com\r\n/);
  assert.equal(body, 'Database stopped responding.');
  assert.match(built, /^Date: Sun, 01 Mar 2026 12:00:00 GMT$/m);
});

test('the URL says how to connect', () => {
  assert.deepEqual(parseUrl('smtps://user:pass@mail.example.com'), {
    host: 'mail.example.com',
    port: 465,
    secure: true,
    username: 'user',
    password: 'pass',
  });
  assert.partialDeepStrictEqual(parseUrl('smtp://mail.example.com'), { port: 587, secure: false, username: '' });
  assert.partialDeepStrictEqual(parseUrl('smtp://mail.example.com:2525'), { port: 2525 });
  assert.partialDeepStrictEqual(parseUrl('smtp://user%40example.com:p%40ss@mail.example.com'), {
    username: 'user@example.com',
    password: 'p@ss',
  });
});
