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
  assert.match(de, /data-i18n="incidents.all">Alle Vorfälle auf GitHub</);
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

test('the English shell is left as it was written', () => {
  // The file already says these things; stamping them again must not disturb
  // the markup around them.
  const out = build({ title: 'Status' });
  assert.equal(out.replace(/ dir="ltr"/, ''), shell.replace(/<title>[^<]*<\/title>/, '<title>Status</title>'));
});
