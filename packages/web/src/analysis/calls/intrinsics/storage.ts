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
  nullType,
  numberType,
  optionalOf,
  stringType,
  unknownType,
  type CompilerIntrinsicAnalysisContext,
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
function storageReadGuidance(call: string): string {
  return `${call} validates what it reads and parses the stored JSON itself, so its second argument is a named runtime type: declare one — 'type SavedItems = List<Item>' — then read with 'storage.get("items", SavedItems, [])', whose third argument is the fallback for missing or invalid data, and write it back with 'storage.set("items", items)'. A primitive spelling ('string') and a generic spelling ('List<Item>') are types, not values; only a declared type, enum, or alias name is one.`;
}

export function inferStorageIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, runtimeTypeAt } = context;
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
      if (!argumentAt(1)) {
        context.typeError(storageReadGuidance("storage.get(key, Type)"), callSpan);
        return unknownType;
      }
      arity(2, 4);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (argumentAt(3)) inferAt(3, numberType);
      if (argumentAt(2)) { inferAt(2, parsed); return parsed; }
      return optionalOf(parsed);
    }
    case "storage.databaseGet": {
      if (!argumentAt(1)) {
        context.typeError(storageReadGuidance("database(name).get(key, Type)"), callSpan);
        return { kind: "promise", value: unknownType };
      }
      arity(2, 4);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (argumentAt(3)) inferAt(3, numberType);
      if (argumentAt(2)) { inferAt(2, parsed); return { kind: "promise", value: parsed }; }
      return { kind: "promise", value: optionalOf(parsed) };
    }
    case "storage.watch": {
      if (!argumentAt(1)) {
        context.typeError(storageReadGuidance("storage.watch(key, Type, callback)"), callSpan);
        return { kind: "function", parameters: [], requiredParameters: 0, result: nullType };
      }
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
