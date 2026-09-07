/**
 * The type vocabulary every `velar/*` table in `modules/` is written in.
 *
 * D115 §三, the shape `packages/core/src/interfaces/` and `packages/node/src/modules/`
 * already have: the primitive `ValueType` singletons, the constructors a Web
 * export is built with, and the `ModuleInterface` constructor that fills in the
 * fields a Web module never uses. What one surface alone owns lives in that
 * surface's file.
 */
import { type ClassInfo, type EnumInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import type { Expression } from "@velarscript/compiler/extension";
import { isWebJsx } from "../ast.ts";
import { WEB_NATIVE_ELEMENTS } from "../elements.ts";
import { LOOK_BUILDER_SIGNATURES, type LookBuilderResultKind } from "../look.ts";
import { webNodeType } from "../types.ts";

export const bytesType: ValueType = { kind: "named", name: "Bytes", identity: "velar/binary#type:Bytes" };

export const nullType: ValueType = { kind: "null" };
export const stringType: ValueType = { kind: "string" };
export const numberType: ValueType = { kind: "number" };
export const boolType: ValueType = { kind: "bool" };
export const nodeType: ValueType = webNodeType;
export const elementType: ValueType = { kind: "named", name: "Element" };
export const inputElementType: ValueType = { kind: "named", name: "InputElement" };
export const textAreaElementType: ValueType = { kind: "named", name: "TextAreaElement" };
export const canvasElementType: ValueType = { kind: "named", name: "CanvasElement" };
export const dialogElementType: ValueType = { kind: "named", name: "DialogElement" };
export const blobType: ValueType = { kind: "named", name: "Blob" };
export const lengthType: ValueType = { kind: "named", name: "Length" };
export const percentageType: ValueType = { kind: "named", name: "Percentage" };
export const lengthPercentageType: ValueType = { kind: "named", name: "LengthPercentage" };
export const trackFractionType: ValueType = { kind: "named", name: "TrackFraction" };
export const colorType: ValueType = { kind: "named", name: "Color" };
export const colorInputType: ValueType = colorType;
export const borderType: ValueType = { kind: "named", name: "Border" };
export const shadowType: ValueType = { kind: "named", name: "Shadow" };
export const filterType: ValueType = { kind: "named", name: "Filter" };
export const imageType: ValueType = { kind: "named", name: "Image" };
export const trackType: ValueType = { kind: "named", name: "Track" };
export const trackListType: ValueType = { kind: "named", name: "TrackList" };

/**
 * Native JSX construction preserves the order and count of a collection
 * projection. Attribute and child holes still have to pass Core's stability
 * proof; event arrows are inert values here and run only after dispatch.
 * Components, custom elements, refs, and bindings keep the explicit loop
 * because their setup can execute user code or write through a binding.
 */
export function webCanonicalCollectionProjection(
  expression: Expression,
  pure: (expression: Expression) => boolean,
): boolean | undefined {
  if (!isWebJsx(expression)) return undefined;
  if (expression.tag !== "" && !WEB_NATIVE_ELEMENTS.has(expression.tag)) return false;
  for (const attribute of expression.attributes) {
    if (attribute.name === "ref" || attribute.name.startsWith("bind:")) return false;
    if (typeof attribute.value === "string" || attribute.value === null) continue;
    if (attribute.name.startsWith("on:") && attribute.value.kind === "ArrowFunctionExpression") continue;
    if (!pure(attribute.value)) return false;
  }
  for (const child of expression.children) {
    if (child.kind === "JSXText") continue;
    if (child.kind === "ExtensionExpression:web:jsx") {
      if (webCanonicalCollectionProjection(child, pure) !== true) return false;
      continue;
    }
    if (!pure(child.expression)) return false;
  }
  return true;
}
export const transitionType: ValueType = { kind: "named", name: "Transition" };
export const keyframesType: ValueType = { kind: "named", name: "Keyframes" };
export const animationType: ValueType = { kind: "named", name: "Animation" };
export const durationType: ValueType = { kind: "named", name: "Duration" };
export const angleType: ValueType = { kind: "named", name: "Angle" };
export const spacingType: ValueType = { kind: "named", name: "Spacing" };
export const mountTargetType: ValueType = { kind: "union", members: [stringType, elementType] };
export const lookScalarType: ValueType = { kind: "union", members: [numberType, stringType, lengthType, percentageType, lengthPercentageType] };
export const trackInputType: ValueType = { kind: "union", members: [numberType, stringType, lengthType, percentageType, lengthPercentageType, trackFractionType, trackType, trackListType] };
export const repeatCountType: ValueType = { kind: "union", members: [numberType, stringType] };
const lookBuilderResultTypes: Readonly<Record<LookBuilderResultKind, ValueType>> = {
  animation: animationType,
  border: borderType,
  color: colorType,
  filter: filterType,
  image: imageType,
  length: lengthType, "length-percentage": lengthPercentageType,
  shadow: shadowType,
  spacing: spacingType,
  string: stringType,
  track: trackType,
  "track-list": trackListType,
  transition: transitionType,
};

export function namedFunction(parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

/**
 * A velar/look builder's published type, with its parameter names and required
 * count read from LOOK_BUILDER_SIGNATURES rather than repeated here. The static
 * keyframe lowering places named arguments from that same table, so the two
 * cannot disagree about what `spread=0px` means.
 */
export function lookBuilder(name: string, parameters: readonly ValueType[], rest?: ValueType): ValueType {
  const signature = LOOK_BUILDER_SIGNATURES.get(name);
  if (!signature) throw new Error(`velar/look builder '${name}' has no declared signature`);
  if (signature.parameters.length !== parameters.length) {
    throw new Error(`velar/look builder '${name}' declares ${signature.parameters.length} parameters but types ${parameters.length}`);
  }
  if ((signature.rest ?? false) !== (rest !== undefined)) {
    throw new Error(`velar/look builder '${name}' disagrees with its declared rest parameter`);
  }
  return {
    kind: "function",
    parameterNames: signature.parameters,
    parameters,
    requiredParameters: signature.required,
    ...(rest ? { rest } : {}),
    result: lookBuilderResultTypes[signature.result],
  };
}

export const unknownType: ValueType = { kind: "unknown" };

export function functionType(parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameters, requiredParameters, result };
}

export function namedIntrinsic(name: string, parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "intrinsic", name, parameterNames, parameters, requiredParameters, result };
}

export function promise(value: ValueType): ValueType {
  return { kind: "promise", value };
}

export function object(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)) };
}

/** A structurally declared standard capability handle; see ValueType.capabilityHandle. */
export function capabilityHandle(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)), capabilityHandle: true };
}

export const errorType: ValueType = { kind: "class", name: "Error" };
export const cleanupType = namedFunction([], [], nullType);
export const arrayString: ValueType = { kind: "list", element: stringType };
export const arrayNumber: ValueType = { kind: "list", element: numberType };
export const mapString = (value: ValueType): ValueType => ({ kind: "map", key: stringType, value });
export const webElementType: ValueType = { kind: "union", members: [elementType, inputElementType, canvasElementType, dialogElementType] };
export const fileType: ValueType = { kind: "named", name: "File" };
export const fileArrayType: ValueType = { kind: "list", element: fileType };

export function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  enums: ReadonlyMap<string, EnumInfo> = new Map(),
  namedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  genericTypes: NonNullable<ModuleInterface["genericTypes"]> = new Map(),
): ModuleInterface {
  return { exports, mutableExports: new Set(), reactiveExports: new Map(), reExports: new Map(), namedTypes, namedTypeReadonlyFields, namedTypeIdentities, genericTypes, typeAliases: new Map(), enums, classes, tests: [], extensionExports: new Map(), extensionData: new Map() };
}

