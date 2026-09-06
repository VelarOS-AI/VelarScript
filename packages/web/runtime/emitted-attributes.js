function __velarStaticAttr(element, name, value) {
  if (value === false || value == null) return;
  __velarSetAttribute(element, name, __velarAttributeValue(value, name));
}

function __velarAttr(element, name, read, scope) {
  __velarObserver(() => {
    const value = read();
    if (value == null || value === false) __velarRemoveAttribute(element, name);
    else __velarSetAttribute(element, name, __velarAttributeValue(value, name));
  }, "dom", scope);
}

// The attributes whose value the user agent navigates or fetches. For these the
// scheme is part of what the value means, so it is checked; every other
// attribute takes its text unchanged.
const __velarUrlAttributes = ["href", "src", "action", "formaction", "poster", "data", "xlink:href", "ping", "cite"];
const __velarUrlSchemes = ["http", "https", "mailto", "tel", "blob"];
// 'data:' carries its own payload, so it is admitted only for media types the
// user agent cannot execute. 'image/svg+xml' is deliberately absent: an SVG
// document can carry script.
const __velarInertDataTypes = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon",
  "video/mp4", "video/webm", "video/ogg", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
  "font/woff", "font/woff2", "text/plain",
];

// 'javascript:' and 'vbscript:' are code, not locations. A value that arrived as
// data must never become code because it reached an href, so an unknown scheme
// is refused rather than passed through.
function __velarUrlAttributeValue(value, name) {
  let scheme = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // The user agent strips ASCII whitespace and control characters before it
    // parses the scheme, so "java\tscript:" reads as "javascript:" to it and
    // has to read that way here too.
    if (code <= 0x20 || code === 0x7f) continue;
    if (code === 58 && scheme.length > 0) {
      const lowered = scheme.toLowerCase();
      if (lowered === "data") {
        const payload = value.slice(index + 1).toLowerCase();
        for (let type = 0; type < __velarInertDataTypes.length; type += 1) {
          if (payload.startsWith(__velarInertDataTypes[type])) return value;
        }
        throw new TypeError("JSX attribute '" + name + "' rejected a 'data:' URL whose media type is not a known inert one");
      }
      if (__velarHasName(__velarUrlSchemes, lowered)) return value;
      throw new TypeError("JSX attribute '" + name + "' rejected the '" + lowered + ":' URL scheme");
    }
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (letter || (scheme.length > 0 && ((code >= 48 && code <= 57) || code === 43 || code === 45 || code === 46))) {
      scheme += value[index];
      continue;
    }
    // Anything else this early means the value names no scheme: it is a
    // relative URL, which is always the application's own origin.
    return value;
  }
  return value;
}

function __velarAttributeValue(value, name) {
  if (value === true) return "";
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("JSX attribute '" + name + "' requires a finite number");
    return __velarDomString(value);
  }
  if (typeof value !== "string") throw new TypeError("JSX attribute '" + name + "' requires text, a finite number, bool, an enum, or null");
  if (value.length > 1024 * 1024) throw new RangeError("JSX attribute '" + name + "' cannot exceed 1 MiB");
  if (__velarHasName(__velarUrlAttributes, name)) return __velarUrlAttributeValue(value, name);
  return value;
}

function __velarKey(value) {
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("A JSX key number must be finite");
    return value;
  }
  if (typeof value !== "string") throw new TypeError("A JSX key must be a string, string-backed enum, or finite number");
  if (value.length > 65536) throw new RangeError("A JSX key cannot exceed 65536 characters");
  return value;
}

function __velarSetAttribute(element, name, value) {
  if (name.startsWith("xlink:")) __velarDomSetAttributeNS(element, __velarXlinkNamespace, name, value);
  else if (name.startsWith("xml:")) __velarDomSetAttributeNS(element, __velarXmlNamespace, name, value);
  else __velarDomSetAttribute(element, name, value);
}

function __velarRemoveAttribute(element, name) {
  if (name.startsWith("xlink:")) __velarDomRemoveAttributeNS(element, __velarXlinkNamespace, name.slice(6));
  else if (name.startsWith("xml:")) __velarDomRemoveAttributeNS(element, __velarXmlNamespace, name.slice(4));
  else __velarDomRemoveAttribute(element, name);
}

