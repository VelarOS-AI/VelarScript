/**
 * Parameter lists: a callable's, and a constructor's with its parameter
 * properties. The element type is parsed by the caller's `parse`, so this
 * module knows arity, optionality and rest position and no type syntax.
 */
import { optionalOf, type ValueType } from "@velarscript/compiler";
import { unsupportedType, type DeclarationDirection } from "./bridge.ts";
import { splitTopLevel } from "./scanning.ts";

function parseRestElementType(source: string, parse: (value: string) => ValueType): ValueType | null {
  let value = source.trim();
  if (value.startsWith("readonly ")) value = value.slice("readonly ".length).trim();
  if (value.endsWith("[]")) return parse(value.slice(0, -2));
  const generic = /^(?:Array|ReadonlyArray)\s*<([\s\S]+)>$/u.exec(value);
  return generic && splitTopLevel(generic[1] ?? "", ",").length === 1 ? parse(generic[1] ?? "unknown") : null;
}

/**
 * Drops TypeScript's `this` pseudo-parameter. It only types the receiver, it
 * carries no runtime argument, and it is legal only in first position — so
 * counting it as positional gives every correct call site an arity error with
 * no value the author could supply.
 */
function withoutThisParameter(parts: string[]): string[] {
  return parts.length > 0 && /^this\s*:/u.test(parts[0]!) ? parts.slice(1) : parts;
}

export function parseParameters(
  source: string,
  parse: (value: string) => ValueType,
  warnings: string[],
): { readonly types: readonly ValueType[]; readonly required: number; readonly rest?: ValueType; readonly invalid?: true } {
  if (!source.trim()) return { types: [], required: 0 };
  const types: ValueType[] = [];
  let required = 0;
  let optionalSeen = false;
  let invalid = false;
  let rest: ValueType | undefined;
  const parts = withoutThisParameter(splitTopLevel(source, ","));
  for (const [index, part] of parts.entries()) {
    const match = /^(\.\.\.)?[A-Za-z_$][\w$]*(\?)?\s*:\s*(.+)$/su.exec(part.trim());
    if (!match) {
      warnings.push(`Unsupported parameter declaration '${part.trim()}' was kept as unknown`);
      types.push(unsupportedType);
      optionalSeen = true;
      continue;
    }
    const optional = Boolean(match[2]);
    if (match[1]) {
      if (index !== parts.length - 1) warnings.push(`Rest parameter '${part.trim()}' is not final and was kept as unknown`);
      if (optional) warnings.push(`Optional rest parameter '${part.trim()}' was kept as unknown`);
      const element = parseRestElementType(match[3] ?? "unknown", parse);
      if (element && index === parts.length - 1 && !optional) rest = element;
      else {
        if (!element) warnings.push(`Rest parameter '${part.trim()}' must use an array type and was kept as unknown`);
        rest = unsupportedType;
      }
      continue;
    }
    const type = parse(match[3] ?? "unknown");
    types.push(type);
    if (!optional && optionalSeen) {
      warnings.push(`Required parameter '${part.trim()}' follows an optional parameter and the callable was kept as unknown`);
      invalid = true;
    }
    if (!optional && !optionalSeen) required += 1;
    if (optional) optionalSeen = true;
  }
  return { types, required, ...(rest ? { rest } : {}), ...(invalid ? { invalid: true } : {}) };
}

export function parseClassConstructorParameters(
  source: string,
  parse: (value: string, direction?: DeclarationDirection) => ValueType,
  warnings: string[],
): {
  readonly types: readonly ValueType[];
  readonly required: number;
  readonly rest?: ValueType;
  readonly fields: ReadonlyMap<string, { readonly mutable: boolean; readonly type: ValueType }>;
} {
  if (!source.trim()) return { types: [], required: 0, fields: new Map() };
  const types: ValueType[] = [];
  const fields = new Map<string, { readonly mutable: boolean; readonly type: ValueType }>();
  let required = 0;
  let optionalSeen = false;
  let rest: ValueType | undefined;
  const parts = withoutThisParameter(splitTopLevel(source, ","));
  for (const [index, part] of parts.entries()) {
    const match = /^((?:(?:public|private|protected|readonly)\s+)*)(\.\.\.)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/su.exec(part.trim());
    if (!match) {
      warnings.push(`Unsupported constructor parameter declaration '${part.trim()}' was kept as unknown`);
      types.push(unsupportedType);
      optionalSeen = true;
      continue;
    }
    const modifiers = new Set((match[1] ?? "").trim().split(/\s+/u).filter(Boolean));
    const optional = Boolean(match[4]);
    if (match[2]) {
      if (index !== parts.length - 1) warnings.push(`Rest parameter '${part.trim()}' is not final and was kept as unknown`);
      if (optional || modifiers.size > 0) warnings.push(`Rest parameter '${part.trim()}' cannot be optional or declare a parameter property`);
      const element = parseRestElementType(match[5] ?? "unknown", (value) => parse(value, "to-js"));
      if (element && index === parts.length - 1 && !optional && modifiers.size === 0) rest = element;
      else rest = unsupportedType;
      continue;
    }
    const sourceType = match[5] ?? "unknown";
    const parameterType = parse(sourceType, "to-js");
    types.push(parameterType);
    if (!optional && optionalSeen) {
      warnings.push(`Required constructor parameter '${part.trim()}' follows an optional parameter`);
    }
    if (!optional && !optionalSeen) required += 1;
    if (optional) optionalSeen = true;
    if (modifiers.has("readonly") || modifiers.has("public")) {
      const mutable = !modifiers.has("readonly");
      if (optional && mutable) warnings.push(`Optional mutable parameter property '${match[3]}' has no exact VelarScript field contract`);
      const fieldType = parse(sourceType, mutable ? "invariant" : "from-js");
      fields.set(match[3]!, { mutable, type: optional ? optionalOf(fieldType) : fieldType });
    }
  }
  return { types, required, ...(rest ? { rest } : {}), fields };
}
