/**
 * The three signature shapes a declaration member can take — a function
 * declaration's, a method's, an accessor's — read off the text `scanning.ts`
 * handed over.
 */
import { matchingDelimiter, topLevelTerminator } from "./scanning.ts";

export function readFunctionSignature(source: string, start: number): { readonly generic: boolean; readonly parameters: string; readonly result: string } | null {
  let cursor = skipWhitespace(source, start);
  let generic = false;
  if (source[cursor] === "<") {
    const end = matchingDelimiter(source, cursor, "<", ">");
    if (end < 0) return null;
    generic = true;
    cursor = skipWhitespace(source, end + 1);
  }
  if (source[cursor] !== "(") return null;
  const close = matchingDelimiter(source, cursor, "(", ")");
  if (close < 0) return null;
  const parameters = source.slice(cursor + 1, close);
  cursor = skipWhitespace(source, close + 1);
  if (source[cursor] !== ":") return null;
  const end = topLevelTerminator(source, cursor + 1, ";");
  if (end < 0) return null;
  const result = source.slice(cursor + 1, end).trim();
  return result ? { generic, parameters, result } : null;
}

export function readMethodSignature(source: string): { readonly name: string; readonly optional: boolean; readonly parameters: string; readonly result: string } | null {
  const prefix = /^([A-Za-z_$][\w$]*)(\?)?\s*/u.exec(source);
  if (!prefix) return null;
  const open = prefix[0].length;
  if (source[open] !== "(") return null;
  const close = matchingDelimiter(source, open, "(", ")");
  if (close < 0) return null;
  const colon = skipWhitespace(source, close + 1);
  if (source[colon] !== ":") return null;
  const result = source.slice(colon + 1).trim();
  return result ? { name: prefix[1]!, optional: Boolean(prefix[2]), parameters: source.slice(open + 1, close), result } : null;
}

export function readAccessorSignature(source: string): {
  readonly modifiers: readonly string[];
  readonly kind: "get" | "set";
  readonly name: string;
  readonly type: string;
} | null {
  const prefix = /^((?:(?:public|static|override)\s+)*)(get|set)\s+([A-Za-z_$][\w$]*)\s*/u.exec(source);
  if (!prefix) return null;
  const open = prefix[0].length;
  if (source[open] !== "(") return null;
  const close = matchingDelimiter(source, open, "(", ")");
  if (close < 0) return null;
  const parameters = source.slice(open + 1, close).trim();
  const tail = source.slice(close + 1).trim();
  if (prefix[2] === "get") {
    const result = /^:\s*(.+)$/u.exec(tail);
    if (parameters || !result) return null;
    return {
      modifiers: (prefix[1] ?? "").trim().split(/\s+/u).filter(Boolean),
      kind: "get",
      name: prefix[3]!,
      type: result[1]!,
    };
  }
  const parameter = /^[A-Za-z_$][\w$]*\s*:\s*(.+)$/u.exec(parameters);
  if (!parameter || tail) return null;
  return {
    modifiers: (prefix[1] ?? "").trim().split(/\s+/u).filter(Boolean),
    kind: "set",
    name: prefix[3]!,
    type: parameter[1]!,
  };
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}
