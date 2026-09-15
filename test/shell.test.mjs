import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from '../site/lang/i18n.mjs';
import { stamp } from '../scripts/lib/shell.mjs';

const shell = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const english = await load('en');
const german = await load('de');

const build = (options) =>
  stamp(shell, { title: 'Acme Status', lang: english.locale, dir: english.dir, t: english.t, ...options });

test('the document says which language it is in, and which way it runs', () => {
  assert.match(build(), /<html lang="en" dir="ltr"/);
  assert.match(build({ lang: 'de', dir: 'ltr' }), /<html lang="de" dir="ltr"/);
  assert.match(build({ lang: 'ar', dir: 'rtl' }), /<html lang="ar" dir="rtl"/);
  // Whatever else the tag carries stays on it.
  assert.match(build(), /<html[^>]*data-theme="auto"/);
});

// What a chat client or a search result reads, neither of which runs the page.
test('the title and description are the configured ones, not the defaults', () => {
  assert.match(build(), /<title>Acme Status<\/title>/);
  assert.match(build(), /name="description" content="Service status and uptime history"/);

  const de = build({ title: 'Acme Status', lang: 'de', dir: 'ltr', t: german.t });
  assert.match(de, /name="description" content="Dienststatus und Verfügbarkeitsverlauf"/);
});

test('a title is escaped rather than trusted', () => {
  const out = build({ title: 'Acme & Co <script>alert(1)</script>' });
  assert.match(out, /<title>Acme &amp; Co &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/);
  assert.doesNotMatch(out, /<title>[^<]*<script>/);
});

test('an attribute value cannot be broken out of', () => {
  const out = build({ title: '" onload="steal()' });
  assert.match(out, /<title>&quot; onload=&quot;steal\(\)<\/title>/);
});

test('the shell text is translated in place, markup untouched', () => {
  const de = build({ title: 'Acme Status', lang: 'de', dir: 'ltr', t: german.t });
  assert.match(de, /<h2 class="section-title" data-i18n="incidents.title">Vorfälle<\/h2>/);
  assert.match(de, /data-i18n="footer.source">Quelle</);
  assert.match(de, /data-i18n="incidents.all"[^>]*>Alle Vorfälle auf GitHub</);
});

test('an accessible name is translated where the element carries one', () => {
  const de = build({ title: 'Acme Status', lang: 'de', dir: 'ltr', t: german.t });
  assert.match(de, /data-i18n-label="a11y.close"[^>]*aria-label="Schließen"/);
  assert.match(de, /data-i18n-label="a11y.toggleTheme"[^>]*aria-label="Design umschalten"/);
  // The icons inside those buttons keep the attribute that hides them.
  assert.match(de, /<svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true">/);
});

test('every marked element is reached, so none is left in the wrong language', () => {
  const de = build({ title: 'Acme Status', lang: 'de', dir: 'ltr', t: german.t });
  for (const [, key] of shell.matchAll(/data-i18n="([\w.]+)"/g)) {
    assert.match(de, new RegExp(`data-i18n="${key.replace('.', '\\.')}"[^>]*>${german.t(key)}<`));
  }
  for (const [, key] of shell.matchAll(/data-i18n-label="([\w.]+)"/g)) {
    assert.ok(de.includes(`aria-label="${german.t(key)}"`), `${key} was not applied`);
  }
});

test('stamping adds to the shell without disturbing what is already there', () => {
  // The file already says most of this; stamping it again must leave every
  // line it did not put there exactly as it was.
  const out = build({ title: 'Status' });
  const added = /^\s*<meta (property="og:|name="twitter:)/;
  for (const line of shell.split('\n')) {
    if (line.includes('<html ')) continue; // dir is added to it
    assert.ok(out.includes(line), `stamping lost: ${line.trim()}`);
  }
  const extra = out.split('\n').filter((line) => !shell.includes(line));
  assert.ok(
    extra.every((line) => added.test(line) || line.includes('<html ')),
    `stamping added something unexpected: ${extra.filter((l) => !added.test(l) && !l.includes('<html ')).join(' | ')}`,
  );
});

test('a head with nothing added to it is left alone', () => {
  assert.equal(build({ scripts: [] }), build());
  // The page's own module tag is in the body; nothing should join it in the head.
  const head = build().slice(0, build().indexOf('</head>'));
  assert.doesNotMatch(head, /<script/);
});

test('an analytics snippet arrives as the vendor writes it', () => {
  const out = build({
    scripts: [{ src: 'https://cloud.umami.is/script.js', defer: true, 'data-website-id': 'abc-123' }],
  });
  assert.match(out, /<script src="https:\/\/cloud\.umami\.is\/script\.js" defer data-website-id="abc-123"><\/script>/);
  // Last in the head, after everything the page ships with, and still inside it.
  assert.match(out, /<script src="https:\/\/cloud[^>]*><\/script>\n\s*<\/head>/);
  assert.ok(out.indexOf('style.css') < out.indexOf('cloud.umami.is'));
});

test('an inline script keeps its code', () => {
  assert.match(build({ scripts: [{ code: 'window.x = 1 < 2 && 3 > 2;' }] }), /<script>window\.x = 1 < 2 && 3 > 2;<\/script>/);
});

test('a false attribute is absent rather than written as false', () => {
  const out = build({ scripts: [{ src: 'a.js', defer: false, async: true }] });
  assert.match(out, /<script src="a\.js" async><\/script>/);
});

test('an attribute value cannot close the tag it sits in', () => {
  const out = build({ scripts: [{ src: 'a.js', 'data-id': '" onload="steal()' }] });
  assert.match(out, /data-id="&quot; onload=&quot;steal\(\)"/);
  assert.doesNotMatch(out, /onload="steal/);
});

test('more than one script keeps its order', () => {
  const out = build({ scripts: [{ src: 'first.js' }, { src: 'second.js' }] });
  assert.ok(out.indexOf('first.js') < out.indexOf('second.js'));
});

test('the shell names the modules the page will import', () => {
  // Without these the browser finds each import only after parsing the one
  // before it, and the status request queues behind all of them.
  assert.match(shell, /<link rel="modulepreload" href="lang\/i18n\.mjs" \/>/);
  assert.match(shell, /<link rel="modulepreload" href="lang\/en\.mjs" \/>/);
});

test('a translated site names its own dictionary too', () => {
  const de = build({ lang: 'de', dir: 'ltr', t: german.t });
  assert.match(de, /<link rel="modulepreload" href="lang\/de\.mjs" \/>/);
  // After English, which it is laid over, and only once.
  assert.ok(de.indexOf('lang/en.mjs') < de.indexOf('lang/de.mjs'));
  assert.equal(de.match(/modulepreload/g).length, 3);
});

test('an English site names no second dictionary', () => {
  assert.equal(build().match(/modulepreload/g).length, 2);
});

test('a shared link carries what a card is built from', () => {
  const out = build({ description: 'Uptime for Acme', url: 'https://status.example.com', image: 'https://status.example.com/logo.png' });
  assert.match(out, /<meta property="og:title" content="Acme Status" \/>/);
  assert.match(out, /<meta property="og:description" content="Uptime for Acme" \/>/);
  assert.match(out, /<meta property="og:url" content="https:\/\/status\.example\.com\/" \/>/);
  assert.match(out, /<meta property="og:image" content="https:\/\/status\.example\.com\/logo\.png" \/>/);
  assert.match(out, /<meta property="og:locale" content="en" \/>/);
  // og uses property, twitter uses name, and a client reads only its own.
  assert.match(out, /<meta name="twitter:card" content="summary" \/>/);
  assert.match(out, /<meta name="twitter:title" content="Acme Status" \/>/);
});

test('the configured description wins, and the dictionary stands in', () => {
  const described = build({ description: 'Uptime for Acme' });
  assert.match(described, /<meta name="description" content="Uptime for Acme" \/>/);
  assert.match(described, /<meta property="og:description" content="Uptime for Acme" \/>/);

  const bare = build();
  assert.match(bare, /<meta name="description" content="Service status and uptime history" \/>/);
  assert.match(bare, /<meta property="og:description" content="Service status and uptime history" \/>/);
});

test('a tag with nothing to say is left out rather than left empty', () => {
  const out = build();
  assert.doesNotMatch(out, /content=""/);
  assert.doesNotMatch(out, /og:image/, 'a site with no logo has no picture to offer');
  assert.doesNotMatch(out, /og:url/);
});

test('a card cannot be used to smuggle markup into the head', () => {
  const out = build({ description: '"><script>alert(1)</script>' });
  assert.match(out, /og:description" content="&quot;&gt;&lt;script&gt;/);
  assert.doesNotMatch(out, /<script>alert/);
});

test('a description blanked with a space is no description', () => {
  // A single space is how the line under the banner is turned off, and it is
  // truthy: left alone it would reach a card as a space.
  const out = build({ description: ' ' });
  assert.match(out, /<meta name="description" content="Service status and uptime history" \/>/);
  assert.match(out, /<meta property="og:description" content="Service status and uptime history" \/>/);
  assert.doesNotMatch(out, /content=" "/);
});
