/**
 * Every attribute a JSX element can carry: the visual directives (`look`,
 * `look:`, `style:`, `class`), the `bind:` family, the `on:` events and the
 * `on`-prefixed names a native element reserves, `ref`, `key`, and the native
 * attribute names and values the DOM and ARIA rosters answer for.
 *
 * D115 P4 R3b. `analyzeNativeJsxAttribute` stays the one guarded chain the
 * order of these rules lives in — the name check sits at its tail so every
 * directive above owns its own spelling — and the arms whose bodies are long
 * enough to read on their own are named functions below it.
 */
import { mechanicalFix, type Span } from "@velarscript/compiler";
import { anyType, boolType, describeType, type Expression, isInvalidType, nonOptional, nullType, numberType, optionalOf, stringType, unknownType, type ValueType } from "@velarscript/compiler/extension";
import { type WebJsxAttribute as JSXAttribute, type WebJsxElementExpression as JSXElementExpression, type WebLookExpression } from "../../ast.ts";
import { WEB_ARIA_ATTRIBUTES, WEB_ARIA_ENUMERATED_VALUES, WEB_ARIA_ROLE_SYNONYMS, WEB_ARIA_ROLES, WEB_BOOL_PRESENCE_HTML_ATTRIBUTES, WEB_HTML_ELEMENTS, WEB_MISSPELLED_ATTRIBUTES, WEB_NATIVE_ELEMENTS } from "../../elements.ts";
import { nearestLookName } from "../../look.ts";
import { lookContributions } from "../look-conditions.ts";
import { lookLiteralZero, mentionsLookUnitType } from "../look-sites.ts";
import { analyzeLookValue } from "../look/entries.ts";
import { reportLookNumberWithoutUnit } from "../look/values.ts";
import { bindTargetGuidance, diagnostic, htmlEventHandlerAttributes, LOOK_PROPERTY_TYPES, nativeDomEventNames, webEventType } from "../web-types.ts";
import { type JsxAnalysisHost } from "./host.ts";
import { reportUrlAttributeScheme } from "./security.ts";

export function analyzeNativeJsxAttribute(host: JsxAnalysisHost, expression: JSXElementExpression, attribute: JSXAttribute): void {
  const value = attribute.value;
  reportUrlAttributeScheme(host, attribute);
  const eventName = attribute.name.startsWith("on:") ? attribute.name.slice(3).split(".")[0] ?? "" : "";
  const expectedEvent = eventName ? webEventType(eventName) : null;
  // GRM-A4: the declared handler type returns null. `() => {}` after a fat
  // arrow is an empty-record factory rather than an empty block, so a handler
  // position that accepted any result silently accepted that record.
  const eventHandlerType: ValueType | null = expectedEvent ? { kind: "function", parameters: [expectedEvent], requiredParameters: 1, result: nullType } : null;
  // An event arrow that assigns a state binding from an event field is the
  // hand-rolled spelling of a two-way binding: it receives bind:value
  // guidance and skips ordinary handler inference so the guidance is not
  // buried under a cascade from the recovered assignment.
  const boundState = (eventName || /^on[A-Z]/u.test(attribute.name)) ? eventAssignedStateBinding(host, value) : null;
  if (boundState) {
    host.diagnostics.push(diagnostic(
      "VEL5019",
      `Use 'bind:value={${boundState}}'; VelarScript binds input state with the bind: directive instead of assigning state from event fields`,
      attribute.span,
    ));
  }
  // A `look=` value is inferred inside its own check so an inline Look block
  // is reported once rather than analyzed as a snapshot as well.
  const inferred = typeof value === "string" ? stringType
    : boundState || attribute.name === "look" ? anyType
      : value ? host.inferExpression(value, eventHandlerType ?? unknownType) : boolType;
  if (attribute.name === "style") {
    host.diagnostics.push(diagnostic("VEL5041", "Raw JSX style is not supported; use style:property for a checked high-priority inline override, or prefer Look for ordinary visuals", attribute.span));
  } else if (attribute.name.startsWith("style:")) {
    analyzeInlineVisualAttribute(host, attribute, inferred, "style");
  } else if (attribute.name === "look") {
    analyzeJsxLookAttribute(host, attribute);
  } else if (attribute.name.startsWith("look:")) {
    analyzeInlineVisualAttribute(host, attribute, inferred, "look");
  } else if (attribute.name === "class") {
    if (!host.isClassInput(inferred)) host.diagnostics.push(diagnostic("VEL5040", `JSX class requires string, string?, or a list of strings; received ${describeType(inferred)}`, attribute.span));
  } else if (attribute.name === "unsafe:html") {
    if (!isInvalidType(inferred) && inferred.kind !== "any" && !host.isOptionalString(inferred)) {
      host.diagnostics.push(diagnostic("VEL5047", `unsafe:html requires string or string?, received ${describeType(inferred)}`, attribute.span));
    }
  // D90 coherence-3, one step sideways: `unsafe:` is a closed prefix with
  // exactly one member, so `unsafe:script=` is wrong by construction rather
  // than merely unrecognised — and it used to be emitted verbatim as a dead
  // attribute, which is the worst possible answer for a name that reads like
  // an escape hatch the author believes they opened.
  } else if (attribute.name.startsWith("unsafe:")) {
    host.diagnostics.push(diagnostic("VEL5015", `Unknown escape hatch '${attribute.name}'; 'unsafe:html' is the only one an element has, and it takes the HTML text as a string`, attribute.span));
  } else if (attribute.name === "bind:value") {
    analyzeBindValue(host, expression, attribute, value, inferred);
  } else if (attribute.name === "bind:checked") {
    analyzeBindChecked(host, expression, attribute, value, inferred);
  } else if (attribute.name === "bind:group") {
    analyzeBindGroup(host, expression, attribute, value, inferred);
  } else if (attribute.name === "ref") {
    analyzeRefAttribute(host, expression, attribute, value);
  // The three branches above are the whole `bind:` family, so a fourth suffix
  // names no binding — and it used to reach the attribute emitter and render
  // a dead `bind:foo` attribute, silently binding nothing. Same shape as the
  // React-spelling rule: a closed VelarScript vocabulary, so an outside name
  // is wrong rather than unknown.
  } else if (attribute.name === "bind" || attribute.name.startsWith("bind:")) {
    reportUnknownBinding(host, attribute);
  // WEB-S1: the guard used to be anchored on an uppercase letter, which
  // closed the React reflex `onClick=` and left the lowercase HTML spelling
  // open. Both are the same attribute — an HTML attribute name is matched
  // ASCII-case-insensitively, and `setAttribute` lowercases on an HTML
  // element, so `onClick` and `ONCLICK` reach `onclick` too. That attribute
  // is the one that matters: the browser compiles its value as script, so any
  // string routed there is executable code in the application's origin, which
  // the charter reserves for `unsafe:html`. So a native element reserves the
  // whole `on` prefix by name rather than by a roster of handler names: a
  // roster leaves the next handler spelling open, and every event is written
  // with the `on:` directive anyway. The lookahead keeps that directive out.
  } else if (/^on(?!:)/iu.test(attribute.name)) {
    reportReservedOnAttribute(host, attribute);
  } else if (attribute.name.startsWith("on:")) {
    analyzeEventDirective(host, attribute, value, inferred, expectedEvent);
  } else if (attribute.name.startsWith("class:")) {
    host.requireAssignable(inferred, boolType, attribute.span);
  } else if (attribute.name === "key" && !isInvalidType(inferred) && inferred.kind !== "string" && inferred.kind !== "number" && inferred.kind !== "enum" && inferred.kind !== "enumMember" && inferred.kind !== "any") {
    host.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
  // The name check sits at the tail of the chain so every directive above it
  // — look:, class:, on:, bind:, ref, key — keeps owning its own spelling and
  // is never read as an HTML attribute name. It reports at most once per
  // attribute and short-circuits the value-shape message, so a React spelling
  // is answered with its successor rather than with two half-answers.
  } else if (!reportNativeAttributeSpelling(host, expression, attribute)
    && !isInvalidType(inferred) && !host.isJsxAttributeValue(inferred)) {
    host.diagnostics.push(diagnostic("VEL5047", `Native JSX attributes require text, finite numbers, bool, enums, or null; received ${describeType(inferred)}`, attribute.span));
  }
  if (!isInvalidType(inferred)) adviseNativeBooleanTextConversion(host, expression.tag, attribute);
  if (attribute.name.startsWith("on:click") && !["button", "a", "input", "select", "textarea", "summary"].includes(expression.tag)
    && !expression.attributes.some((item) => item.name === "role")) host.diagnostics.push(diagnostic("VEL5023", `Clickable <${expression.tag}> requires an explicit role`, expression.span));
}

/**
 * The `look=` attribute on either host kind. A Look block written inline is
 * reported without inferring its entries, so the one directive-level message
 * stands alone; an empty list names the accepted family rather than rendering
 * `List<unknown>` (LOK-I3, LOK-I6).
 */
export function analyzeJsxLookAttribute(host: JsxAnalysisHost, attribute: JSXAttribute): void {
  const value = attribute.value;
  if (!value) {
    host.diagnostics.push(diagnostic("VEL5040", "JSX look requires an expression value", attribute.span));
    return;
  }
  if (typeof value === "string") {
    host.diagnostics.push(diagnostic("VEL5040", "JSX look requires an expression value such as look={cardLook}", attribute.span));
    return;
  }
  if (value.kind === "ExtensionExpression:web:look") {
    host.diagnostics.push(diagnostic("VEL5053", "An inline Look block is not supported; use look:property directives for simple overrides or extract a const Look for conditions and targets", attribute.span));
    return;
  }
  if (value.kind === "ListExpression" && value.elements.length === 0) {
    host.diagnostics.push(diagnostic("VEL5040", "JSX look accepts a Look, a Look?, or a list of Look values; an empty list composes nothing — remove the attribute", attribute.span));
    return;
  }
  const actual = host.inferExpression(value);
  if (!host.isLookInput(actual)) host.diagnostics.push(diagnostic("VEL5040", `JSX look requires Look, Look?, or a list of Look values; received ${describeType(actual)}`, attribute.span));
  if (value.kind === "ListExpression") reportIndependentLookCollisions(host, value, attribute);
}

/**
 * Composition is how a Look overrides another one: `...baseLook` puts the two
 * in an order the reader can see, and everything after it wins. Two looks
 * placed side by side on one element state no order at all, so a property both
 * of them set has no answer the source gives — the winner used to fall out of
 * whichever rule the stylesheet happened to carry last. The shape is refused
 * rather than ordered by fiat, and the refusal names the spelling that states
 * the order the author meant.
 */
export function reportIndependentLookCollisions(host: JsxAnalysisHost, value: Extract<Expression, { kind: "ListExpression" }>, attribute: JSXAttribute): void {
  const entries: { readonly name: string; readonly look: WebLookExpression }[] = [];
  for (const element of value.elements) {
    if (element.kind !== "IdentifierExpression") continue;
    const look = host.lookDeclarations.get(element.name);
    if (look) entries.push({ name: element.name, look });
  }
  for (const [index, first] of entries.entries()) {
    for (const second of entries.slice(index + 1)) {
      if (first.name === second.name) continue;
      const left = lookContributions(first.look, host.lookDeclarations);
      const right = lookContributions(second.look, host.lookDeclarations);
      // A look that composes the other is already ordered against it: the
      // spread says which one is the base, so nothing here is ambiguous.
      if (left.composed.has(second.name) || right.composed.has(first.name)) continue;
      const collision = [...left.properties].find((property) => right.properties.has(property));
      if (collision === undefined) continue;
      const property = collision.slice(collision.indexOf(":") + 1);
      const target = collision.slice(0, collision.indexOf(":"));
      host.diagnostics.push(diagnostic(
        "VEL5068",
        `Look '${first.name}' and Look '${second.name}' both set '${property}'${target ? ` on '@${target}'` : ""}, and placing them side by side states no order between them; write one Look that starts with '...${first.name}' and overrides '${property}' from there, then pass that one`,
        attribute.span,
      ));
      return;
    }
  }
}

export function analyzeInlineVisualAttribute(host: JsxAnalysisHost, attribute: JSXAttribute, actual: ValueType, directive: "look" | "style"): void {
  const property = attribute.name.slice(`${directive}:`.length);
  if (!property) {
    host.diagnostics.push(diagnostic("VEL5038", `A ${directive}: directive requires a camelCase Look property name`, attribute.span));
    return;
  }
  if (attribute.value === null) {
    host.diagnostics.push(diagnostic("VEL5040", `JSX ${directive}:${property} requires a string or expression value`, attribute.span));
    return;
  }
  const expression = typeof attribute.value === "string"
    ? { kind: "LiteralExpression", value: attribute.value, raw: JSON.stringify(attribute.value), span: attribute.span } as const
    : attribute.value;
  if (!analyzeLookValue(host, property, expression, attribute.span, directive)) return;
  const expected = LOOK_PROPERTY_TYPES.get(property) ?? stringType;
  if (mentionsLookUnitType(expected) && lookLiteralZero(expression)) return;
  if (reportLookNumberWithoutUnit(host, property, actual, expected, expression.span)) return;
  if (expected.kind !== "unknown") host.requireAssignable(actual, optionalOf(expected), expression.span);
}

/**
 * A14: `condition ? "true" : "false"` is the expanded spelling of the Core
 * text conversion `str(condition)`. Keep that conversion explicit at a DOM
 * text boundary instead of teaching every attribute its own coercion rule.
 *
 * The rule does not reach component props or HTML bool-presence attributes.
 * A string "false" keeps such an attribute present; accepting that spelling
 * as canonical would hide a likely presence bug whose direct expression is
 * the bool itself.
 */
export function adviseNativeBooleanTextConversion(host: JsxAnalysisHost, tag: string, attribute: JSXAttribute): void {
  if (!WEB_NATIVE_ELEMENTS.has(tag)) return;
  const value = attribute.value;
  if (!value || typeof value === "string" || !plainNativeTextAttribute(tag, attribute.name)) return;
  const written = host.webSourceText.slice(value.span.start, value.span.end);
  if (written.length === 0) return;

  if (value.kind === "ConditionalExpression"
    && value.thenValue.kind === "LiteralExpression" && value.thenValue.value === "true"
    && value.elseValue.kind === "LiteralExpression" && value.elseValue.value === "false") {
    if (host.expandAliases(host.inferredExpressionType(value.condition)).kind !== "bool") return;
    const replacement = host.webSourceText.slice(value.condition.span.start, value.condition.span.end);
    if (!replacement) return;
    // The condition is copied verbatim into str(...), so comments inside it
    // survive. Only comments in discarded punctuation/branches make the
    // mechanical rewrite unsafe.
    const omitted = `${host.webSourceText.slice(value.span.start, value.condition.span.start)}${host.webSourceText.slice(value.condition.span.end, value.span.end)}`;
    host.advise(
      "A14",
      `Native attribute '${attribute.name}' spells this bool as text; write the equivalent str(condition) conversion directly`,
      value.span,
      omitted.includes("//") || omitted.includes("/*")
        ? undefined
        : mechanicalFix(value.span, `str(${replacement})`, `Convert the bool with str() for '${attribute.name}'`),
    );
  }
}

/** Directives and compiler-owned control attributes do not use DOM text conversion. */
function plainNativeTextAttribute(tag: string, name: string): boolean {
  if (WEB_MISSPELLED_ATTRIBUTES.has(name) || /^aria[A-Z]/u.test(name)) return false;
  if (name.startsWith("aria-") && !WEB_ARIA_ATTRIBUTES.has(name)) return false;
  if (WEB_HTML_ELEMENTS.has(tag) && WEB_BOOL_PRESENCE_HTML_ATTRIBUTES.has(name.toLowerCase())) return false;
  return name !== "class" && name !== "host" && name !== "key" && name !== "look" && name !== "ref"
    && name !== "style" && !/^(?:bind|class|look|on|style|unsafe):/u.test(name) && !/^on/iu.test(name);
}

/**
 * D90 coherence-3: DOM attribute names and ARIA are documented as checked
 * surfaces, and nothing checked them — `className="panel"` compiled clean and
 * emitted a dead attribute, while the sibling React reflex `onClick=` on the
 * same element was already refused. So a model got a clean bill of health on
 * exactly the half of its React habit that silently breaks the page.
 *
 * The rule diagnoses names that are KNOWN wrong, never names that are merely
 * unknown. HTML lets a document carry attributes no roster can enumerate, so
 * `foo="bar"`, `data-*`, and a framework's own prefixes stay legal; a false
 * positive there would block a correct program, which is worse than the
 * silence it replaces. Three closed rosters answer three closed questions:
 * the React / JavaScript-property spellings, the ARIA attribute names (ARIA,
 * unlike HTML, admits no custom names), and the ARIA and role vocabularies.
 *
 * D61 bounds the value half. Every native attribute uses the same presence
 * rule: false/null remove it, true writes an empty value, and strings carry
 * literal text. A token vocabulary is therefore read only against a string
 * literal; expression values are runtime questions. A14 separately shortens
 * an explicit bool-to-text conditional to `str(bool)` when that rewrite is
 * provably equivalent.
 *
 * Returns true when it reported, so the caller does not stack a value-shape
 * message on an attribute whose name is already answered.
 */
export function reportNativeAttributeSpelling(host: JsxAnalysisHost, expression: JSXElementExpression, attribute: JSXAttribute): boolean {
  // A custom element owns its own attribute vocabulary, and an unknown tag was
  // already reported as a tag; neither is a surface these rosters describe.
  if (!WEB_NATIVE_ELEMENTS.has(expression.tag)) return false;
  const name = attribute.name;
  // The attribute span opens on the name, so the name occupies its first
  // `name.length` characters — the range a rename rewrites, leaving the value
  // exactly as written.
  const nameSpan: Span = { start: attribute.span.start, end: attribute.span.start + name.length };
  const rename = (write: string) => ({ fix: { title: `Use '${write}'`, edits: [{ span: nameSpan, text: write }] } });
  const spelling = WEB_MISSPELLED_ATTRIBUTES.get(name);
  if (spelling) {
    host.diagnostics.push({
      code: "VEL5070",
      message: `'${name}' is not a native attribute name; write '${spelling.write}'${spelling.note ? ` ${spelling.note}` : ""}`,
      span: attribute.span,
      ...(spelling.note === undefined ? rename(spelling.write) : {}),
    });
    return true;
  }
  if (/^aria[A-Z]/u.test(name)) {
    // Every ARIA attribute is `aria-` followed by one lowercase word, so
    // lowercasing the remainder recovers the spelling whenever one exists.
    const hyphenated = `aria-${name.slice(4).toLowerCase()}`;
    const known = WEB_ARIA_ATTRIBUTES.has(hyphenated);
    host.diagnostics.push({
      code: "VEL5070",
      message: known
        ? `'${name}' is not a native attribute name; ARIA attribute names are hyphenated — write '${hyphenated}'`
        : `'${name}' is not a native attribute name; ARIA attribute names are hyphenated and lowercase, such as 'aria-label'`,
      span: attribute.span,
      ...(known ? rename(hyphenated) : {}),
    });
    return true;
  }
  if (name.startsWith("aria-") && !WEB_ARIA_ATTRIBUTES.has(name)) {
    const nearest = nearestLookName(name, WEB_ARIA_ATTRIBUTES);
    host.diagnostics.push({
      code: "VEL5070",
      message: nearest
        ? `Unknown ARIA attribute '${name}'; did you mean '${nearest}'?`
        : `Unknown ARIA attribute '${name}'; ARIA defines a closed set of aria-* names, so a state or property it does not define belongs on a data-* attribute`,
      span: attribute.span,
      ...(nearest ? rename(nearest) : {}),
    });
    return true;
  }
  // Only a literal value is read. A fix is not registered for a value: the
  // attribute span opens on the name, so the value's own range is not known
  // here, and the message names the token instead.
  const literal = attribute.value;
  // The empty string is not an out-of-vocabulary token: ARIA reads it as the
  // attribute's own default, so `aria-hidden=""` is an uncommon but correct
  // spelling of "not hidden" and refusing it would block a working document.
  // `role=""` is already silent for the same reason — its loop skips empty
  // tokens — so this keeps the two halves of the value check agreeing.
  if (typeof literal !== "string" || literal === "") return false;
  const vocabulary = WEB_ARIA_ENUMERATED_VALUES.get(name);
  if (vocabulary && !vocabulary.has(literal)) {
    const nearest = nearestLookName(literal, vocabulary);
    host.diagnostics.push(diagnostic("VEL5070",
      `'${name}' takes one of ${[...vocabulary].join(", ")}; '${literal}' is not one of them${nearest ? ` — did you mean '${nearest}'?` : ""}`,
      attribute.span));
    return true;
  }
  if (name === "role") {
    // `role` takes a space-separated fallback list, so each token is its own
    // question and only the unknown ones are named.
    let reported = false;
    for (const token of literal.split(/\s+/u)) {
      if (!token || WEB_ARIA_ROLES.has(token)) continue;
      // A published second spelling is answered as a synonym rather than as
      // an unknown name. `image` is ARIA's own later spelling of `img`, and
      // "Unknown ARIA role 'image'" would assert something false about it.
      const synonym = WEB_ARIA_ROLE_SYNONYMS.get(token);
      const nearest = synonym ? null : nearestLookName(token, WEB_ARIA_ROLES);
      host.diagnostics.push(diagnostic("VEL5070", synonym
        ? `ARIA publishes '${token}' and '${synonym}' as one role; VelarScript writes '${synonym}'`
        : nearest
          ? `Unknown ARIA role '${token}'; did you mean '${nearest}'?`
          : `Unknown ARIA role '${token}'; role takes an ARIA role name such as 'button', 'dialog', or 'status'`, attribute.span));
      reported = true;
    }
    return reported;
  }
  return false;
}

/**
 * GRM-A4: an event handler runs for effect and returns null. The hole this
 * closes is `on:click={() => {}}`: after a fat arrow, braces build a record,
 * never a block, so the empty-record factory used to be accepted as a handler
 * and silently did nothing on every click.
 */
export function checkEventHandlerResult(host: JsxAnalysisHost, event: string, value: JSXAttribute["value"], result: ValueType, attributeSpan: Span): void {
  const resolved = host.expandAliases(result);
  // An asynchronous handler stays legal whatever it resolves to: attaching an
  // action directly or through a wrapper is a decided spelling, and an action
  // already owns its pending state, its errors, and its result.
  if (resolved.kind === "promise") return;
  if (resolved.kind === "null" || resolved.kind === "any" || isInvalidType(resolved) || resolved.kind === "unknown") return;
  const emptyRecordBody = value && typeof value !== "string" && value.kind === "ArrowFunctionExpression"
    && value.body.kind === "ObjectExpression" && value.body.properties.length === 0;
  host.diagnostics.push(diagnostic("VEL5021", emptyRecordBody
    ? `Event '${event}' handlers return null, and '{}' after '=>' builds an empty record rather than an empty block; write '() => null' for a handler that does nothing, or name a 'def' that performs the work`
    : `Event '${event}' handlers return null; this handler returns ${describeType(result)} — the result is discarded, so call it inside a 'def' that returns null`, attributeSpan));
}

/**
 * D47 rule 84(A): a bind target is a writable reactive location — a state
 * name, or a record-field / List-index / Map-key path rooted in one. A
 * computed accessor, a const, and a function result stay rejected: nothing
 * would receive the write.
 */
export function isWritableBindTarget(host: JsxAnalysisHost, value: JSXAttribute["value"]): boolean {
  if (!value || typeof value === "string") return false;
  if (value.kind === "IdentifierExpression") return host.writableStateName(value.name);
  return bindPathRoot(host, value) !== null;
}

/**
 * Walks a member/index path inward to its root state binding, checking every
 * segment is a writable location: a declared record field, a List element, or
 * a Map value. Returns the root state name, or null when the path is not a
 * writable reactive location.
 */
export function bindPathRoot(host: JsxAnalysisHost, value: Expression): string | null {
  const segments: Expression[] = [];
  let node: Expression = value;
  while (node.kind === "MemberExpression" || node.kind === "IndexExpression") {
    if (node.kind === "MemberExpression" && node.optional) return null;
    segments.push(node);
    node = node.object;
  }
  if (node.kind !== "IdentifierExpression" || !host.writableStateName(node.name)) return null;
  let current = host.expandAliases(host.lookup(node.name)!.type);
  for (const segment of segments.reverse()) {
    if (segment.kind === "MemberExpression") {
      const fields = current.kind === "object" ? current.fields
        : current.kind === "named" ? host.fieldsOf(current.identity ?? current.name) : null;
      const field = fields?.get(segment.property);
      if (!field) return null;
      current = host.expandAliases(field);
    } else if (current.kind === "list") current = host.expandAliases(current.element);
    else if (current.kind === "map" || current.kind === "record") current = host.expandAliases(current.value);
    else return null;
  }
  return node.name;
}

/**
 * D47 rule 84: `bind:group` binds a set of inputs that share one decision.
 * A radio group holds the selected input's `value`; a checkbox group holds the
 * checked values as a List<string>, so checking and unchecking are membership
 * changes.
 */
export function analyzeBindGroup(host: JsxAnalysisHost, expression: JSXElementExpression, attribute: JSXAttribute, value: JSXAttribute["value"], inferred: ValueType): void {
  const inputType = expression.attributes.find((item) => item.name === "type")?.value;
  const kind = expression.tag === "input" && typeof inputType === "string" && (inputType === "radio" || inputType === "checkbox") ? inputType : null;
  if (!kind) {
    host.diagnostics.push(diagnostic("VEL5019", `bind:group binds a group of choices and requires <input type="radio"> or <input type="checkbox">; use bind:value for a single field and bind:checked for a single flag`, attribute.span));
    return;
  }
  if (!expression.attributes.some((item) => item.name === "value")) {
    host.diagnostics.push(diagnostic("VEL5019", `bind:group identifies each choice by its value attribute; add value="..." to this <input type="${kind}">`, attribute.span));
    return;
  }
  if (!isWritableBindTarget(host, value)) {
    host.diagnostics.push(diagnostic("VEL5019", bindTargetGuidance("bind:group"), attribute.span));
    return;
  }
  const expected: ValueType = kind === "radio" ? stringType : { kind: "list", element: stringType };
  if (kind === "radio" && inferred.kind === "enum") {
    host.enumValueBindings.set(attribute.span.start, inferred.name);
    return;
  }
  host.requireAssignable(inferred, expected, attribute.span);
}

// Matches 'event => stateName = event.field' (any member depth) where the
// assignment target is a writable state binding, and returns that binding's
// name; anything else returns null.
export function eventAssignedStateBinding(host: JsxAnalysisHost, value: JSXAttribute["value"]): string | null {
  if (!value || typeof value === "string") return null;
  if (value.kind !== "ArrowFunctionExpression" || value.asynchronous || value.parameters.length !== 1) return null;
  const body = value.body;
  if (body.kind !== "AssignmentExpression" || body.target.kind !== "IdentifierExpression") return null;
  const state = body.target.name;
  if (!host.writableStateName(state)) return null;
  let source = body.value;
  while (source.kind === "MemberExpression") source = source.object;
  return source.kind === "IdentifierExpression" && source.name === value.parameters[0]!.name && body.value.kind === "MemberExpression"
    ? state
    : null;
}

/** D47 rule 84: `bind:value` holds one field, on the three elements that have one. */
function analyzeBindValue(host: JsxAnalysisHost, expression: JSXElementExpression, attribute: JSXAttribute, value: JSXAttribute["value"], inferred: ValueType): void {
  if (!isWritableBindTarget(host, value)) {
    host.diagnostics.push(diagnostic("VEL5019", bindTargetGuidance("bind:value"), attribute.span));
  } else {
    if (!["input", "textarea", "select"].includes(expression.tag)) host.diagnostics.push(diagnostic("VEL5019", `bind:value is not valid on <${expression.tag}>`, attribute.span));
    const numeric = expression.tag === "input" && expression.attributes.some((item) => item.name === "type" && item.value === "number");
    host.requireAssignable(inferred, numeric ? numberType : stringType, attribute.span);
    if (!numeric && inferred.kind === "enum") host.enumValueBindings.set(attribute.span.start, inferred.name);
  }
}

/** D47 rule 84: `bind:checked` holds one flag, and only a checkbox or radio has one. */
function analyzeBindChecked(host: JsxAnalysisHost, expression: JSXElementExpression, attribute: JSXAttribute, value: JSXAttribute["value"], inferred: ValueType): void {
  if (!isWritableBindTarget(host, value)) {
    host.diagnostics.push(diagnostic("VEL5019", bindTargetGuidance("bind:checked"), attribute.span));
  } else {
    if (expression.tag !== "input") host.diagnostics.push(diagnostic("VEL5019", `bind:checked is not valid on <${expression.tag}>`, attribute.span));
    host.requireAssignable(inferred, boolType, attribute.span);
  }
}

/** `ref` on a native element: the binding it writes has to be optional, so cleanup can restore null, and wide enough for the element the tag names. */
function analyzeRefAttribute(host: JsxAnalysisHost, expression: JSXElementExpression, attribute: JSXAttribute, value: JSXAttribute["value"]): void {
  if (!value || typeof value === "string" || value.kind !== "IdentifierExpression" || !host.lookup(value.name)?.mutable) {
    host.diagnostics.push(diagnostic("VEL5020", "ref requires a mutable let binding", attribute.span));
  } else {
    const bindingType = host.lookup(value.name)!.type;
    const target = nonOptional(bindingType);
    const expected = expression.tag === "canvas" ? "CanvasElement" : expression.tag === "dialog" ? "DialogElement" : expression.tag === "textarea" ? "TextAreaElement" : ["input", "select"].includes(expression.tag) ? "InputElement" : "Element";
    const accepted = expected === "TextAreaElement" ? new Set(["TextAreaElement", "InputElement", "Element"]) : new Set([expected, "Element"]);
    if (bindingType.kind !== "any" && bindingType.kind !== "optional") host.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or a parent element type so cleanup can restore null`, attribute.span));
    else if (target.kind !== "any" && (target.kind !== "named" || !accepted.has(target.name))) host.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or a parent element type`, attribute.span));
  }
}

/** A fourth `bind:` suffix names no binding, so it is answered with the three that exist rather than emitted as a dead attribute. */
function reportUnknownBinding(host: JsxAnalysisHost, attribute: JSXAttribute): void {
  const property = attribute.name.slice("bind:".length);
  const nearest = property ? nearestLookName(property, ["value", "checked", "group"]) : null;
  host.diagnostics.push(diagnostic("VEL5019", property
    ? `Unknown binding 'bind:${property}'${nearest ? `; did you mean 'bind:${nearest}'?` : "; an element binds bind:value for a field, bind:checked for a flag, and bind:group for a set of choices"}`
    : "Use 'bind:value={name}'; the bind directive names the bound property, such as bind:value or bind:checked", attribute.span));
}

/** WEB-S1: the `on` prefix a native element reserves — the message names the `on:` spelling, and says so about the browser only for a name the browser really compiles as script. */
function reportReservedOnAttribute(host: JsxAnalysisHost, attribute: JSXAttribute): void {
  const camel = attribute.name.slice(2);
  const event = camel === "DoubleClick" || camel === "DblClick" ? "dblclick" : camel.toLowerCase();
  // Only a name the browser really compiles as script earns the executable
  // clause; a name that is no event at all is refused by the prefix rule,
  // not by the browser, and a message that claimed otherwise would state a
  // rule the author did not hit. The roster answering that question is
  // HTML's handler attributes, read case-insensitively as the browser reads
  // them — the `on:` directive vocabulary is a different question and
  // answered it wrongly in both directions.
  const executable = htmlEventHandlerAttributes.has(attribute.name.toLowerCase());
  // A concrete `on:` replacement is worth naming only when the remainder is
  // a real event; `onward` would otherwise be answered with `on:ward`.
  const named = executable || nativeDomEventNames.has(event);
  const script = executable
    ? ` — an '${attribute.name}' attribute is compiled as script by the browser, so any value written there runs`
    : "";
  if (attribute.name === "onEnter") {
    host.diagnostics.push(diagnostic("VEL5025", "Use 'on:keydown' with a handler that checks 'event.key == \"Enter\"'; VelarScript has no dedicated enter-key event", attribute.span));
  } else {
    host.diagnostics.push(diagnostic("VEL5025", named
      ? `Use 'on:${event}'; VelarScript event attributes use the on: directive, written 'on:${event}={handler}'${script}`
      : "Use an 'on:event' directive with a native DOM event name, such as 'on:click={handler}' or 'on:keydown={handler}'; an element reserves every attribute name beginning with 'on' other than the 'on:' directive itself, because the handler spellings among them — 'onclick', 'onerror', 'onload' — are executable script in the browser", attribute.span));
  }
}

/** The `on:event.modifier` directive: the modifier vocabulary, and the handler shape the event provides for. */
function analyzeEventDirective(host: JsxAnalysisHost, attribute: JSXAttribute, value: JSXAttribute["value"], inferred: ValueType, expectedEvent: ValueType | null): void {
  const [event, ...modifiers] = attribute.name.slice(3).split(".");
  const supported = new Set(["prevent", "stop", "once", "capture", "self"]);
  if (!event) host.diagnostics.push(diagnostic("VEL5025", "An event directive requires an event name", attribute.span));
  for (const modifier of modifiers) if (!supported.has(modifier)) host.diagnostics.push(diagnostic("VEL5025", `Unknown event modifier '${modifier}'`, attribute.span));
  if (new Set(modifiers).size !== modifiers.length) host.diagnostics.push(diagnostic("VEL5025", "Event modifiers cannot be repeated", attribute.span));
  if (!isInvalidType(inferred) && inferred.kind !== "function" && inferred.kind !== "action" && inferred.kind !== "intrinsic" && inferred.kind !== "any") {
    host.diagnostics.push(diagnostic("VEL5021", `Event '${event}' requires a function`, attribute.span));
  } else if (inferred.kind === "function" || inferred.kind === "action" || inferred.kind === "intrinsic") {
    if (inferred.rest || inferred.parameters.length > 1) host.diagnostics.push(diagnostic("VEL5021", `Event '${event}' handlers accept zero parameters or one ${describeType(expectedEvent ?? { kind: "named", name: "Event" })} parameter`, attribute.span));
    else if (inferred.parameters.length === 1 && expectedEvent && !host.isAssignableHere(expectedEvent, inferred.parameters[0]!)) host.diagnostics.push(diagnostic("VEL5021", `Event '${event}' provides ${describeType(expectedEvent)}, not ${describeType(inferred.parameters[0]!)}`, attribute.span));
    checkEventHandlerResult(host, event ?? "", value, inferred.result, attribute.span);
  }
}
