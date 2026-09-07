/**
 * The URL-scheme rule: which attributes carry a URL, and what a written one is
 * refused for.
 *
 * D115 P4 R3a: one question about one string — asked of a literal `href`, of a
 * JSX attribute value, and of an interpolation's parts — so it is written once
 * here rather than in the middle of the analyzer's JSX pass.
 */

// WEB-S2: the attributes whose value the browser resolves as a URL and then
// navigates, fetches, or submits to. A `javascript:`/`vbscript:` string in one
// of them is script the page runs, which is the boundary the charter reserves
// for `unsafe:html` — so the scheme is checked wherever it is written down.
export const WEB_URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "data", "xlink:href", "ping", "cite"]);
const WEB_SCRIPT_URL_SCHEMES = new Set(["javascript", "vbscript"]);
// A `data:` URL is a document the browser builds from the string itself, so it
// is inert only for the media types that cannot carry script. `image/svg+xml`
// is deliberately absent: an SVG document runs script.
const WEB_INERT_DATA_MEDIA_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon",
  "video/mp4", "video/webm", "video/ogg", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
  "font/woff", "font/woff2", "font/ttf", "font/otf", "text/plain", "text/css",
]);

/**
 * The scheme a browser reads out of a URL string. Leading and embedded ASCII
 * whitespace and control characters are stripped first, because the URL parser
 * strips them too — `java\tscript:alert(1)` is a `javascript:` URL.
 */
function urlAttributeScheme(value: string): { readonly scheme: string; readonly rest: string } | null {
  const stripped = value.replace(/[\u0000-\u0020]/gu, "");
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(stripped);
  return match ? { scheme: match[1]!.toLowerCase(), rest: stripped.slice(match[0].length) } : null;
}

/** The clause naming why one literal URL is refused, or null when it is fine. */
export function urlSchemeRefusal(value: string): string | null {
  const parsed = urlAttributeScheme(value);
  if (!parsed) return null;
  if (WEB_SCRIPT_URL_SCHEMES.has(parsed.scheme)) {
    return `'${parsed.scheme}:' is script, not a location — write an 'on:click' handler for behavior, or a real URL for navigation`;
  }
  if (parsed.scheme !== "data") return null;
  const media = (/^([^,;]*)/u.exec(parsed.rest)?.[1] ?? "").toLowerCase();
  if (WEB_INERT_DATA_MEDIA_TYPES.has(media)) return null;
  return `a 'data:' URL is only accepted for a media type that cannot carry script${media ? `, and '${media}' can` : ""}; the inert types are ${[...WEB_INERT_DATA_MEDIA_TYPES].join(", ")}`;
}
