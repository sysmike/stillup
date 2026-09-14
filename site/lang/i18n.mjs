// The page's text, kept apart from the code that arranges it.
//
// A dictionary is a flat map of key to string. A string that counts something
// is an object of plural categories instead, chosen for the locale by
// Intl.PluralRules: English needs two forms, Polish three, Arabic six, and
// which two English needs says nothing about which anyone else needs.

import en from './en.mjs';

// A language needs a file here and its tag listed, so an unknown SITE_LANG is
// refused while the site is being built rather than 404ing in a reader's
// browser.
export const LANGUAGES = ['en', 'de'];

const PLACEHOLDER = /\{(\w+)\}/g;

export function create(locale, dict) {
  const plural = new Intl.PluralRules(locale);
  const formatters = new Map();

  // Formatters cost more to construct than to use, and the strip asks for one
  // per hovered bar, so they are kept.
  const formatter = (kind, name, options) => {
    const key = `${name}:${JSON.stringify(options)}`;
    let made = formatters.get(key);
    if (!made) {
      made = new kind(locale, options);
      formatters.set(key, made);
    }
    return made;
  };

  function t(key, params) {
    let template = dict[key];
    // An object holds the plural categories. A locale with no form for this
    // count falls back to `other`, which every locale defines.
    if (template && typeof template === 'object') {
      template = template[plural.select(Number(params?.count))] ?? template.other;
    }
    // A missing key shows as the key itself: louder than a blank, and a test
    // keeps one from reaching a reader.
    if (typeof template !== 'string') return key;
    if (!params) return template;
    return template.replace(PLACEHOLDER, (whole, name) => (name in params ? String(params[name]) : whole));
  }

  const amount = (value, unit, unitDisplay) =>
    formatter(Intl.NumberFormat, 'number', { style: 'unit', unit, unitDisplay }).format(value);

  // How long something lasted, which is a measurement rather than a point in
  // time, so it goes through the unit formatter rather than the relative one. A
  // single unit has room to be spelled out; a pair is kept narrow so it stays
  // on one line beside whatever it belongs to.
  function duration(from, to) {
    const minutes = Math.max(1, Math.round((new Date(to) - new Date(from)) / 60000));
    if (minutes < 60) return amount(minutes, 'minute', 'long');
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${amount(hours, 'hour', 'narrow')} ${amount(minutes % 60, 'minute', 'narrow')}`;
    }
    return `${amount(Math.floor(hours / 24), 'day', 'narrow')} ${amount(hours % 24, 'hour', 'narrow')}`;
  }

  return { locale, t, formatter, duration };
}

export const english = create('en', en);

// English with a translation laid over it, so a key the translator has not
// reached yet still says something rather than nothing.
export async function load(lang) {
  if (!lang || lang === 'en' || !LANGUAGES.includes(lang)) return english;
  const { default: translation } = await import(`./${lang}.mjs`);
  return create(lang, { ...en, ...translation });
}
