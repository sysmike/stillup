import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import en from '../site/lang/en.mjs';
import { LANGUAGES, create, direction, english, load } from '../site/lang/i18n.mjs';

const PLACEHOLDER = /\{(\w+)\}/g;
const forms = (value) => (typeof value === 'string' ? [value] : Object.values(value));
const names = (value) => new Set(forms(value).flatMap((text) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1])));

test('a value is a string or a set of plural forms, never anything else', () => {
  for (const [key, value] of Object.entries(en)) {
    const kind = typeof value;
    assert.ok(kind === 'string' || kind === 'object', `${key} is a ${kind}`);
    if (kind === 'object') {
      assert.ok(value.other, `${key} has no "other" form, the one every locale defines`);
      for (const form of Object.values(value)) assert.equal(typeof form, 'string', `${key} has a non-string form`);
    }
  }
});

// The page asks for keys by name, so a translation that renames or drops one
// silently falls back to English. Better to hear about it here.
for (const lang of LANGUAGES.filter((tag) => tag !== 'en')) {
  test(`${lang} translates keys that exist and no others`, async () => {
    const { default: translation } = await import(`../site/lang/${lang}.mjs`);
    const extra = Object.keys(translation).filter((key) => !(key in en));
    assert.deepEqual(extra, [], `${lang} has keys English does not`);

    const missing = Object.keys(en).filter((key) => !(key in translation));
    assert.deepEqual(missing, [], `${lang} is missing keys`);
  });

  test(`${lang} keeps every placeholder the page fills in`, async () => {
    const { default: translation } = await import(`../site/lang/${lang}.mjs`);
    for (const [key, value] of Object.entries(translation)) {
      // A plural form may leave out the count it is chosen by — "No incidents
      // in the last day" needs no number in it — so the English forms are
      // pooled and the translation may use any of them, but none beyond.
      const allowed = names(en[key]);
      for (const name of names(value)) {
        assert.ok(allowed.has(name), `${lang} ${key} fills in {${name}}, which the page does not provide`);
      }
    }
  });
}

test('a plural form is chosen by the locale, not by English', () => {
  const pl = create('pl', {
    'strip.checks': { one: '{count} sprawdzenie', few: '{count} sprawdzenia', many: '{count} sprawdzeń' },
  });
  assert.equal(pl.t('strip.checks', { count: 1 }), '1 sprawdzenie');
  assert.equal(pl.t('strip.checks', { count: 3 }), '3 sprawdzenia');
  assert.equal(pl.t('strip.checks', { count: 25 }), '25 sprawdzeń');
});

test('a locale with no form for a count falls back to other', () => {
  const partial = create('pl', { 'strip.checks': { other: '{count} razy' } });
  assert.equal(partial.t('strip.checks', { count: 3 }), '3 razy');
});

test('a placeholder the caller does not fill is left alone rather than blanked', () => {
  assert.equal(english.t('incident.downFor', {}), 'Down for {duration}');
  assert.equal(english.t('incident.downFor', { duration: '5m' }), 'Down for 5m');
});

test('a key with no string shows as itself, so it cannot pass for text', () => {
  assert.equal(english.t('nothing.here'), 'nothing.here');
});

test('a translation is laid over English, so an untranslated key still reads', async () => {
  const de = await load('de');
  assert.equal(de.locale, 'de');
  assert.equal(de.t('incidents.title'), 'Vorfälle');

  const partial = create('de', { ...en, 'incidents.title': 'Vorfälle' });
  assert.equal(partial.t('footer.source'), 'Source');
});

test('an unknown language falls back to English rather than failing to load', async () => {
  assert.equal((await load('tlh')).locale, 'en');
  assert.equal((await load('')).locale, 'en');
});

test('the sentence with an element in it keeps the placeholder that positions it', () => {
  for (const [key, value] of Object.entries(en)) {
    if (key !== 'empty.monitors') continue;
    assert.ok(value.includes('{name}'), 'the page splits this string on {name}');
  }
});

// The page and the dictionary are edited separately, so they are checked
// against each other: a key asked for but never written shows as its own name
// on the page, which is the kind of thing that ships unnoticed.
test('every key the page asks for by name exists', () => {
  const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');

  const asked = new Set();
  for (const [, key] of app.matchAll(/\bt\('([\w.]+)'/g)) asked.add(key);
  for (const [, key] of html.matchAll(/data-i18n(?:-label)?="([\w.]+)"/g)) asked.add(key);

  assert.ok(asked.size > 20, 'the page should be asking for rather more keys than this');
  for (const key of asked) assert.ok(key in en, `the page asks for ${key}, which no dictionary has`);
});

// The keys built from a value rather than written out, which the scan above
// cannot see.
test('every key the page builds from a status or a state exists', () => {
  for (const status of ['up', 'degraded', 'partial', 'down', 'none']) {
    assert.ok(`status.${status}` in en, `status.${status}`);
    assert.ok(`banner.${status}` in en, `banner.${status}`);
  }
  for (const state of ['open', 'maintenance', 'resolved']) {
    assert.ok(`incident.state.${state}` in en, `incident.state.${state}`);
  }
});

test('a language says which way it is written', async () => {
  assert.equal(direction('en'), 'ltr');
  assert.equal(direction('de'), 'ltr');
  assert.equal(direction('ar'), 'rtl');
  assert.equal(direction('he-IL'), 'rtl');
  assert.equal((await load('de')).dir, 'ltr');
  assert.equal(create('fa', en).dir, 'rtl');
});

test('the stylesheet mirrors rather than assuming a side', () => {
  const css = readFileSync(new URL('../site/style.css', import.meta.url), 'utf8');
  const physical = [...css.matchAll(/^\s*((?:margin|padding|border)-(?:left|right)|left|right|text-align:\s*(?:left|right))/gm)];
  assert.deepEqual(
    physical.map((match) => match[1]),
    [],
    'a physical side does not flip for a right-to-left language; use the logical property',
  );
});

// The reverse of the check above: a translation that drops a placeholder leaves
// the page missing a name, a count or a date, with nothing to say so.
for (const lang of LANGUAGES.filter((tag) => tag !== 'en')) {
  test(`${lang} keeps the placeholders a plain string cannot do without`, async () => {
    const { default: translation } = await import(`../site/lang/${lang}.mjs`);
    for (const [key, value] of Object.entries(en)) {
      // A plural form may leave out the count it was chosen by: "No incidents
      // in the last day" needs no number in it. A plain string may not.
      if (typeof value !== 'string' || typeof translation[key] !== 'string') continue;
      for (const name of names(value)) {
        assert.ok(names(translation[key]).has(name), `${lang} ${key} drops {${name}}`);
      }
    }
  });
}
