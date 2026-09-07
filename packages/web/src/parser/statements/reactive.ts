/**
 * The five reactive declarations — `state`, `computed`, `resource`, `action`
 * and `watch` — read after their head has already been claimed.
 *
 * Each is a module-level statement and a component item both, so the dispatcher
 * in `parser.ts` and `parseComponent` call the same five readers.
 */
import { type Parameter, type Statement, type Token, type TokenKind, type TypeReference } from "@velarscript/compiler/extension";
import {
  type WebActionDeclaration as ActionDeclaration,
  type WebComputedDeclaration as ComputedDeclaration,
  type WebResourceDeclaration as ResourceDeclaration,
  type WebStateDeclaration as StateDeclaration,
  type WebWatchDeclaration as WatchDeclaration,
} from "../../ast.ts";
import type { Expression } from "@velarscript/compiler/extension";
import { span } from "../spans.ts";

export interface ReactiveParserHost {
  expect(kind: TokenKind, message: string): Token;
  match(kind: TokenKind): boolean;
  matchWord(value: string): boolean;
  parseBlock(): readonly Statement[];
  parseExpression(minimumPrecedence?: number): Expression;
  parseParameters(): readonly Parameter[];
  parseTypeReference(allowTrailingOptional?: boolean): TypeReference;
  previous(): Token;
}

export function parseStateDeclaration(host: ReactiveParserHost, start: number, exported: boolean): StateDeclaration {
  const name = host.expect("identifier", "Expected a state name");
  const type = host.match("colon") ? host.parseTypeReference() : null;
  host.expect("assign", "Expected '=' after state name");
  const initializer = host.parseExpression();
  return { kind: "ExtensionStatement:web:state", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
}

/**
 * D71 rule 182: `computed` parses exactly where `state` parses, through the
 * same shape lookahead — the two halves of the reactive row differ in what
 * they mean, not in how they are written.
 */
export function parseComputedDeclaration(host: ReactiveParserHost, start: number, exported: boolean): ComputedDeclaration {
  const name = host.expect("identifier", "Expected a computed name");
  const type = host.match("colon") ? host.parseTypeReference() : null;
  host.expect("assign", "Expected '=' after computed name");
  const initializer = host.parseExpression();
  return { kind: "ExtensionStatement:web:computed", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
}

export function parseResourceDeclaration(host: ReactiveParserHost, start: number, exported: boolean): ResourceDeclaration {
  const name = host.expect("identifier", "Expected a resource name");
  const type = host.match("colon") ? host.parseTypeReference() : null;
  host.expect("assign", "Expected '=' after resource name");
  const initializer = host.parseExpression();
  return { kind: "ExtensionStatement:web:resource", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
}

export function parseActionDeclaration(host: ReactiveParserHost, start: number, exported: boolean): ActionDeclaration {
  const name = host.expect("identifier", "Expected an action name");
  const parameters = host.parseParameters();
  const parameterListEnd = host.previous().span.end;
  const returnType = host.match("arrow") ? host.parseTypeReference() : null;
  const body = host.parseBlock();
  const end = body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end;
  return {
    kind: "ExtensionStatement:web:action",
    exported,
    name: name.value,
    parameters,
    returnType,
    ...(returnType ? { resultAnnotationSpan: span(parameterListEnd, returnType.span.end) } : {}),
    signatureSpan: span(start, returnType?.span.end ?? parameterListEnd),
    body,
    span: span(start, end),
  };
}

export function parseWatchDeclaration(host: ReactiveParserHost, start: number): WatchDeclaration {
  const expression = host.parseExpression();
  let currentName: string | null = null;
  let previousName: string | null = null;
  if (host.matchWord("as")) {
    currentName = host.expect("identifier", "Expected the current watch value name").value;
    host.expect("comma", "Expected ',' between watch value names");
    previousName = host.expect("identifier", "Expected the previous watch value name").value;
  }
  const body = host.parseBlock();
  return { kind: "ExtensionStatement:web:watch", expression, currentName, previousName, body, span: span(start, body.at(-1)?.span.end ?? expression.span.end) };
}
