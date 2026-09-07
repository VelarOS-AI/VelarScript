/**
 * TypeScript type syntax, read one family at a time. `parseTsType` recognizes
 * which family a type expression belongs to; each recognizer below owns that
 * family and calls back for the parts it contains.
 */
import { optionalOf, readonlyViewOf, unionOf, type ValueType } from "@velarscript/compiler";
import {
  boolType,
  bytesType,
  float32BufferType,
  nullType,
  numberType,
  oppositeDirection,
  stringType,
  uint8BufferType,
  uint16BufferType,
  uint32BufferType,
  unknownType,
  unsupportedType,
  type DeclarationDirection,
} from "./bridge.ts";
import { parseParameters } from "./parameters.ts";
import { balanced, splitFields, splitTopLevel } from "./scanning.ts";
import { readMethodSignature } from "./signatures.ts";

export function parseTsType(
  source: string,
  aliases: ReadonlyMap<string, string>,
  warnings: string[],
  stack: ReadonlySet<string>,
  classTypes: ReadonlyMap<string, ValueType> = new Map(),
  direction: DeclarationDirection = "from-js",
): ValueType {
  let value = source.trim();
  while (value.startsWith("(") && value.endsWith(")") && balanced(value.slice(1, -1))) value = value.slice(1, -1).trim();
  if (/^readonly\s+/u.test(value)) return readonlyTsType(value, aliases, warnings, stack, classTypes, direction);
  const union = splitTopLevel(value, "|");
  if (union.length > 1) return unionTsType(value, union, aliases, warnings, stack, classTypes, direction);
  if (value.endsWith("[]")) return {
    kind: "list",
    element: parseTsType(value.slice(0, -2), aliases, warnings, stack, classTypes, "invariant"),
  };
  // The safe bridge maps storage semantics, not the host's incidental API.
  // Node Buffer is a Uint8Array representation and therefore enters source as
  // read-only Bytes; no Buffer-only member is exposed.
  if (value === "Uint8Array" || value === "Buffer") return direction === "to-js" ? unionOf([bytesType, uint8BufferType]) : bytesType;
  if (value === "Uint16Array") return uint16BufferType;
  if (value === "Uint32Array") return uint32BufferType;
  if (value === "Float32Array") return float32BufferType;
  const generic = /^([A-Za-z_$][\w$]*)\s*<([\s\S]+)>$/u.exec(value);
  if (generic) return genericTsType(generic, aliases, warnings, stack, classTypes, direction);
  const arrow = /^\(([^()]*)\)\s*=>\s*(.+)$/u.exec(value);
  if (arrow) return arrowTsType(arrow, aliases, warnings, stack, classTypes, direction);
  if (value.startsWith("{") && value.endsWith("}")) return objectType(value.slice(1, -1), aliases, warnings, stack, classTypes, direction);
  return terminalTsType(value, aliases, warnings, stack, classTypes, direction);
}

/** `readonly T[]`, the one readonly spelling the bridge can carry across. */
function readonlyTsType(
  value: string,
  aliases: ReadonlyMap<string, string>,
  warnings: string[],
  stack: ReadonlySet<string>,
  classTypes: ReadonlyMap<string, ValueType>,
  direction: DeclarationDirection,
): ValueType {
    const inner = value.replace(/^readonly\s+/u, "");
    if (inner.endsWith("[]")) {
      return readonlyViewOf({
        kind: "list",
        element: parseTsType(inner.slice(0, -2), aliases, warnings, stack, classTypes, direction),
      });
    }
    warnings.push(`Readonly TypeScript type '${value}' is outside the VelarScript declaration bridge and was kept as unknown`);
    return unsupportedType;
}

/** A union, and the `null` / `undefined` members that make it optional. */
function unionTsType(
  value: string,
  union: readonly string[],
  aliases: ReadonlyMap<string, string>,
  warnings: string[],
  stack: ReadonlySet<string>,
  classTypes: ReadonlyMap<string, ValueType>,
  direction: DeclarationDirection,
): ValueType {
    const hasNull = union.includes("null");
    const hasUndefined = union.includes("undefined");
    const members = union.filter((part) => part !== "null" && part !== "undefined").map((part) => parseTsType(part, aliases, warnings, stack, classTypes, direction));
    if (direction === "invariant" && hasUndefined) {
      warnings.push(`Type '${value}' admits JavaScript undefined in a writable position and was kept as unknown`);
      return unsupportedType;
    }
    if (members.length === 0) {
      if (hasNull || (hasUndefined && direction === "from-js")) return nullType;
      warnings.push(`Type '${value}' cannot be supplied from VelarScript and was kept as unknown`);
      return unsupportedType;
    }
    const type = unionOf(members);
    return hasNull || (hasUndefined && direction === "from-js") ? optionalOf(type) : type;
}

/** `Name<…>`: the collection, promise and buffer constructors the bridge knows. */
function genericTsType(
  generic: RegExpExecArray,
  aliases: ReadonlyMap<string, string>,
  warnings: string[],
  stack: ReadonlySet<string>,
  classTypes: ReadonlyMap<string, ValueType>,
  direction: DeclarationDirection,
): ValueType {
    const arguments_ = splitTopLevel(generic[2] ?? "", ",");
    if (generic[1] === "Uint8Array" || generic[1] === "Buffer") return direction === "to-js" ? unionOf([bytesType, uint8BufferType]) : bytesType;
    if (generic[1] === "Uint16Array") return uint16BufferType;
    if (generic[1] === "Uint32Array") return uint32BufferType;
    if (generic[1] === "Float32Array") return float32BufferType;
    if (generic[1] === "Array") return {
      kind: "list",
      element: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, "invariant"),
    };
    if (generic[1] === "Set") return { kind: "set", element: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, "invariant") };
    if (generic[1] === "Map") return {
      kind: "map",
      key: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, "invariant"),
      value: parseTsType(arguments_[1] ?? "unknown", aliases, warnings, stack, classTypes, "invariant"),
    };
    if (generic[1] === "ReadonlyArray" || generic[1] === "ReadonlySet") {
      const element = parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, direction);
      return readonlyViewOf(generic[1] === "ReadonlyArray" ? { kind: "list", element } : { kind: "set", element });
    }
    if (generic[1] === "ReadonlyMap") return readonlyViewOf({
      kind: "map",
      key: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, direction),
      value: parseTsType(arguments_[1] ?? "unknown", aliases, warnings, stack, classTypes, direction),
    });
    if (generic[1] === "Promise") return { kind: "promise", value: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, direction) };
    if (generic[1] === "Record") {
      warnings.push("TypeScript Record is a plain JavaScript object, not a VelarScript Map, and was kept as unknown");
      return unsupportedType;
    }
    warnings.push(`Generic type '${generic[1]}' is outside the VelarScript declaration bridge and was kept as unknown`);
    return unsupportedType;
}

/** `(…) => T`, whose parameters cross in the opposite direction to its result. */
function arrowTsType(
  arrow: RegExpExecArray,
  aliases: ReadonlyMap<string, string>,
  warnings: string[],
  stack: ReadonlySet<string>,
  classTypes: ReadonlyMap<string, ValueType>,
  direction: DeclarationDirection,
): ValueType {
    const parameters = parseParameters(arrow[1] ?? "", (part) => parseTsType(part, aliases, warnings, stack, classTypes, oppositeDirection(direction)), warnings);
    if (parameters.invalid) return unsupportedType;
    const resultSource = arrow[2] ?? "unknown";
    return {
      kind: "function",
      parameters: parameters.types,
      requiredParameters: parameters.required,
      ...(parameters.rest ? { rest: parameters.rest } : {}),
      result: resultSource.trim() === "void" ? nullType : parseTsType(resultSource, aliases, warnings, stack, classTypes, direction),
    };
}

/**
 * The terminals: literal types, the primitive names, and finally a name that
 * must resolve to a class in scope or an alias this reader has not entered yet.
 */
function terminalTsType(
  value: string,
  aliases: ReadonlyMap<string, string>,
  warnings: string[],
  stack: ReadonlySet<string>,
  classTypes: ReadonlyMap<string, ValueType>,
  direction: DeclarationDirection,
): ValueType {
  if (/^['"`]/u.test(value)) {
    if (direction === "from-js") return stringType;
    warnings.push(`String literal type '${value}' cannot be widened safely in an input position and was kept as unknown`);
    return unsupportedType;
  }
  if (/^-?\d/u.test(value)) {
    if (direction === "from-js") return numberType;
    warnings.push(`Numeric literal type '${value}' cannot be widened safely in an input position and was kept as unknown`);
    return unsupportedType;
  }
  if (value === "true" || value === "false") {
    if (direction === "from-js") return boolType;
    warnings.push(`Boolean literal type '${value}' cannot be widened safely in an input position and was kept as unknown`);
    return unsupportedType;
  }
  if (value === "string") return stringType;
  if (value === "number") return numberType;
  if (value === "boolean") return boolType;
  if (value === "void") {
    if (direction === "from-js") return nullType;
    warnings.push("TypeScript void cannot be supplied explicitly from VelarScript and was kept as unknown");
    return unsupportedType;
  }
  if (value === "null") return nullType;
  if (value === "undefined") {
    if (direction === "from-js") return nullType;
    warnings.push("TypeScript undefined cannot be supplied explicitly from VelarScript and was kept as unknown");
    return unsupportedType;
  }
  if (value === "unknown") return unknownType;
  if (value === "object") {
    if (direction === "from-js") return unknownType;
    warnings.push("TypeScript object cannot be represented precisely in a VelarScript input position and was kept as unknown");
    return unsupportedType;
  }
  if (value === "any") {
    warnings.push("TypeScript 'any' is kept as unknown at the safe JavaScript boundary");
    return unknownType;
  }
  const classType = classTypes.get(value);
  if (classType) return classType;
  const alias = aliases.get(value);
  if (alias && !stack.has(value)) return parseTsType(alias, aliases, warnings, new Set([...stack, value]), classTypes, direction);
  if (alias) warnings.push(`Recursive declaration '${value}' is outside the VelarScript declaration bridge and was kept as unknown`);
  else warnings.push(`TypeScript type '${value}' is outside the VelarScript declaration bridge and was kept as unknown`);
  return unsupportedType;
}

function objectType(source: string, aliases: ReadonlyMap<string, string>, warnings: string[], stack: ReadonlySet<string>, classTypes: ReadonlyMap<string, ValueType>, direction: DeclarationDirection): ValueType {
  const fields = new Map<string, ValueType>();
  const readonlyFields = new Set<string>();
  const optionalFields = new Set<string>();
  let invalidInputShape = false;
  for (const part of splitFields(source)) {
    const match = /^(readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/su.exec(part.trim());
    if (match) {
      const name = match[2]!;
      const type = parseTsType(match[4] ?? "unknown", aliases, warnings, stack, classTypes, match[1] ? direction : "invariant");
      setObjectField(fields, name, type, warnings);
      if (match[1]) readonlyFields.add(name);
      if (match[3]) optionalFields.add(name);
      continue;
    }
    const method = readMethodSignature(part.trim());
    if (method) {
      const parameters = parseParameters(method.parameters, (value) => parseTsType(value, aliases, warnings, stack, classTypes, oppositeDirection(direction)), warnings);
      const type: ValueType = parameters.invalid ? unsupportedType : {
        kind: "function",
        parameters: parameters.types,
        requiredParameters: parameters.required,
        ...(parameters.rest ? { rest: parameters.rest } : {}),
        result: method.result.trim() === "void" ? nullType : parseTsType(method.result, aliases, warnings, stack, classTypes, direction),
      };
      setObjectField(fields, method.name, type, warnings);
      if (method.optional) optionalFields.add(method.name);
      continue;
    }
    if (part.trim()) {
      warnings.push(`Unsupported object field '${part.trim()}' was ignored`);
      invalidInputShape ||= direction !== "from-js";
    }
  }
  if (invalidInputShape) return unsupportedType;
  return {
    kind: "object",
    fields,
    ...(readonlyFields.size > 0 ? { readonlyFields } : {}),
    ...(optionalFields.size > 0 ? { optionalFields } : {}),
  };
}

function setObjectField(fields: Map<string, ValueType>, name: string, type: ValueType, warnings: string[]): void {
  if (fields.has(name)) {
    warnings.push(`Overloaded or duplicate object member '${name}' was kept as unknown`);
    fields.set(name, unsupportedType);
  } else fields.set(name, type);
}
