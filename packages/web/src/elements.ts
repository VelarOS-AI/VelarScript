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

/** Native elements in the HTML namespace (excluding the SVG and MathML groups). */
export const WEB_HTML_ELEMENTS = new Set(
  WEB_NATIVE_ELEMENT_GROUPS
    .filter((group) => group.family !== "SVG" && group.family !== "MathML")
    .flatMap((group) => group.elements),
);

export const WEB_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

/**
 * HTML attributes whose ordinary bool form is expressed by presence. This is
 * the standard Boolean roster plus `hidden`, whose common bool use has the same
 * shape. It is deliberately not a list of every attribute with a missing-value
 * default: text-valued attributes such as `download` still own their strings.
 */
export const WEB_BOOL_PRESENCE_HTML_ATTRIBUTES: ReadonlySet<string> = new Set([
  "allowfullscreen", "alpha", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer",
  "disabled", "formnovalidate", "headingreset", "hidden", "inert", "ismap", "itemscope", "loop", "multiple", "muted",
  "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected",
  "shadowrootclonable", "shadowrootcustomelementregistry", "shadowrootdelegatesfocus", "shadowrootserializable",
]);

const WEB_RESERVED_CUSTOM_ELEMENT_NAMES = new Set([
  "annotation-xml", "color-profile", "font-face", "font-face-src", "font-face-uri", "font-face-format", "font-face-name", "missing-glyph",
]);

/** HTML custom elements use a lowercase name containing at least one hyphen. */
export function isWebCustomElementName(name: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/u.test(name) && !WEB_RESERVED_CUSTOM_ELEMENT_NAMES.has(name);
}

export interface WebAttributeSpelling {
  /** The VelarScript spelling this name is written as. */
  readonly write: string;
  /**
   * A clause appended after the named spelling when one rename is not the whole
   * answer. Its presence is also the signal that no mechanical fix is offered:
   * an entry without a note is a pure attribute-name rewrite that keeps the
   * value as written, so `velar fix` can apply it.
   */
  readonly note?: string;
}

/**
 * React and JavaScript-property attribute spellings that are definitively wrong
 * on a native element, mapped to the VelarScript spelling that replaces them.
 *
 * The roster is closed and hand written on purpose. An attribute name that is
 * merely unrecognised — `foo="bar"`, a framework's own `hx-*`, a `data-*` — is
 * never diagnosed, because HTML lets a document carry attributes no roster can
 * enumerate and a false positive there would block a correct program. Only a
 * name whose successor is known appears here.
 *
 * The lookup is exact-case and must stay that way. Most entries lowercase onto
 * the very spelling they name — `tabIndex`/`tabindex`, `readOnly`/`readonly`,
 * `charSet`/`charset` — so reading the roster case-insensitively, the way an
 * HTML parser reads an attribute name, would reject the correct spelling.
 *
 * SVG's legitimately camelCase attributes must never be added: `viewBox`,
 * `preserveAspectRatio`, `gradientUnits`, `gradientTransform`, `patternUnits`,
 * `attributeName`, `stdDeviation`, `clipPathUnits` and the rest of that family
 * are correct as written, and their absence from this map is the only thing
 * keeping them legal.
 */
export const WEB_MISSPELLED_ATTRIBUTES: ReadonlyMap<string, WebAttributeSpelling> = new Map<string, WebAttributeSpelling>([
  ["className", { write: "class" }],
  ["htmlFor", { write: "for" }],
  ["tabIndex", { write: "tabindex" }],
  ["readOnly", { write: "readonly" }],
  ["maxLength", { write: "maxlength" }],
  ["minLength", { write: "minlength" }],
  ["colSpan", { write: "colspan" }],
  ["rowSpan", { write: "rowspan" }],
  ["autoComplete", { write: "autocomplete" }],
  ["autoFocus", { write: "autofocus" }],
  ["autoPlay", { write: "autoplay" }],
  ["contentEditable", { write: "contenteditable" }],
  ["crossOrigin", { write: "crossorigin" }],
  ["dateTime", { write: "datetime" }],
  ["encType", { write: "enctype" }],
  ["formAction", { write: "formaction" }],
  ["httpEquiv", { write: "http-equiv" }],
  ["inputMode", { write: "inputmode" }],
  ["noValidate", { write: "novalidate" }],
  ["spellCheck", { write: "spellcheck" }],
  ["srcSet", { write: "srcset" }],
  ["srcLang", { write: "srclang" }],
  ["useMap", { write: "usemap" }],
  ["accessKey", { write: "accesskey" }],
  ["allowFullScreen", { write: "allowfullscreen" }],
  ["charSet", { write: "charset" }],
  ["acceptCharset", { write: "accept-charset" }],
  ["defaultValue", { write: "value", note: "for the initial text, or 'bind:value={state}' when the program also reads the field" }],
  ["defaultChecked", { write: "checked", note: "for the initial state, or 'bind:checked={state}' when the program also reads the box" }],
  ["dangerouslySetInnerHTML", { write: "unsafe:html", note: "with the HTML text itself — VelarScript takes a string rather than a record, and the 'unsafe:' prefix is the escape hatch spelled out" }],
  ["innerHTML", { write: "unsafe:html", note: "with the HTML text — an element's markup is set through the named escape hatch, never through a DOM property name" }],
  ["classList", { write: "class", note: "for a fixed list, or 'class:name={condition}' for one conditional class" }],
  ["classNames", { write: "class", note: "for a fixed list, or 'class:name={condition}' for one conditional class" }],
]);

/**
 * The WAI-ARIA attribute names. ARIA differs from HTML in the way that matters
 * here: its vocabulary is closed, so an `aria-`-prefixed name outside this
 * roster is wrong rather than unrecognised, and saying so costs no correct
 * program.
 */
export const WEB_ARIA_ATTRIBUTES: ReadonlySet<string> = new Set([
  "aria-activedescendant", "aria-atomic", "aria-autocomplete", "aria-braillelabel", "aria-brailleroledescription",
  "aria-busy", "aria-checked", "aria-colcount", "aria-colindex", "aria-colindextext", "aria-colspan",
  "aria-controls", "aria-current", "aria-describedby", "aria-description", "aria-details", "aria-disabled",
  "aria-dropeffect", "aria-errormessage", "aria-expanded", "aria-flowto", "aria-grabbed", "aria-haspopup",
  "aria-hidden", "aria-invalid", "aria-keyshortcuts", "aria-label", "aria-labelledby", "aria-level",
  "aria-live", "aria-modal", "aria-multiline", "aria-multiselectable", "aria-orientation", "aria-owns",
  "aria-placeholder", "aria-posinset", "aria-pressed", "aria-readonly", "aria-relevant", "aria-required",
  "aria-roledescription", "aria-rowcount", "aria-rowindex", "aria-rowindextext", "aria-rowspan",
  "aria-selected", "aria-setsize", "aria-sort", "aria-valuemax", "aria-valuemin", "aria-valuenow",
  "aria-valuetext",
]);

/**
 * The single-token ARIA vocabularies. `aria-relevant` and `aria-dropeffect` are
 * deliberately absent: they take a space-separated token list, and a roster
 * checked as one word would reject a correct value.
 */
export const WEB_ARIA_ENUMERATED_VALUES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["aria-atomic", new Set(["true", "false"])],
  ["aria-autocomplete", new Set(["inline", "list", "both", "none"])],
  ["aria-busy", new Set(["true", "false"])],
  ["aria-checked", new Set(["true", "false", "mixed", "undefined"])],
  ["aria-current", new Set(["page", "step", "location", "date", "time", "true", "false"])],
  ["aria-disabled", new Set(["true", "false"])],
  ["aria-expanded", new Set(["true", "false", "undefined"])],
  ["aria-grabbed", new Set(["true", "false", "undefined"])],
  ["aria-haspopup", new Set(["false", "true", "menu", "listbox", "tree", "grid", "dialog"])],
  ["aria-hidden", new Set(["true", "false", "undefined"])],
  ["aria-invalid", new Set(["true", "false", "grammar", "spelling"])],
  ["aria-live", new Set(["off", "polite", "assertive"])],
  ["aria-modal", new Set(["true", "false"])],
  ["aria-multiline", new Set(["true", "false"])],
  ["aria-multiselectable", new Set(["true", "false"])],
  ["aria-orientation", new Set(["horizontal", "vertical", "undefined"])],
  ["aria-pressed", new Set(["true", "false", "mixed", "undefined"])],
  ["aria-readonly", new Set(["true", "false"])],
  ["aria-required", new Set(["true", "false"])],
  ["aria-selected", new Set(["true", "false", "undefined"])],
  ["aria-sort", new Set(["ascending", "descending", "none", "other"])],
]);

/** The WAI-ARIA 1.2 core role names. */
const WEB_ARIA_CORE_ROLES: readonly string[] = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption", "cell",
  "checkbox", "code", "columnheader", "combobox", "command", "comment", "complementary", "composite",
  "contentinfo", "definition", "deletion", "dialog", "directory", "document", "emphasis", "feed", "figure",
  "form", "generic", "grid", "gridcell", "group", "heading", "img", "input", "insertion", "landmark", "link",
  "list", "listbox", "listitem", "log", "main", "mark", "marquee", "math", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "meter", "navigation", "none", "note", "option", "paragraph",
  "presentation", "progressbar", "radio", "radiogroup", "range", "region", "roletype", "row", "rowgroup",
  "rowheader", "scrollbar", "search", "searchbox", "section", "sectionhead", "select", "separator", "slider",
  "spinbutton", "status", "strong", "structure", "subscript", "suggestion", "superscript", "switch", "tab",
  "table", "tablist", "tabpanel", "term", "textbox", "time", "timer", "toolbar", "tooltip", "tree",
  "treegrid", "treeitem", "widget", "window",
];

/**
 * The DPUB-ARIA document roles. A role module is a W3C Recommendation in its own
 * right, so its names are exactly as standard as the core roster's and leaving
 * one out refuses a correct document — `<nav role="doc-toc">` is the published
 * spelling for a table of contents. The two page-furniture names DPUB-ARIA 1.1
 * adds are carried as well: refusing them would cost the same correct program,
 * and no user agent distinguishes the levels.
 */
const WEB_ARIA_DOCUMENT_ROLES: readonly string[] = [
  "doc-abstract", "doc-acknowledgments", "doc-afterword", "doc-appendix", "doc-backlink", "doc-biblioentry",
  "doc-bibliography", "doc-biblioref", "doc-chapter", "doc-colophon", "doc-conclusion", "doc-cover",
  "doc-credit", "doc-credits", "doc-dedication", "doc-endnote", "doc-endnotes", "doc-epigraph",
  "doc-epilogue", "doc-errata", "doc-example", "doc-footnote", "doc-foreword", "doc-glossary",
  "doc-glossref", "doc-index", "doc-introduction", "doc-noteref", "doc-notice", "doc-pagebreak",
  "doc-pagefooter", "doc-pageheader", "doc-pagelist", "doc-part", "doc-preface", "doc-prologue",
  "doc-pullquote", "doc-qna", "doc-subtitle", "doc-tip", "doc-toc",
];

/**
 * The WAI-ARIA Graphics Module roles. `<svg role="graphics-symbol">` and
 * `role="graphics-object"` are the documented accessible-chart spelling, which
 * is a Web UI surface this package exists to serve.
 */
const WEB_ARIA_GRAPHICS_ROLES: readonly string[] = ["graphics-document", "graphics-object", "graphics-symbol"];

/** The ARIA role names. `role` accepts a space-separated fallback list, so each token is read against this roster. */
export const WEB_ARIA_ROLES: ReadonlySet<string> = new Set([
  ...WEB_ARIA_CORE_ROLES, ...WEB_ARIA_DOCUMENT_ROLES, ...WEB_ARIA_GRAPHICS_ROLES,
]);

/**
 * ARIA role names that a later specification publishes as a second spelling of
 * a role already in the roster. VelarScript names one of the pair so a program
 * has one spelling per idea, and the message says so — calling a standardized
 * name "unknown" would state a falsehood about a published role.
 */
export const WEB_ARIA_ROLE_SYNONYMS: ReadonlyMap<string, string> = new Map([
  ["image", "img"],
]);
