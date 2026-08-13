export interface WebElementGroup {
  readonly family: string;
  readonly elements: readonly string[];
}

/** Standard, non-obsolete native element names accepted by Web JSX. */
export const WEB_NATIVE_ELEMENT_GROUPS: readonly WebElementGroup[] = Object.freeze([
  { family: "document and sections", elements: ["html", "head", "body", "main", "header", "footer", "nav", "section", "article", "aside", "address", "h1", "h2", "h3", "h4", "h5", "h6", "hgroup", "search"] },
  { family: "text content", elements: ["div", "p", "hr", "pre", "blockquote", "ol", "ul", "menu", "li", "dl", "dt", "dd", "figure", "figcaption"] },
  { family: "inline text", elements: ["a", "em", "strong", "small", "s", "cite", "q", "dfn", "abbr", "ruby", "rt", "rp", "data", "time", "code", "var", "samp", "kbd", "sub", "sup", "i", "b", "u", "mark", "bdi", "bdo", "span", "br", "wbr"] },
  { family: "media and embedding", elements: ["picture", "source", "img", "audio", "video", "track", "map", "area", "iframe", "embed", "object", "canvas"] },
  { family: "tables", elements: ["table", "caption", "colgroup", "col", "tbody", "thead", "tfoot", "tr", "td", "th"] },
  { family: "forms", elements: ["form", "label", "input", "button", "select", "datalist", "optgroup", "option", "textarea", "output", "progress", "meter", "fieldset", "legend"] },
  { family: "interactive and metadata", elements: ["details", "summary", "dialog", "slot", "template", "noscript", "base", "link", "meta", "style", "title"] },
  { family: "SVG", elements: ["svg", "g", "defs", "desc", "symbol", "use", "switch", "view", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath", "marker", "pattern", "clipPath", "mask", "linearGradient", "radialGradient", "stop", "image", "foreignObject", "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence", "animate", "animateMotion", "animateTransform", "mpath", "set"] },
  { family: "MathML", elements: ["math", "annotation", "annotation-xml", "maction", "menclose", "merror", "mfenced", "mfrac", "mi", "mmultiscripts", "mn", "mo", "mover", "mpadded", "mphantom", "mprescripts", "mroot", "mrow", "ms", "mspace", "msqrt", "mstyle", "msub", "msubsup", "msup", "mtable", "mtd", "mtext", "mtr", "munder", "munderover", "semantics"] },
]);

export const WEB_NATIVE_ELEMENTS = new Set(WEB_NATIVE_ELEMENT_GROUPS.flatMap((group) => group.elements));

export const WEB_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

const WEB_RESERVED_CUSTOM_ELEMENT_NAMES = new Set([
  "annotation-xml", "color-profile", "font-face", "font-face-src", "font-face-uri", "font-face-format", "font-face-name", "missing-glyph",
]);

/** HTML custom elements use a lowercase name containing at least one hyphen. */
export function isWebCustomElementName(name: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/u.test(name) && !WEB_RESERVED_CUSTOM_ELEMENT_NAMES.has(name);
}
