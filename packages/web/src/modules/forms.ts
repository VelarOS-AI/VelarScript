/**
 * `velar/forms` — reading a form's values, and the accessible per-field error surface.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import {
  arrayString,
  boolType,
  elementType,
  mapString,
  moduleInterface,
  namedFunction,
  namedIntrinsic,
  nullType,
  numberType,
  stringType,
  unknownType,
} from "./types.ts";

const formValuesType: ValueType = { kind: "map", key: stringType, value: unknownType };

export const velarFormsModuleEntry: readonly [string, ModuleInterface] = ["velar/forms", moduleInterface(new Map([
  ["values", namedFunction(["form"], [elementType], formValuesType)],
  ["read", namedIntrinsic("forms.read", ["form", "target"], [elementType, unknownType], unknownType)],
  ["fieldValue", namedFunction(["form", "name"], [elementType, stringType], optional(unknownType))],
  ["textValue", namedFunction(["form", "name", "fallback"], [elementType, stringType, stringType], stringType, 2)],
  ["numberValue", namedFunction(["form", "name"], [elementType, stringType], optional(numberType))],
  ["checkedValue", namedFunction(["form", "name"], [elementType, stringType], boolType)],
  ["fieldValues", namedFunction(["form", "name"], [elementType, stringType], arrayString)],
  ["setError", namedFunction(["form", "name", "message"], [elementType, stringType, stringType], nullType)],
  ["clearError", namedFunction(["form", "name"], [elementType, stringType], nullType)],
  ["clearErrors", namedFunction(["form"], [elementType], nullType)],
  ["errors", namedFunction(["form"], [elementType], mapString(stringType))],
  ["focusFirstError", namedFunction(["form"], [elementType], boolType)],
  ["setPending", namedFunction(["form", "pending"], [elementType, boolType], nullType)],
  ["reset", namedFunction(["form"], [elementType], nullType)],
]))];
