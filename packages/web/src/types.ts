import {
  optionalOf,
  stringType,
  type ExtensionTypeSyntaxResolver,
  type ExtensionValueType,
  type ValueType,
} from "@velarscript/compiler/extension";
import { LOOK_PUBLIC_TYPE_NAMES } from "./look.ts";

export const VELAR_WEB_TYPE_EXTENSION_ID = "@velarscript/web";

/**
 * D72 rule 186: every type name the Web extension publishes, in one table.
 *
 * It is the single source for three things that used to be written out
 * separately and therefore drifted: the analysis contract's `primitiveTypes`,
 * the `textForm` question, and the refusal of a user declaration that would
 * shadow one of these names. D51 rule 109 settled that such a name is refused
 * where it is introduced rather than where it is used — the use site can only
 * report an ambiguity nobody can act on — and this is what makes that refusal
 * follow the table instead of a hand-copied list of six event types.
 *
 * `Component` and `WebNode` belong here for the same reason the rest do: a user
 * `type Component:` loses to the extension's reading at every use.
 */
export const WEB_OWNED_TYPE_NAMES: ReadonlySet<string> = new Set<string>([
  "WebNode", "Component",
  "Element", "InputElement", "TextAreaElement", "CanvasElement", "DialogElement",
  "Blob", "File",
  "Event", "KeyboardEvent", "PointerEvent", "InputEvent", "CompositionEvent", "ClipboardEvent",
  ...LOOK_PUBLIC_TYPE_NAMES,
]);

/** The Web event hierarchy, derived from the published table rather than restated. */
export const WEB_EVENT_TYPE_NAMES: ReadonlySet<string> = new Set(
  [...WEB_OWNED_TYPE_NAMES].filter((name) => name === "Event" || name.endsWith("Event")),
);

/**
 * D71 rule 184: the interface annotation that says an export is a `computed`
 * declaration rather than a `state` one. Both travel through `reactiveExports`
 * so an imported bare read lowers through `.get()`, and this is what tells the
 * importing module that the derived one is read-only — without it, `bind={...}`
 * on an imported derived value would compile to a write nothing receives.
 */
export const WEB_COMPUTED_EXPORT = Object.freeze({ velarWebExport: "computed" as const });

export function isWebComputedExport(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && (value as { readonly velarWebExport?: unknown }).velarWebExport === "computed";
}

export type WebExtensionType = ExtensionValueType & { readonly extensionId: typeof VELAR_WEB_TYPE_EXTENSION_ID };
export type WebNodeType = WebExtensionType & { readonly family: "node"; readonly role: "value" };
export type WebComponentType = WebExtensionType & { readonly family: "component"; readonly role: "contract" | "constructor" };

export const webNodeType: WebNodeType = Object.freeze({
  kind: "extension",
  extensionId: VELAR_WEB_TYPE_EXTENSION_ID,
  family: "node",
  role: "value",
  properties: new Map<string, ValueType>(),
  requiredProperties: new Set<string>(),
  arguments: [],
  display: { kind: "named" as const, name: "WebNode" },
});

const componentDisplay = Object.freeze({
  kind: "properties" as const,
  name: "Component",
  result: "WebNode",
  hiddenOptionalProperties: new Map([
    ["class", "string?"],
    ["look", "Look?"],
  ]),
});

export function webComponentContract(
  properties: ReadonlyMap<string, ValueType> = new Map(),
  requiredProperties: ReadonlySet<string> = new Set(),
  handle: ValueType | null = null,
): WebComponentType {
  return {
    kind: "extension",
    extensionId: VELAR_WEB_TYPE_EXTENSION_ID,
    family: "component",
    role: "contract",
    properties,
    requiredProperties,
    arguments: handle ? [handle] : [],
    metadata: { semanticSymbolKind: "extension:function:web-component" },
    display: componentDisplay,
  };
}

export function webComponentConstructor(
  name: string,
  properties: ReadonlyMap<string, ValueType>,
  requiredProperties: ReadonlySet<string>,
  handle: ValueType | null,
  intrinsic?: string,
): WebComponentType {
  return {
    kind: "extension",
    extensionId: VELAR_WEB_TYPE_EXTENSION_ID,
    family: "component",
    role: "constructor",
    nominal: name,
    properties,
    requiredProperties,
    arguments: handle ? [handle] : [],
    metadata: { semanticSymbolKind: "extension:function:web-component", ...(intrinsic ? { intrinsic } : {}) },
    display: { kind: "constructor", prefix: "component", name },
  };
}

export function isWebExtensionType(type: ValueType): type is WebExtensionType {
  return type.kind === "extension" && type.extensionId === VELAR_WEB_TYPE_EXTENSION_ID;
}

export function isWebNodeType(type: ValueType): type is WebNodeType {
  return isWebExtensionType(type) && type.family === "node" && type.role === "value";
}

export function isWebComponentType(type: ValueType): type is WebComponentType {
  return isWebExtensionType(type) && type.family === "component"
    && (type.role === "contract" || type.role === "constructor");
}

export function isWebComponentConstructor(type: ValueType): type is WebComponentType {
  return isWebComponentType(type) && type.role === "constructor";
}

export function webComponentName(type: WebComponentType): string | null {
  return type.role === "constructor"
    ? type.nominal ?? (type.display.kind === "constructor" ? type.display.name : null)
    : null;
}

export function webComponentHandle(type: WebComponentType): ValueType | null {
  return type.arguments[0] ?? null;
}

export function webComponentIntrinsic(type: WebComponentType): string | null {
  return type.metadata?.intrinsic ?? null;
}

export const resolveWebTypeSyntax: ExtensionTypeSyntaxResolver = (syntax, resolve) => {
  if (syntax.kind === "NamedTypeSyntax") {
    if (syntax.name === "WebNode") return webNodeType;
    if (syntax.name === "Component") return webComponentContract();
    return undefined;
  }
  if (syntax.kind !== "GenericTypeSyntax" || syntax.name !== "Component") return undefined;
  const signature = syntax.arguments[0];
  if (signature?.kind !== "FunctionTypeSyntax" || signature.parameters.some((parameter) => !parameter.name)) {
    return webComponentContract();
  }
  const parameters = signature.parameters.filter((parameter) => !parameter.rest);
  return webComponentContract(
    new Map(parameters.map((parameter) => [parameter.name!, resolve(parameter.type)])),
    new Set(parameters.filter((parameter) => !parameter.optional).map((parameter) => parameter.name!)),
    syntax.arguments[1] ? resolve(syntax.arguments[1]) : null,
  );
};

export function normalizeWebComponentType(
  type: WebComponentType,
  normalizeProperty: (type: ValueType) => ValueType,
  normalizeArgument: (type: ValueType) => ValueType = normalizeProperty,
): WebComponentType {
  const properties = new Map([...type.properties]
    .map(([name, value]) => [name, normalizeProperty(value)] as const));
  if (!properties.has("class")) properties.set("class", optionalOf(stringType));
  if (!properties.has("look")) properties.set("look", optionalOf({ kind: "named", name: "Look" }));
  const handle = webComponentHandle(type);
  return {
    ...type,
    properties,
    arguments: handle ? [normalizeArgument(handle)] : [],
  };
}

export function isWebTypeAssignable(
  actual: ExtensionValueType,
  expected: ExtensionValueType,
  assign: (actual: ValueType, expected: ValueType) => boolean,
): boolean | undefined {
  if (actual.extensionId !== VELAR_WEB_TYPE_EXTENSION_ID || expected.extensionId !== VELAR_WEB_TYPE_EXTENSION_ID) return undefined;
  if (actual.family !== expected.family) return false;
  if (actual.family === "node") return actual.role === "value" && expected.role === "value";
  if (actual.family !== "component" || expected.family !== "component") return false;
  for (const required of actual.requiredProperties) {
    if (!expected.requiredProperties.has(required)) return false;
  }
  for (const [name, supplied] of expected.properties) {
    const accepted = actual.properties.get(name);
    if (!accepted || !assign(supplied, accepted)) return false;
  }
  const actualHandle = actual.arguments[0];
  const expectedHandle = expected.arguments[0];
  return !expectedHandle || !!actualHandle && assign(actualHandle, expectedHandle);
}
