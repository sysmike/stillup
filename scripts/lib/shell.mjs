// Fills index.html in with what the configuration says, so the file a browser
// receives already reads correctly before any script has run.
//
// The page sets the same things again at startup, which is what a reader
// actually sees. This is for everything that never runs a script: the card a
// chat client builds when someone shares the link, a search result, a reader
// who has scripts turned off. Left alone, every deployment advertises itself as
// "Status" in English however it is configured.

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Attribute values in this file never contain a `>`, which is what lets a tag
// be matched without parsing the document.
const TAG = /<([a-z][a-z0-9]*)((?:\s[^>]*)?)>/gi;

// Whatever SITE_SCRIPTS asked for, rendered into tags. The values are escaped
// here as well as checked in the configuration: this is the last place before
// they become markup, and it is cheap.
export function renderScripts(scripts = []) {
  return scripts
    .map((script) => {
      const attributes = Object.entries(script)
        .filter(([name]) => name !== 'code')
        .map(([name, value]) => {
          // `true` is how a bare attribute is written — defer, async — and a
          // false one is simply absent.
          if (value === true) return ` ${name}`;
          if (value === false || value === null || value === undefined) return '';
          return ` ${name}="${escape(value)}"`;
        })
        .join('');
      return `<script${attributes}>${script.code || ''}</script>`;
    })
    .join('\n    ');
}

// What a chat client or a search engine reads to build a card. Left out, they
// fall back to guessing from the page, which for a page rendered by script
// means guessing from almost nothing.
function cardTags({ title, description, url, image, lang }) {
  return [
    ['og:type', 'website'],
    ['og:title', title],
    ['og:description', description],
    ['og:locale', lang],
    ['og:url', url ? `${url}/` : ''],
    ['og:image', image],
    ['twitter:card', 'summary'],
    ['twitter:title', title],
    ['twitter:description', description],
  ]
    .filter(([, content]) => content)
    // og:* is a property, twitter:* is a name. Clients read whichever they
    // expect and ignore the other, but only if it is spelled their way.
    .map(([key, content]) =>
      key.startsWith('og:')
        ? `    <meta property="${key}" content="${escape(content)}" />`
        : `    <meta name="${key}" content="${escape(content)}" />`,
    )
    .join('\n');
}

export function stamp(html, { title, lang, dir, t, description, url, image, scripts = [] }) {
  let out = html;

  // A translated site loads its own dictionary on top of English, and that
  // request is only discovered once app.js has run. Named here it goes out with
  // the rest, which is the difference between the page waiting for it and not.
  if (lang && lang !== 'en') {
    out = out.replace(
      /(\n\s*)<link rel="modulepreload" href="lang\/en\.mjs" \/>/,
      (whole, gap) => `${whole}${gap}<link rel="modulepreload" href="lang/${escape(lang)}.mjs" />`,
    );
  }

  out = out.replace(/<html\b([^>]*)>/i, (whole, attrs) => {
    const withLang = attrs.includes('lang=')
      ? attrs.replace(/\blang="[^"]*"/, `lang="${escape(lang)}"`)
      : ` lang="${escape(lang)}"${attrs}`;
    const withDir = withLang.includes('dir=')
      ? withLang.replace(/\bdir="[^"]*"/, `dir="${escape(dir)}"`)
      : withLang.replace(/\blang="[^"]*"/, (found) => `${found} dir="${escape(dir)}"`);
    return `<html${withDir}>`;
  });

  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escape(title)}</title>`);
  // Blanked rather than unset: a single space is how the line under the banner
  // is turned off, and it is truthy. A card wants a sentence or nothing.
  const summary = (description || '').trim() || t('meta.description');
  out = out.replace(/(<meta\s+name="description"\s+content=")[^"]*"/i, `$1${escape(summary)}"`);

  // After the description, so everything a card is built from sits together.
  out = out.replace(
    /(<meta\s+name="description"[^>]*\/>)/i,
    `$1\n${cardTags({ title, description: summary, url, image, lang })}`,
  );

  // The element's text is replaced, not its markup: the English in the file
  // stays the fallback for anyone building the page without this step.
  out = out.replace(/data-i18n="([\w.]+)"([^>]*)>([^<]*)</g, (whole, key, rest) => {
    return `data-i18n="${key}"${rest}>${escape(t(key))}<`;
  });

  out = out.replace(TAG, (whole, tag, attrs) => {
    const key = attrs.match(/data-i18n-label="([\w.]+)"/)?.[1];
    if (!key) return whole;
    return `<${tag}${attrs.replace(/aria-label="[^"]*"/, `aria-label="${escape(t(key))}"`)}>`;
  });

  // Last in the head, so a snippet that expects the page's own tags to be there
  // finds them, and the stylesheet is already on its way.
  if (scripts.length) out = out.replace('</head>', `  ${renderScripts(scripts)}\n  </head>`);

  return out;
}
