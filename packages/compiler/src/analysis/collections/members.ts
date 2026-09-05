/**
 * What a List, Map, Set or Record publishes under a name: the contract a
 * member access resolves to, before any argument of a call is looked at.
 *
 * D115 §三: these were four public methods of `CollectionInference` and the
 * three shape helpers they are written with. They are the compiler's answer to
 * "what does this collection have", asked by member access, by completion, and
 * by the surface-version gate — none of which is a call — so they are a file of
 * their own. Nothing here writes a diagnostic or a lowering fact, which is why
 * `CollectionMembersHost` is two names wide.
 */
import {
  boolType,
  nonOptional,
  nullType,
  numberType,
  optionalOf,
  stringType,
  unionOf,
  unknownType,
  type ValueType,
} from "../../types.ts";

/**
 * A synchronous cursor returns an optional wrapper rather than `T?` directly.
 * The wrapper keeps exhaustion distinct from a legitimate `null` collection
 * value: `null` means there is no next item, while `{value: null}` is an item.
 */
export const iteratorOf = (value: ValueType): ValueType => {
  const step: ValueType = {
    kind: "object",
    fields: new Map([["value", value]]),
    readonlyFields: new Set(["value"]),
  };
  return {
    kind: "object",
    fields: new Map([["next", {kind: "function", parameters: [], requiredParameters: 0, result: optionalOf(step)}]]),
    readonlyFields: new Set(["next"]),
  };
};


/** The types every List member contract is written in terms of. */
interface ListMemberShapes {
  readonly element: ValueType;
  readonly comparison: ValueType;
  readonly owned: ValueType;
  readonly test: ValueType;
  readonly compare: ValueType;
  readonly selectKey: ValueType;
  readonly selectAnyKey: ValueType;
}

/** One published member contract: its named parameters, their types, its result. */
const memberCallable = (
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType => ({ kind: "function", parameterNames, parameters, requiredParameters, result });

/**
 * D114 0.28.0 I-I1: one published contract for the three `…By` members, whose
 * result is a Map over whatever key the selector answers. The key is the
 * contract's own type parameter, so a bound or `?.` call solves it from the
 * selector exactly as the direct call solves it from the arrow's body.
 */
const keyedCallable = (selector: ValueType, result: (key: ValueType) => ValueType): ValueType => {
  const key: ValueType = { kind: "parameter", name: "K", index: 0 };
  const selected = selector.kind === "function" ? { ...selector, result: key } : selector;
  return { kind: "function", typeParameterNames: ["K"], parameterNames: ["key"], parameters: [selected], requiredParameters: 1, result: result(key) };
};

/** What the member resolvers ask of the analyzer that hosts them, and nothing more. */
export interface CollectionMembersHost {
  expandAliases(type: ValueType): ValueType;
  readonlyDataViewOf(type: ValueType): ValueType;
}

export class CollectionMembers {
  private readonly host: CollectionMembersHost;

  constructor(host: CollectionMembersHost) {
    this.host = host;
  }

  /**
   * What a List publishes under `property`, or null when it publishes nothing
   * under that name. The two halves own disjoint member names and neither
   * writes anything, so the answer is the answer the one switch gave.
   */
  listMember(list: Extract<ValueType, { kind: "list" }>, property: string): ValueType | null {
    const element = list.readonlyView ? this.host.readonlyDataViewOf(list.element) : list.element;
    // D113, completed by D114 S3b item A: every callback that receives an
    // element is handed the value and the snapshot index, so the published
    // contract says two arguments arrive. A callback that declares only `value`
    // is assignable to it the way JavaScript admits one — by ignoring the
    // argument it did not ask for.
    const shapes: ListMemberShapes = {
      element,
      comparison: this.host.readonlyDataViewOf(list.element),
      owned: { kind: "list", element },
      test: { kind: "function", parameters: [element, numberType], requiredParameters: 2, result: boolType },
      compare: { kind: "function", parameters: [element, element], requiredParameters: 2, result: numberType },
      selectKey: { kind: "function", parameters: [element, numberType], requiredParameters: 2, result: unionOf([numberType, stringType]) },
      selectAnyKey: { kind: "function", parameters: [element, numberType], requiredParameters: 2, result: unknownType },
    };
    return this.listCoreMember(list, shapes, property) ?? this.listPipelineMember(shapes, property);
  }

  /** The positional, mutating, probing and ordering members. */
  private listCoreMember(
    list: Extract<ValueType, { kind: "list" }>,
    shapes: ListMemberShapes,
    property: string,
  ): ValueType | null {
    const { element, comparison, owned, compare, selectKey } = shapes;
    switch (property) {
      case "size":
        return numberType;
      case "get":
        return memberCallable(["index"], [numberType], optionalOf(element));
      case "slice":
        return memberCallable(["start", "end"], [numberType, numberType], owned, 0);
      case "append":
        if (list.readonlyView) return null;
        return memberCallable(["value"], [list.element], nullType);
      case "extend":
        if (list.readonlyView) return null;
        return memberCallable(["values"], [list], nullType);
      case "insert":
        if (list.readonlyView) return null;
        return memberCallable(["index", "value"], [numberType, list.element], nullType);
      case "remove":
        if (list.readonlyView) return null;
        return memberCallable(["value"], [comparison], boolType);
      case "pop":
        if (list.readonlyView) return null;
        return memberCallable(["index"], [numberType], list.element, 0);
      case "clear":
        if (list.readonlyView) return null;
        return memberCallable([], [], nullType);
      case "copy":
      case "reversed":
        return memberCallable([], [], owned);
      case "has":
        return memberCallable(["value"], [comparison], boolType);
      case "count":
        return memberCallable(["value"], [comparison], numberType);
      case "sorted":
        return memberCallable(["compare", "by", "descending"], [compare, selectKey, boolType], owned, 0);
      case "sum":
        return memberCallable([], [], numberType);
      case "min":
      case "max":
        return memberCallable(["by"], [selectKey], optionalOf(element), 0);
      default:
        return null;
    }
  }

  /**
   * D114 S3: the pipeline members. Each answers a fresh container, so a
   * read-only receiver publishes them exactly as `map` and `filter`.
   */
  private listPipelineMember(shapes: ListMemberShapes, property: string): ValueType | null {
    const { element, comparison, owned, test, selectAnyKey } = shapes;
    switch (property) {
      case "unique":
        return memberCallable([], [], owned);
      case "repeat":
        return memberCallable(["count"], [numberType], owned);
      case "compact":
        return memberCallable([], [], { kind: "list", element: nonOptional(this.host.expandAliases(element)) });
      case "flatten": {
        const inner = this.host.expandAliases(element);
        return memberCallable([], [], { kind: "list", element: inner.kind === "list" ? inner.element : unknownType });
      }
      case "chunk":
        return memberCallable(["size"], [numberType], { kind: "list", element: owned });
      case "partition":
        return memberCallable(["test"], [test], { kind: "object", fields: new Map([["matches", owned], ["rest", owned]]) });
      // D114 0.28.0 I-I1: a member whose result depends on a type the call
      // solves publishes that type as its own parameter, exactly as `reduce`
      // publishes its accumulator. Without it a bound `const group =
      // values.groupBy` and a `values?.groupBy(...)` answered `Map<unknown,
      // …>` while the direct call answered `Map<bool, …>` — one member, two
      // results.
      case "groupBy":
        return keyedCallable(selectAnyKey, (key) => ({ kind: "map", key, value: owned }));
      case "keyBy":
        return keyedCallable(selectAnyKey, (key) => ({ kind: "map", key, value: element }));
      case "countBy":
        return keyedCallable(selectAnyKey, (key) => ({ kind: "map", key, value: numberType }));
      case "zip": {
        // The partner's element is the second half of every pair, so it is the
        // call's own type parameter: `List<U>` unifies with any concrete List
        // the way `Map<K, …>` does, and the invariance a fixed `List<T>`
        // parameter would impose never arises.
        const partner: ValueType = { kind: "parameter", name: "U", index: 0 };
        return {
          kind: "function",
          typeParameterNames: ["U"],
          parameterNames: ["other"],
          parameters: [{ kind: "list", element: partner }],
          requiredParameters: 1,
          result: { kind: "list", element: { kind: "object", fields: new Map([["first", element], ["second", partner]]) } },
        };
      }
      case "map":
      case "flatMap": {
        const produced: ValueType = { kind: "parameter", name: "R", index: 0 };
        const transformed: ValueType = property === "map" ? produced : { kind: "list", element: produced };
        return {
          kind: "function",
          typeParameterNames: ["R"],
          parameterNames: ["transform"],
          parameters: [{ kind: "function", parameters: [element, numberType], requiredParameters: 2, result: transformed }],
          requiredParameters: 1,
          result: { kind: "list", element: produced },
        };
      }
      case "filter":
        return memberCallable(["test"], [test], owned);
      // D113, completed by D114 S3c: the combine receives an element, so it
      // receives that element's snapshot position too, in the parameter after
      // the element. The accumulator is the fold's own type, bound from
      // `initial`, so the published contract names it rather than erasing it to
      // `unknown` — the contract a bound `const fold = values.reduce` and a
      // `values?.reduce(...)` are checked against is then the same
      // `(accumulator, value, index)` the direct call and the runtime use.
      case "reduce": {
        const accumulator: ValueType = { kind: "parameter", name: "U", index: 0 };
        return {
          kind: "function",
          typeParameterNames: ["U"],
          parameterNames: ["combine", "initial"],
          parameters: [
            { kind: "function", parameters: [accumulator, element, numberType], requiredParameters: 3, result: accumulator },
            accumulator,
          ],
          requiredParameters: 2,
          result: accumulator,
        };
      }
      case "some":
      case "every":
        return memberCallable(["test"], [test], boolType);
      case "find":
        return memberCallable(["test"], [test], optionalOf(element));
      case "index":
        return memberCallable(["value"], [comparison], optionalOf(numberType));
      case "join":
        return memberCallable(["separator"], [stringType], stringType, 0);
      default:
        return null;
    }
  }

  mapMember(map: Extract<ValueType, { kind: "map" }>, property: string): ValueType | null {
    const key = map.readonlyView ? this.host.readonlyDataViewOf(map.key) : map.key;
    const comparisonKey = this.host.readonlyDataViewOf(map.key);
    const value = map.readonlyView ? this.host.readonlyDataViewOf(map.value) : map.value;
    const copy: ValueType = { kind: "map", key, value };
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "size":
        return numberType;
      case "get":
        return memberCallable(["key"], [comparisonKey], optionalOf(value));
      case "set":
        if (map.readonlyView) return null;
        return memberCallable(["key", "value"], [map.key, map.value], nullType);
      case "getOrSet":
        if (map.readonlyView) return null;
        return memberCallable(["key", "fallback"], [map.key, map.value], map.value);
      case "getOrSetWith":
        if (map.readonlyView) return null;
        return memberCallable(["key", "factory"], [map.key, callable([], [], map.value)], map.value);
      case "update":
        if (map.readonlyView) return null;
        return memberCallable(["values"], [map], nullType);
      case "has":
        return memberCallable(["key"], [comparisonKey], boolType);
      case "remove":
        if (map.readonlyView) return null;
        return memberCallable(["key"], [comparisonKey], boolType);
      case "clear":
        if (map.readonlyView) return null;
        return memberCallable([], [], nullType);
      case "copy":
        return memberCallable([], [], copy);
      case "iterator":
        return memberCallable([], [], iteratorOf(key));
      case "keys":
        return memberCallable([], [], { kind: "list", element: key });
      case "values":
        return memberCallable([], [], { kind: "list", element: value });
      case "entries":
        return memberCallable([], [], { kind: "list", element: { kind: "object", fields: new Map([["key", key], ["value", value]]) } });
      default:
        return null;
    }
  }

  recordMember(record: Extract<ValueType, { kind: "record" }>, property: string): ValueType | null {
    const value = record.readonlyView ? this.host.readonlyDataViewOf(record.value) : record.value;
    const copy: ValueType = { kind: "record", value };
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "size": return numberType;
      case "get": return callable(["key"], [stringType], optionalOf(value));
      case "set": return record.readonlyView ? null : callable(["key", "value"], [stringType, record.value], nullType);
      case "has": return callable(["key"], [stringType], boolType);
      case "remove": return record.readonlyView ? null : callable(["key"], [stringType], boolType);
      case "clear": return record.readonlyView ? null : callable([], [], nullType);
      case "copy": return callable([], [], copy);
      case "keys": return callable([], [], { kind: "list", element: stringType });
      case "values": return callable([], [], { kind: "list", element: value });
      case "entries": return callable([], [], { kind: "list", element: { kind: "object", fields: new Map([["key", stringType], ["value", value]]) } });
      default: return null;
    }
  }

  setMember(set: Extract<ValueType, { kind: "set" }>, property: string): ValueType | null {
    const element = set.readonlyView ? this.host.readonlyDataViewOf(set.element) : set.element;
    const comparison = this.host.readonlyDataViewOf(set.element);
    const copy: ValueType = { kind: "set", element };
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "size":
        return numberType;
      case "add":
        if (set.readonlyView) return null;
        return memberCallable(["value"], [set.element], nullType);
      case "update":
        if (set.readonlyView) return null;
        return memberCallable(["values"], [{ kind: "union", members: [set, { kind: "list", element: set.element }] }], nullType);
      case "has":
        return memberCallable(["value"], [comparison], boolType);
      case "remove":
        if (set.readonlyView) return null;
        return memberCallable(["value"], [comparison], boolType);
      case "clear":
        if (set.readonlyView) return null;
        return memberCallable([], [], nullType);
      case "copy":
        return memberCallable([], [], copy);
      case "values":
        return memberCallable([], [], { kind: "list", element });
      case "union":
      case "intersection":
      case "difference":
        // COL-U2: the Set algebra copies — like sorted — and never mutates
        // either operand. The other operand is judged by the same
        // element-domain comparison question the membership probes use.
        return memberCallable(["other"], [{ kind: "set", element: comparison }], copy);
      default:
        return null;
    }
  }
}
