import { optionalOf as optional, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { nullType, stringType, numberType, functionType, apiFunction, object, unknownType, mapString, moduleInterface } from "./types.ts";

const errorType: ValueType = { kind: "class", name: "Error" };
const cleanupType = apiFunction([], [], nullType);

const logFieldsType = mapString(unknownType);
/**
 * D59 rule 145.3 and D65 rule 171: `useSink` hands a record to the sink, so a
 * sink written as a named `def` needs a name for that record's type. The
 * fields are registered as `velar/log`'s `LogRecord` and the name is exported,
 * the way `velar/serve` publishes `ServeRequest` and `velar/fs` publishes
 * `FileWatchBatch`. One field map, read as the parameter type and as the
 * module's named type, so the two cannot drift.
 */
const logRecordFields: Readonly<Record<string, ValueType>> = {
  timestamp: numberType,
  level: stringType,
  scope: stringType,
  message: stringType,
  fields: logFieldsType,
  error: optional(errorType),
};
const logRecordType = object(logRecordFields);
const loggerType = object({
  debug: apiFunction(["message", "fields"], [stringType, logFieldsType], nullType, 1),
  info: apiFunction(["message", "fields"], [stringType, logFieldsType], nullType, 1),
  warn: apiFunction(["message", "fields"], [stringType, logFieldsType], nullType, 1),
  error: apiFunction(["message", "error", "fields"], [stringType, errorType, logFieldsType], nullType, 1),
});

/** `velar/log`: the logger, its records, and the sink registration. */
export const logModuleInterface: ModuleInterface = moduleInterface(
  new Map([
    ["LogRecord", { kind: "typeObject", name: "LogRecord" }],
    ["log", loggerType],
    ["logger", apiFunction(["scope", "fields"], [stringType, logFieldsType], loggerType, 1)],
    ["level", apiFunction([], [], stringType)],
    ["setLevel", apiFunction(["value"], [stringType], nullType)],
    ["useSink", apiFunction(["sink"], [functionType([logRecordType], unknownType)], cleanupType)],
  ]),
  new Map(),
  new Map(),
  new Map([["LogRecord", logRecordType]]),
);
