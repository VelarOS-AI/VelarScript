import { optionalOf as optional, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { stringType, numberType, boolType, apiFunction, object, listNumber, listString, moduleInterface } from "./types.ts";

const patternOptionsType = object({
  ignoreCase: optional(boolType),
  multiline: optional(boolType),
  dotAll: optional(boolType),
});
const textMatchType = object({
  value: stringType,
  index: numberType,
  groups: { kind: "list", element: optional(stringType) },
});
const textMatchArrayType: ValueType = { kind: "list", element: textMatchType };

/** `velar/text`: text transforms and the bounded pattern surface. */
export const textModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["trimStart", apiFunction(["value"], [stringType], stringType)],
  ["trimEnd", apiFunction(["value"], [stringType], stringType)],
  ["capitalize", apiFunction(["value"], [stringType], stringType)],
  ["title", apiFunction(["value"], [stringType], stringType)],
  ["lines", apiFunction(["value"], [stringType], listString)],
  ["lineStarts", apiFunction(["value"], [stringType], listNumber)],
  ["chunks", apiFunction(["value", "size"], [stringType, numberType], listString)],
  ["words", apiFunction(["value"], [stringType], listString)],
  ["slug", apiFunction(["value"], [stringType], stringType)],
  ["normalize", apiFunction(["value", "form"], [stringType, stringType], stringType, 1)],
  ["truncate", apiFunction(["value", "length", "suffix"], [stringType, numberType, stringType], stringType, 2)],
  ["indent", apiFunction(["value", "prefix"], [stringType, stringType], stringType, 1)],
  ["dedent", apiFunction(["value"], [stringType], stringType)],
  ["normalizeWhitespace", apiFunction(["value"], [stringType], stringType)],
  ["utf8Size", apiFunction(["value"], [stringType], numberType)],
  ["escapeHtml", apiFunction(["value"], [stringType], stringType)],
  ["codePoint", apiFunction(["value"], [stringType], optional(numberType))],
  ["fromCodePoint", apiFunction(["value"], [numberType], stringType)],
  ["matches", apiFunction(["value", "expression", "options"], [stringType, stringType, patternOptionsType], boolType, 2)],
  ["findMatch", apiFunction(["value", "expression", "options"], [stringType, stringType, patternOptionsType], optional(textMatchType), 2)],
  ["findMatches", apiFunction(["value", "expression", "options"], [stringType, stringType, patternOptionsType], textMatchArrayType, 2)],
  ["replaceMatches", apiFunction(["value", "expression", "replacement", "options"], [stringType, stringType, stringType, patternOptionsType], stringType, 3)],
  ["splitPattern", apiFunction(["value", "expression", "options"], [stringType, stringType, patternOptionsType], listString, 2)],
]));
