import { optionalOf as optional, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { stringType, numberType, boolType, apiFunction, object, unknownType, moduleInterface } from "./types.ts";

const validationElementType: ValueType = { kind: "parameter", name: "T", index: 0 };
const validationFieldType: ValueType = { kind: "parameter", name: "U", index: 1 };
const validationPathSegmentType: ValueType = { kind: "union", members: [stringType, numberType] };
const validationPathType: ValueType = { kind: "list", element: validationPathSegmentType };
const validationIssueType = object({path: validationPathType, message: stringType});
const validationIssuesType: ValueType = { kind: "list", element: validationIssueType };
const validationRuleOf = (value: ValueType): ValueType => apiFunction(
  ["value", "path"],
  [value, validationPathType],
  validationIssuesType,
);
const validationResultOf = (value: ValueType): ValueType => object({
  success: boolType,
  value: optional(value),
  issues: validationIssuesType,
});
const validatorOf = (value: ValueType): ValueType => object({
  parse: apiFunction(["value"], [unknownType], value),
  safeParse: apiFunction(["value"], [unknownType], validationResultOf(value)),
  validate: apiFunction(["value"], [value], value),
  inspect: apiFunction(["value"], [value], validationIssuesType),
});

/** `velar/validation`: rules, validators, and the issues they report. */
export const validationModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["integer", apiFunction(["minimum", "maximum", "message"], [optional(numberType), optional(numberType), optional(stringType)], validationRuleOf(numberType), 0)],
  ["finite", apiFunction(["message"], [optional(stringType)], validationRuleOf(numberType), 0)],
  ["nonBlank", apiFunction(["maximum", "message"], [optional(numberType), optional(stringType)], validationRuleOf(stringType), 0)],
  ["refine", {kind: "function", typeParameterNames: ["T"], parameterNames: ["test", "message"], parameters: [apiFunction(["value"], [validationElementType], boolType), stringType], requiredParameters: 2, result: validationRuleOf(validationElementType)}],
  ["field", {kind: "function", typeParameterNames: ["T", "U"], parameterNames: ["name", "select", "rule"], parameters: [stringType, apiFunction(["value"], [validationElementType], validationFieldType), validationRuleOf(validationFieldType)], requiredParameters: 3, result: validationRuleOf(validationElementType)}],
  ["each", {kind: "function", typeParameterNames: ["T"], parameterNames: ["rule"], parameters: [validationRuleOf(validationElementType)], requiredParameters: 1, result: validationRuleOf({kind: "list", element: validationElementType})}],
  ["optional", {kind: "function", typeParameterNames: ["T"], parameterNames: ["rule"], parameters: [validationRuleOf(validationElementType)], requiredParameters: 1, result: validationRuleOf(optional(validationElementType))}],
  ["all", {kind: "function", typeParameterNames: ["T"], parameterNames: ["rules"], parameters: [{kind: "list", element: validationRuleOf(validationElementType)}], requiredParameters: 1, result: validationRuleOf(validationElementType)}],
  ["inspect", {kind: "function", typeParameterNames: ["T"], parameterNames: ["value", "rule"], parameters: [validationElementType, validationRuleOf(validationElementType)], requiredParameters: 2, result: validationIssuesType}],
  ["validate", {kind: "function", typeParameterNames: ["T"], parameterNames: ["value", "rule"], parameters: [validationElementType, validationRuleOf(validationElementType)], requiredParameters: 2, result: validationElementType}],
  ["parse", {kind: "function", typeParameterNames: ["T"], parameterNames: ["value", "Type", "rule"], parameters: [unknownType, {kind: "runtimeType", value: validationElementType}, optional(validationRuleOf(validationElementType))], requiredParameters: 2, result: validationElementType}],
  ["safeParse", {kind: "function", typeParameterNames: ["T"], parameterNames: ["value", "Type", "rule"], parameters: [unknownType, {kind: "runtimeType", value: validationElementType}, optional(validationRuleOf(validationElementType))], requiredParameters: 2, result: validationResultOf(validationElementType)}],
  ["validator", {kind: "function", typeParameterNames: ["T"], parameterNames: ["Type", "rule"], parameters: [{kind: "runtimeType", value: validationElementType}, optional(validationRuleOf(validationElementType))], requiredParameters: 1, result: validatorOf(validationElementType)}],
]));
