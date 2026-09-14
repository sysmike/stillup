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

export function stamp(html, { title, lang, dir, t }) {
  let out = html;

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
  out = out.replace(
    /(<meta\s+name="description"\s+content=")[^"]*"/i,
    `$1${escape(t('meta.description'))}"`,
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

  return out;
}
