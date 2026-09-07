/**
 * A watch subject as the author wrote it: the allowlist of shapes a subject may
 * be, and the reconstruction of one back into the source text a refusal quotes.
 *
 * D115 P4 R3a: the reconstruction is a total function over an expression, so it
 * reads as a module. Its per-kind renderers are named rather than inlined into
 * one switch, because a reader who arrives asking how a call or an f-string is
 * printed should be able to be sent to the answer.
 */
import { type Expression } from "@velarscript/compiler/extension";

/**
 * D90 R15(a): a watch subject names a place in the reactive graph — the name of
 * a `state` or a `computed`, or a read path out of one — and never computes a
 * value. The rule is written positively, as this allowlist, because that is
 * what makes the relation between a watch and its source *declared* rather than
 * inferred; every earlier attempt to infer it was defeated by one more
 * indirection. A path is legal at any depth and with any index expression:
 * `rows[i].cells[j]` still selects a place, and whether `i` is a constant or
 * another state changes nothing about that. An operator or a call derives a new
 * value instead, and a derived value already has a spelling that names it,
 * caches it, and declares its dependencies. The conditional is an operator by
 * the charter's own vocabulary, and an f-string builds a new string, so neither
 * needs a clause of its own — they simply are not paths.
 *
 * Whether the root of a legal path is reactive is a different question, and
 * `frozenWatchSubject` keeps it: this answers shape only.
 */
export function watchSubjectPath(expression: Expression): boolean {
  switch (expression.kind) {
    case "IdentifierExpression":
      return true;
    case "MemberExpression":
    case "IndexExpression":
      return watchSubjectPath(expression.object);
    default:
      return false;
  }
}


/** The escapes a text literal carries back into source (`scanStringEscape`). */
const WATCH_SUBJECT_TEXT_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  "\"": "\\\"",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/**
 * A text literal written back as source. `LiteralExpression.raw` holds the
 * decoded content without its quotes, so echoing it would quote an expression
 * the author never wrote and hand him a `computed` line that does not compile —
 * `watch term + "!":` would read back as `term + !`. The quote the author chose
 * is not on the node, so every text literal reads back double-quoted; that is a
 * spelling difference, not a meaning one, and it compiles.
 */
function renderWatchTextLiteral(value: string, insideFString: boolean): string {
  let text = "";
  for (const character of value) {
    const escape = WATCH_SUBJECT_TEXT_ESCAPES[character];
    if (escape !== undefined) {
      text += escape;
      continue;
    }
    // `{{` and `}}` are how an f-string carries a brace that is not a hole.
    if (insideFString && (character === "{" || character === "}")) {
      text += `${character}${character}`;
      continue;
    }
    const code = character.codePointAt(0)!;
    text += code < 0x20 || code === 0x7f ? `\\u{${code.toString(16)}}` : character;
  }
  return text;
}

/** The node of one expression kind, which is what each per-kind renderer takes. */
type WatchSubjectOf<Kind extends Expression["kind"]> = Extract<Expression, { readonly kind: Kind }>;

function renderWatchSubjectLiteral(expression: WatchSubjectOf<"LiteralExpression">): string {
  return typeof expression.value === "string" ? `"${renderWatchTextLiteral(expression.value, false)}"` : expression.raw;
}

function renderWatchSubjectMember(expression: WatchSubjectOf<"MemberExpression">): string | null {
  const object = renderWatchSubjectOperand(expression.object);
  return object === null ? null : `${object}${expression.optional ? "?." : "."}${expression.property}`;
}

function renderWatchSubjectIndex(expression: WatchSubjectOf<"IndexExpression">): string | null {
  const object = renderWatchSubjectOperand(expression.object);
  const index = renderWatchSubject(expression.index);
  return object === null || index === null ? null : `${object}${expression.optional ? "?" : ""}[${index}]`;
}

function renderWatchSubjectCall(expression: WatchSubjectOf<"CallExpression">): string | null {
  const callee = renderWatchSubjectOperand(expression.callee);
  if (callee === null) return null;
  const argumentTexts: string[] = [];
  for (const [index, argument] of expression.arguments.entries()) {
    const rendered = renderWatchSubject(argument);
    if (rendered === null) return null;
    const name = expression.argumentNames?.[index] ?? null;
    argumentTexts.push(name === null ? rendered : `${name} = ${rendered}`);
  }
  return `${callee}${expression.optional ? "?" : ""}(${argumentTexts.join(", ")})`;
}

function renderWatchSubjectList(expression: WatchSubjectOf<"ListExpression">): string | null {
  const elements = expression.elements.map((element) => renderWatchSubject(element));
  if (elements.some((element) => element === null)) return null;
  return `[${elements.join(", ")}]`;
}

function renderWatchSubjectObject(expression: WatchSubjectOf<"ObjectExpression">): string | null {
  const entries: string[] = [];
  for (const property of expression.properties) {
    if (property.kind === "ObjectSpread") {
      const value = renderWatchSubjectOperand(property.value);
      if (value === null) return null;
      entries.push(`...${value}`);
      continue;
    }
    if (property.shorthand === true) {
      entries.push(property.name);
      continue;
    }
    const value = renderWatchSubject(property.value);
    if (value === null) return null;
    entries.push(`${property.name}: ${value}`);
  }
  return `{${entries.join(", ")}}`;
}

function renderWatchSubjectArrow(expression: WatchSubjectOf<"ArrowFunctionExpression">): string | null {
  // An annotated or defaulted parameter would need a type printer this file
  // has no business owning; the callback shapes a subject carries do not.
  if (expression.parameters.some((parameter) => parameter.type !== null || parameter.defaultValue !== null)) return null;
  const body = renderWatchSubject(expression.body);
  if (body === null) return null;
  const parameters = expression.parameters.map((parameter) => `${parameter.rest ? "..." : ""}${parameter.name}`);
  const head = expression.parameters.length === 1 && !expression.parameters[0]!.rest
    ? parameters[0]!
    : `(${parameters.join(", ")})`;
  return `${expression.asynchronous ? "async " : ""}${head} => ${body}`;
}

function renderWatchSubjectUnary(expression: WatchSubjectOf<"UnaryExpression">): string | null {
  const operand = renderWatchSubjectOperand(expression.operand);
  if (operand === null) return null;
  const spaced = expression.operator === "not" || expression.operator === "await";
  return `${expression.operator}${spaced ? " " : ""}${operand}`;
}

function renderWatchSubjectBinary(expression: WatchSubjectOf<"BinaryExpression">): string | null {
  const left = renderWatchSubjectOperand(expression.left);
  const right = renderWatchSubjectOperand(expression.right);
  if (left === null || right === null) return null;
  return groupWatchSubject(`${left} ${expression.operator} ${right}`, expression.parenthesized);
}

function renderWatchSubjectComparisonChain(expression: WatchSubjectOf<"ComparisonChainExpression">): string | null {
  const operands = expression.operands.map((operand) => renderWatchSubjectOperand(operand));
  const first = operands[0];
  if (first === undefined || first === null || operands.some((operand) => operand === null)) return null;
  const chain = operands.slice(1).reduce<string>((text, operand, index) => `${text} ${expression.operators[index]} ${operand}`, first);
  return groupWatchSubject(chain, expression.parenthesized);
}

function renderWatchSubjectConditional(expression: WatchSubjectOf<"ConditionalExpression">): string | null {
  const condition = renderWatchSubjectOperand(expression.condition);
  const thenValue = renderWatchSubjectOperand(expression.thenValue);
  const elseValue = renderWatchSubject(expression.elseValue);
  if (condition === null || thenValue === null || elseValue === null) return null;
  return `${condition} ? ${thenValue} : ${elseValue}`;
}

function renderWatchSubjectIs(expression: WatchSubjectOf<"IsExpression">): string | null {
  const value = renderWatchSubjectOperand(expression.value);
  // Only a plain named type reads back as one word; anything generic or
  // optional would need a type printer this file has no business owning.
  if (value === null || expression.type.syntax.kind !== "NamedTypeSyntax") return null;
  return groupWatchSubject(`${value} ${expression.operator} ${expression.type.syntax.name}`, expression.parenthesized);
}

function renderWatchSubjectFString(expression: WatchSubjectOf<"FStringExpression">): string | null {
  let text = "";
  for (const part of expression.parts) {
    if (part.kind === "text") {
      text += renderWatchTextLiteral(part.value, true);
      continue;
    }
    const value = renderWatchSubject(part.value);
    if (value === null) return null;
    text += `{${value}}`;
  }
  return `f"${text}"`;
}

/**
 * The subject as the author wrote it, reconstructed from the AST for exactly
 * the node kinds a subject can be. The analyzer never sees the module text, and
 * a refusal that cannot quote what it refused teaches nothing — so the message
 * quotes this. It is a reconstruction and stays one: it is used in the message
 * only, never in a `fix`, because rewriting an author's source from a
 * reconstruction is a worse defect than the one being reported. Null means
 * "cannot say faithfully", and the message drops the echo rather than guess.
 *
 * Faithfulness is the whole point, so grouping is carried across rather than
 * re-derived: the three nodes that record the author's own parentheses are
 * printed with them, and the low-precedence nodes that record nothing are
 * parenthesized wherever a bare printing would re-associate. The reconstruction
 * therefore parses back to the tree it came from.
 */
export function renderWatchSubject(expression: Expression): string | null {
  switch (expression.kind) {
    case "IdentifierExpression":
      return expression.name;
    case "LiteralExpression":
      return renderWatchSubjectLiteral(expression);
    case "MemberExpression":
      return renderWatchSubjectMember(expression);
    case "IndexExpression":
      return renderWatchSubjectIndex(expression);
    case "CallExpression":
      return renderWatchSubjectCall(expression);
    case "SpreadExpression": {
      const value = renderWatchSubjectOperand(expression.value);
      return value === null ? null : `...${value}`;
    }
    case "RequiredExpression": {
      const value = renderWatchSubjectOperand(expression.value);
      return value === null ? null : `${value}!`;
    }
    case "TryExpression": {
      const value = renderWatchSubjectOperand(expression.value);
      return value === null ? null : `try ${value}`;
    }
    case "ListExpression":
      return renderWatchSubjectList(expression);
    case "ObjectExpression":
      return renderWatchSubjectObject(expression);
    case "ArrowFunctionExpression":
      return renderWatchSubjectArrow(expression);
    case "UnaryExpression":
      return renderWatchSubjectUnary(expression);
    case "BinaryExpression":
      return renderWatchSubjectBinary(expression);
    case "ComparisonChainExpression":
      return renderWatchSubjectComparisonChain(expression);
    case "ConditionalExpression":
      return renderWatchSubjectConditional(expression);
    case "IsExpression":
      return renderWatchSubjectIs(expression);
    case "FStringExpression":
      return renderWatchSubjectFString(expression);
    default:
      return null;
  }
}

/**
 * The same reconstruction in a position where a bare printing would bind
 * differently than the author's source did — a binary operand, the object of a
 * member read, the callee of a call. A conditional or an arrow reaches such a
 * position only through parentheses the author wrote, and neither node records
 * them, so they are restored here.
 */
function renderWatchSubjectOperand(expression: Expression): string | null {
  const rendered = renderWatchSubject(expression);
  if (rendered === null) return null;
  return expression.kind === "ConditionalExpression" || expression.kind === "ArrowFunctionExpression"
    ? `(${rendered})`
    : rendered;
}

/** Restores the parentheses the author wrote, for the three nodes that record them. */
function groupWatchSubject(rendered: string, parenthesized: true | undefined): string {
  return parenthesized === true ? `(${rendered})` : rendered;
}
