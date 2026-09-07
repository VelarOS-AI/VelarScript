/**
 * `component Name(props) exposes Handle:` — its prop list, its lifecycle hook
 * names, and the item loop that reads its body.
 *
 * The prop list is the only place `insideComponentProps` is read, and the body
 * loop is the only writer of it, so the depth counter is the one piece of
 * parser state this face declares.
 */
import { typeParameterDeclarationFormsPhrase, type Diagnostic } from "@velarscript/compiler";
import {
  type Parameter,
  type Statement,
  type Token,
  type TokenKind,
} from "@velarscript/compiler/extension";
import {
  type WebComponentDeclaration as ComponentDeclaration,
  type WebComponentItem as ComponentItem,
  type WebExposeDeclaration as ExposeDeclaration,
} from "../../ast.ts";
import { diagnostic, recoveredDiagnostic, span } from "../spans.ts";
import {
  actionHeaderShapes,
  blockHeaderAhead,
  exposeItemAhead,
  namedDeclarationAhead,
  reactiveBindingShapes,
  type StatementHeadParserHost,
} from "./heads.ts";
import {
  parseActionDeclaration,
  parseComputedDeclaration,
  parseResourceDeclaration,
  parseStateDeclaration,
  parseWatchDeclaration,
  type ReactiveParserHost,
} from "./reactive.ts";

const renderBlockSpellings = new Set(["render", "show", "view"]);
const lifecycleHookSpellings = new Set(["mounted", "cleanup"]);

export interface ComponentParserHost extends StatementHeadParserHost, ReactiveParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  consumeNewlines(): void;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expectStatementBoundary(): void;
  insideComponentProps: number;
  matchExtensionKeyword(value: string): boolean;
  parseStatement(): Statement | null;
  // The declarations are read only to be refused, so what they parse to is not
  // part of what this face depends on.
  parseTypeParameters(): unknown;
  peekValue(distance: number): string;
  skipMistypedDeclaration(): void;
}

/**
 * WEB-N4: a component prop list is where a Web author reaches for the HTML
 * names, and `class`, `look`, and the Core keywords are all tokens rather than
 * identifiers. Recovering the keyword as the prop name turns an eleven-message
 * parser cascade into one directed message, and a declaration-position `?`
 * teaches the default value that actually makes a prop omittable.
 */
export function parseComponentProps(host: ComponentParserHost): readonly Parameter[] {
  host.expect("leftParen", "Expected '('");
  const parameters: Parameter[] = [];
  if (!host.check("rightParen")) {
    do {
      if (host.match("ellipsis")) host.diagnostics.push(diagnostic("VEL2016", "Components use named props and do not support rest parameters", host.previous().span));
      // 'class' and 'look' are the props every component already carries, so
      // the same message answers both the keyword token and the now-ordinary
      // name.
      const universalProp = host.checkWord("look") || host.check("class");
      if (universalProp) {
        const token = host.advance();
        host.diagnostics.push(diagnostic(
          "VEL2016",
          `Every component already accepts '${token.value}'; remove it from the prop list and pass it at the call site with ${token.value}={...}`,
          token.span,
        ));
      }
      const nameToken = universalProp ? host.previous() : host.check("identifier") ? host.advance() : componentPropKeyword(host);
      if (!nameToken) {
        host.diagnostics.push(diagnostic("VEL2016", "A component prop list holds 'name: Type' props separated by commas", host.current().span));
        break;
      }
      let optionalMarker = false;
      if (host.check("question")) {
        host.advance();
        optionalMarker = true;
      }
      const type = host.match("colon") ? host.parseTypeReference() : null;
      let defaultValue = host.match("assign") ? host.parseExpression() : null;
      if (optionalMarker) {
        host.diagnostics.push(diagnostic(
          "VEL2016",
          `A component prop becomes omittable through its default value, not through '?': write '${nameToken.value}: Type = default' for a real default, or '${nameToken.value}: Type? = null' when absence is the value`,
          span(nameToken.span.start, (defaultValue ?? type ?? nameToken).span.end),
        ));
        defaultValue ??= { kind: "LiteralExpression", value: null, raw: "null", span: nameToken.span };
      }
      parameters.push({
        name: nameToken.value,
        type: optionalMarker && type ? { syntax: { kind: "OptionalTypeSyntax", inner: type.syntax, span: type.span }, span: type.span } : type,
        defaultValue,
        rest: false,
        span: span(nameToken.span.start, (defaultValue ?? type ?? nameToken).span.end),
      });
    } while (host.match("comma") && !host.check("rightParen"));
  }
  host.expect("rightParen", "Expected ')' after parameters");
  return parameters;
}

/**
 * Consumes a keyword standing where a prop name belongs and reports the one
 * message that names it, or returns null when the token cannot be a name.
 */
function componentPropKeyword(host: ComponentParserHost): Token | null {
  const token = host.current();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(token.value)) return null;
  if (token.kind === "identifier" || token.kind === "eof" || token.kind === "newline") return null;
  host.advance();
  host.diagnostics.push(diagnostic("VEL2016", `'${token.value}' is a VelarScript keyword and cannot name a component prop; choose another name`, token.span));
  return token;
}

/**
 * `@` selects the component's closed compiler namespace. The role names are
 * `mounted` and `cleanup`; neither is found through author-name lookup.
 */
function matchLifecycleHook(host: ComponentParserHost, name: string): boolean {
  if (!host.check("at") || host.peekKind(1) !== "identifier" || host.peekValue(1) !== name) return false;
  host.advance();
  host.advance();
  return true;
}

export function parseComponent(host: ComponentParserHost, start: number, exported: boolean): ComponentDeclaration {
  const name = host.expect("identifier", "Expected a component name");
  if (host.check("less")) {
    host.parseTypeParameters();
    host.diagnostics.push(diagnostic("VEL2025", `Component '${name.value}' cannot declare type parameters; ${typeParameterDeclarationFormsPhrase()} take '<T>'`, name.span));
  }
  host.insideComponentProps += 1;
  const parameters = host.check("leftParen") ? host.parseParameters() : [];
  host.insideComponentProps -= 1;
  for (const parameter of parameters) {
    if (parameter.rest) {
      host.diagnostics.push(diagnostic("VEL2016", "Components use named props and do not support rest parameters", parameter.span));
    }
  }
  const handleType = host.matchExtensionKeyword("exposes") ? host.parseTypeReference() : null;
  host.expect("colon", "Expected ':' before component body");
  host.expect("newline", "Expected a newline before component body");
  host.consumeNewlines();
  host.expect("indent", "Expected an indented component body");
  const body: ComponentItem[] = [];
  host.consumeNewlines();

  while (!host.check("dedent") && !host.check("eof")) {
    const itemStart = host.current().span.start;
    let item: ComponentItem | null = null;
    if (exposeItemAhead(host)) {
      host.advance();
      const value = host.parseExpression();
      item = { kind: "ExtensionStatement:web:expose", value, span: span(itemStart, value.span.end) } satisfies ExposeDeclaration;
    } else if (namedDeclarationAhead(host, "state", reactiveBindingShapes)) {
      host.advance();
      item = parseStateDeclaration(host, itemStart, false);
    } else if (namedDeclarationAhead(host, "computed", reactiveBindingShapes)) {
      host.advance();
      item = parseComputedDeclaration(host, itemStart, false);
    } else if (namedDeclarationAhead(host, "resource", reactiveBindingShapes)) {
      host.advance();
      item = parseResourceDeclaration(host, itemStart, false);
    } else if (namedDeclarationAhead(host, "action", actionHeaderShapes)) {
      host.advance();
      item = parseActionDeclaration(host, itemStart, false);
    } else if (blockHeaderAhead(host, "watch")) {
      host.advance();
      item = parseWatchDeclaration(host, itemStart);
    } else if (matchLifecycleHook(host, "mounted")) {
      const body = host.parseBlock();
      item = { kind: "ExtensionStatement:web:mounted", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) };
    } else if (matchLifecycleHook(host, "cleanup")) {
      const body = host.parseBlock();
      item = { kind: "ExtensionStatement:web:cleanup", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) };
    } else if (host.check("at")) {
      const marker = host.advance();
      const name = host.check("identifier") ? host.advance() : null;
      host.diagnostics.push(diagnostic(
        "VEL5061",
        name
          ? `Unknown compiler-owned name '@${name.value}' in a component; the component namespace contains only '@mounted:' and '@cleanup:'`
          : "Expected a compiler-owned component name after '@'; the component namespace contains only '@mounted:' and '@cleanup:'",
        span(marker.span.start, (name ?? marker).span.end),
      ));
      host.skipMistypedDeclaration();
    } else if (host.check("identifier") && lifecycleHookSpellings.has(host.current().value) && host.peekKind(1) === "colon") {
      // The bare words are ordinary author names. Recover as the one accepted
      // compiler-owned spelling so the body keeps analyzing, while retaining
      // a diagnostic: recovery is not a second alias.
      const keyword = host.advance();
      host.diagnostics.push(recoveredDiagnostic(
        "VEL5061",
        `Use '@${keyword.value}:'; it is a compiler-owned component name, which leaves '${keyword.value}' free for your own method`,
        keyword.span,
      ));
      const body = host.parseBlock();
      item = keyword.value === "mounted"
        ? { kind: "ExtensionStatement:web:mounted", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) }
        : { kind: "ExtensionStatement:web:cleanup", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) };
    } else if (host.check("identifier") && renderBlockSpellings.has(host.current().value) && host.peekKind(1) === "colon") {
      const keyword = host.advance();
      host.diagnostics.push(diagnostic(
        "VEL5048",
        `Use 'return <...>'; a component returns its JSX directly and has no '${keyword.value}:' block`,
        keyword.span,
      ));
      host.skipMistypedDeclaration();
    } else {
      item = host.parseStatement() as ComponentItem | null;
    }
    if (item) body.push(item);
    if (host.previous().kind !== "dedent") host.expectStatementBoundary();
    host.consumeNewlines();
  }
  const close = host.expect("dedent", "Expected the end of component body");
  return { kind: "ExtensionStatement:web:component", exported, name: name.value, parameters, handleType, body, span: span(start, body.at(-1)?.span.end ?? close.span.end) };
}
