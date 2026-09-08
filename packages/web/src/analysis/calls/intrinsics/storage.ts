/**
 * What 'velar/storage' calls answer: a read is typed by the runtime type it
 * validates against, and a write is checked for a value the surface can
 * serialize.
 *
 * D115 P4 R3a: one family of 'inferWebIntrinsic', in the module that family
 * names — with the sentence a read without its type reads, which nothing else
 * asks for.
 */
import {
  describeType,
  invalidType,
  nullType,
  numberType,
  optionalOf,
  stringType,
  unknownType,
  type CompilerIntrinsicAnalysisContext,
  type Expression,
  type ValueType,
} from "@velarscript/compiler/extension";

/**
 * The whole read, from the module name to a working line. A blind model needed
 * five guesses to get here because each diagnostic answered only the step it
 * was standing on: the export name, then the argument count, then that the
 * second argument is a runtime type, then that a primitive spelling is not a
 * value. Storage already parses and validates the stored JSON, so the one thing
 * still missing is the named type to validate against.
 */
const storageReadCalls: ReadonlyMap<string, string> = new Map([
  ["storage.get", "storage.get(key, Type)"],
  ["storage.databaseGet", "database(name).get(key, Type)"],
  ["storage.watch", "storage.watch(key, Type, callback)"],
]);

function storageReadGuidance(name: string): string | undefined {
  const call = storageReadCalls.get(name);
  if (call === undefined) return undefined;
  return `${call} validates what it reads and parses the stored JSON itself, so its second argument is a named runtime type: declare one — 'type SavedItems = List<Item>' — then read with 'storage.get("items", SavedItems, [])', whose third argument is the fallback for missing or invalid data, and write it back with 'storage.set("items", items)'. A primitive spelling ('string') and a generic spelling ('List<Item>') are types, not values; only a declared type, enum, or alias name is one.`;
}

/** The shape refusal may teach this read without entering value inference. */
export function storageIntrinsicArityGuidance(
  intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
  arguments_: readonly Expression[],
): string | undefined {
  return arguments_.length < 2 ? storageReadGuidance(intrinsic.name) : undefined;
}

export function inferStorageIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, runtimeTypeAt } = context;
  const guidance = argumentAt(1) ? undefined : storageReadGuidance(intrinsic.name);
  if (guidance !== undefined) {
    context.typeError(guidance, callSpan);
    return invalidType;
  }
  switch (intrinsic.name) {
    case "storage.set": {
      arity(2, 3);
      inferAt(0, stringType);
      const value = inferAt(1);
      if (argumentAt(2)) inferAt(2, numberType);
      const valueExpression = argumentAt(1);
      if (context.jsonSerializable(value) === false && valueExpression) {
        context.typeError(`Storage values accept only records, Lists, enums, primitives, and optionals; received ${describeType(value)}`, valueExpression.span);
      }
      return intrinsic.result;
    }
    case "storage.get": {
      arity(2, 4);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (argumentAt(3)) inferAt(3, numberType);
      if (argumentAt(2)) { inferAt(2, parsed); return parsed; }
      return optionalOf(parsed);
    }
    case "storage.databaseGet": {
      arity(2, 4);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (argumentAt(3)) inferAt(3, numberType);
      if (argumentAt(2)) { inferAt(2, parsed); return { kind: "promise", value: parsed }; }
      return { kind: "promise", value: optionalOf(parsed) };
    }
    case "storage.watch": {
      arity(3, 4);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      callbackAt(2, [optionalOf(parsed), optionalOf(parsed)], unknownType);
      if (argumentAt(3)) inferAt(3, numberType);
      return { kind: "function", parameters: [], requiredParameters: 0, result: nullType };
    }
    default:
      return undefined;
  }
}
