/**
 * The error classes the language itself raises: their names, their contracts,
 * and the one table both the analyzer and the surface digest read.
 *
 * D114 item 11 / the Core ledger's 裁决项 (c): the reserved error class names
 * were absent from the `core` surface digest, so adding one, dropping one, or
 * changing what one carries moved no counter. They are a published contract —
 * a `catch` names them, `is` discriminates on them, `code` reports them — so
 * they are hashed like every other one, and this is the table that is hashed.
 * Lifting it out of `analyzer.ts` is also D115 §一.1: a table two readers share
 * is a module, not a hundred lines inside a constructor's neighbour.
 */
import { type ClassField, type ClassInfo } from "../contracts.ts";
import { VELAR_HOST_ERROR_NAMES, VELAR_HOST_ERROR_PATH_NAMES } from "../runtime-modules.ts";
import { optionalOf, stringType, unknownType, type ValueType } from "../types.ts";

import { validationPathType } from "../validation-path.ts";

const field = (type: ValueType): ClassField => ({ mutable: false, type });

/**
 * ENM-U4 + COL-U5: the compiler-raised error types are nameable — catchable,
 * `is`-narrowable, and constructible — wired exactly like Error.
 * ValidationError additionally carries the failure detail its parse sites
 * report (path, field, reason). AssertionError joins the roster because the
 * charter already promises it does: "A `catch` block still receives all three,
 * because a `catch` is explicit: the author wrote code to handle it, and `is`
 * names which one it was."
 *
 * D50 rule 89 adds the capability failures a caller recovers from differently.
 * Each carries the resource that failed, because every recovery — create it,
 * request access, choose another name — starts by asking which one it was.
 */
const builtinErrorDetails: readonly (readonly [string, readonly (readonly [string, ClassField])[]])[] = [
  ["ValidationError", [
    ["path", field(validationPathType)],
    ["field", field(optionalOf(stringType))],
    ["reason", field(optionalOf(stringType))],
  ]],
  ["AssertionError", []],
  ["NarrowingError", []],
  ["IndexError", []],
  ...VELAR_HOST_ERROR_NAMES.map((name) => [
    name,
    VELAR_HOST_ERROR_PATH_NAMES.includes(name) ? [["path", field(optionalOf(stringType))] as const] : [],
  ] as const),
];

const errorClass = (base: string | null, fields: readonly (readonly [string, ClassField])[]): ClassInfo => ({
  parameters: [stringType],
  parameterNames: ["message"],
  requiredParameters: 0,
  base,
  abstract: false,
  fields: new Map(fields),
  getters: new Set(),
  abstractGetters: new Set(),
  methods: new Map(),
  abstractMethods: new Set(),
  staticFields: new Map(),
  staticGetters: new Set(),
  staticMethods: new Map(),
});

/**
 * Every built-in error class and the contract it publishes, `Error` first.
 *
 * `Error`'s own members are the four JavaScript gives it plus `code`: ASY-U3
 * keeps a non-Error rejection reachable as the JavaScript `cause`, and D50 rule
 * 89's `code` is the string form of the same identity `is` discriminates on —
 * the declared class name — so a log line or a JSON payload can carry an
 * error's class across a boundary that classes cannot cross.
 */
export function coreBuiltinErrorClasses(): ReadonlyMap<string, ClassInfo> {
  const classes = new Map<string, ClassInfo>();
  classes.set("Error", errorClass(null, [
    ["name", field(stringType)],
    ["message", field(stringType)],
    ["stack", field(optionalOf(stringType))],
    ["cause", field(unknownType)],
    ["code", field(stringType)],
  ]));
  for (const [name, fields] of builtinErrorDetails) classes.set(name, errorClass("Error", fields));
  return classes;
}
