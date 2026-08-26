import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ModuleInterface } from "@velarscript/compiler";
import { readBoundedText } from "./bounded-text.ts";

/** The first frozen JavaScript/package-interface contract shipped by VelarScript. */
export const VELAR_LIBRARY_ABI_VERSION = 1;

export type VelarLibraryArtifactTarget = "core" | "node";

export interface LoadedVelarLibraryArtifact {
  readonly abiVersion: 1;
  readonly target: VelarLibraryArtifactTarget;
  readonly compilerVersion: string;
  readonly receiptPath: string;
  readonly entryPath: string;
  readonly interfacePath: string;
  readonly moduleInterface: ModuleInterface;
}

export interface VelarLibraryArtifactReceipt {
  readonly formatVersion: 1;
  readonly kind: "velar-library-artifact";
  readonly abiVersion: 1;
  readonly package: { readonly name: string; readonly version: string };
  readonly target: VelarLibraryArtifactTarget;
  readonly compilerVersion: string;
  readonly sourceEntry: string;
  readonly sources: readonly { readonly path: string; readonly sha256: string }[];
  readonly entry: {
    readonly javascript: string;
    readonly sourceMap: string;
    readonly interface: string;
    readonly sha256: {
      readonly javascript: string;
      readonly sourceMap: string;
      readonly interface: string;
    };
  };
}

interface PortableObject {
  readonly [key: string]: PortableValue;
}

type PortableValue = null | boolean | number | string | readonly PortableValue[] | PortableObject | ReadonlyMap<PortableValue, PortableValue> | ReadonlySet<PortableValue>;

type WireValue = null | boolean | number | string | {
  readonly tag: "array" | "object" | "map" | "set";
  readonly value: readonly WireValue[] | readonly (readonly [WireValue, WireValue])[];
};

const MAX_INTERFACE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_WIRE_NODES = 1_000_000;
const MAX_WIRE_DEPTH = 128;
const SHA256 = /^[a-f0-9]{64}$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const PACKAGE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * ABI 1 is deliberately a data format, never JSON.stringify over compiler
 * internals. Every container carries an explicit tag, so Maps/Sets survive and
 * an extension-owned object cannot be mistaken for one of the wire wrappers.
 */
export function encodeVelarLibraryInterface(interface_: ModuleInterface): string {
  validateModuleInterface(interface_, "module interface");
  let nodes = 0;
  const active = new Set<object>();
  const encode = (value: unknown, depth: number): WireValue => {
    nodes += 1;
    if (nodes > MAX_WIRE_NODES) throw new RangeError(`Velar library interface exceeds ${MAX_WIRE_NODES} values`);
    if (depth > MAX_WIRE_DEPTH) throw new RangeError(`Velar library interface exceeds ${MAX_WIRE_DEPTH} nested values`);
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Velar library interface cannot contain a non-finite number");
      return value;
    }
    if (value === undefined) throw new Error("Velar library interface cannot contain an explicit undefined value");
    if (typeof value !== "object") throw new Error(`Velar library interface cannot contain ${typeof value}`);
    if (active.has(value)) throw new Error("Velar library interface cannot contain an object cycle");
    active.add(value);
    let output: WireValue;
    if (Array.isArray(value)) {
      output = { tag: "array", value: value.map((item) => encode(item, depth + 1)) };
    } else if (value instanceof Map) {
      output = { tag: "map", value: [...value].map(([key, item]) => [encode(key, depth + 1), encode(item, depth + 1)] as const) };
    } else if (value instanceof Set) {
      output = { tag: "set", value: [...value].map((item) => encode(item, depth + 1)) };
    } else {
      const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key as WireValue, encode(item, depth + 1)] as const);
      output = { tag: "object", value: entries };
    }
    active.delete(value);
    return output;
  };
  return `${JSON.stringify({ formatVersion: 1, abiVersion: VELAR_LIBRARY_ABI_VERSION, interface: encode(interface_, 0) }, null, 2)}\n`;
}

export function decodeVelarLibraryInterface(text: string): ModuleInterface {
  if (Buffer.byteLength(text, "utf8") > MAX_INTERFACE_BYTES) throw new RangeError(`Velar library interface exceeds ${MAX_INTERFACE_BYTES} bytes`);
  const envelope = record(JSON.parse(text), "Velar library interface");
  exactKeys(envelope, ["formatVersion", "abiVersion", "interface"], "Velar library interface");
  if (envelope.formatVersion !== 1) throw new Error("Velar library interface formatVersion must be 1");
  if (envelope.abiVersion !== VELAR_LIBRARY_ABI_VERSION) throw new Error(`Velar library interface ABI ${String(envelope.abiVersion)} is not supported`);
  let nodes = 0;
  const decode = (value: unknown, depth: number): PortableValue => {
    nodes += 1;
    if (nodes > MAX_WIRE_NODES) throw new RangeError(`Velar library interface exceeds ${MAX_WIRE_NODES} values`);
    if (depth > MAX_WIRE_DEPTH) throw new RangeError(`Velar library interface exceeds ${MAX_WIRE_DEPTH} nested values`);
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Velar library interface contains a non-finite number");
      return value;
    }
    const wrapper = record(value, "Velar library interface wire value");
    exactKeys(wrapper, ["tag", "value"], "Velar library interface wire value");
    if (!Array.isArray(wrapper.value)) throw new Error("Velar library interface wire container value must be a list");
    if (wrapper.tag === "array") return wrapper.value.map((item) => decode(item, depth + 1));
    if (wrapper.tag === "set") return new Set(wrapper.value.map((item) => decode(item, depth + 1)));
    if (wrapper.tag === "map" || wrapper.tag === "object") {
      const entries = wrapper.value.map((entry, index) => {
        if (!Array.isArray(entry) || entry.length !== 2) throw new Error(`Velar library interface ${String(wrapper.tag)} entry ${index} must contain a key and value`);
        return [decode(entry[0], depth + 1), decode(entry[1], depth + 1)] as const;
      });
      if (wrapper.tag === "map") return new Map(entries);
      const output: Record<string, PortableValue> = Object.create(null) as Record<string, PortableValue>;
      for (const [key, item] of entries) {
        if (typeof key !== "string" || key === "__proto__" || key === "prototype" || key === "constructor") {
          throw new Error("Velar library interface object keys must be safe strings");
        }
        if (Object.hasOwn(output, key)) throw new Error(`Velar library interface object repeats key '${key}'`);
        output[key] = item;
      }
      return output;
    }
    throw new Error(`Velar library interface wire tag '${String(wrapper.tag)}' is not supported`);
  };
  const decoded = decode(envelope.interface, 0);
  validateModuleInterface(decoded, "Velar library interface");
  return decoded as unknown as ModuleInterface;
}

/** Replaces physical module paths in every nominal identity with package-stable paths. */
export function rebaseModuleInterfaceIdentities(
  interface_: ModuleInterface,
  replacements: readonly { readonly physical: string; readonly logical: string }[],
): ModuleInterface {
  const normalized = replacements
    .map((item) => ({ physical: item.physical.replaceAll("\\", "/"), logical: item.logical }))
    .sort((left, right) => right.physical.length - left.physical.length);
  const replace = (text: string): string => {
    let output = text.replaceAll("\\", "/");
    for (const item of normalized) output = output.replaceAll(item.physical, item.logical);
    return output;
  };
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") return replace(value);
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(visit);
    if (value instanceof Map) return new Map([...value].map(([key, item]) => [visit(key), visit(item)]));
    if (value instanceof Set) return new Set([...value].map(visit));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
  };
  const rebased = visit(interface_);
  validateModuleInterface(rebased, "rebased module interface");
  return rebased as ModuleInterface;
}

export function packageStableModulePath(name: string, version: string, relativeSourcePath: string): string {
  return `package:${name}@${version}/${relativeSourcePath.replaceAll("\\", "/")}`;
}

export async function loadVelarLibraryArtifact(options: {
  readonly packageRoot: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly sourceEntry: string;
  readonly descriptor: string;
  readonly target: VelarLibraryArtifactTarget;
  readonly packageExports: unknown;
}): Promise<LoadedVelarLibraryArtifact> {
  const receiptPath = artifactPath(options.packageRoot, options.descriptor, "velar.artifacts receipt");
  const receiptText = await readArtifactText(options.packageRoot, receiptPath, 4 * 1024 * 1024, "Velar library artifact receipt");
  const receipt = validateReceipt(JSON.parse(receiptText));
  if (receipt.package.name !== options.packageName || receipt.package.version !== options.packageVersion) {
    throw new Error(`Velar library artifact identifies '${receipt.package.name}@${receipt.package.version}', expected '${options.packageName}@${options.packageVersion}'`);
  }
  if (receipt.target !== options.target) throw new Error(`Velar library artifact target '${receipt.target}' does not match manifest key '${options.target}'`);
  if (receipt.sourceEntry !== options.sourceEntry) throw new Error(`Velar library artifact sourceEntry '${receipt.sourceEntry}' does not match velar.entry '${options.sourceEntry}'`);
  const receiptRoot = dirname(receiptPath);
  const entryPath = artifactPath(receiptRoot, receipt.entry.javascript, "artifact JavaScript entry");
  const sourceMapPath = artifactPath(receiptRoot, receipt.entry.sourceMap, "artifact source map");
  const interfacePath = artifactPath(receiptRoot, receipt.entry.interface, "artifact interface");
  const exported = packageExportTargets(options.packageExports, ".");
  const expectedExport = `./${relative(options.packageRoot, entryPath).replaceAll("\\", "/")}`;
  if (exported.length === 0 || exported.some((target) => target !== expectedExport)) {
    throw new Error(`Package '${options.packageName}' must export its Velar artifact entry as '${expectedExport}' in every package.json export condition`);
  }
  const [javascript, sourceMap, interfaceText] = await Promise.all([
    readArtifactText(options.packageRoot, entryPath, MAX_ARTIFACT_FILE_BYTES, "Velar library JavaScript artifact"),
    readArtifactText(options.packageRoot, sourceMapPath, MAX_ARTIFACT_FILE_BYTES, "Velar library source map"),
    readArtifactText(options.packageRoot, interfacePath, MAX_INTERFACE_BYTES, "Velar library interface"),
  ]);
  for (const [label, content, expected] of [
    ["JavaScript", javascript, receipt.entry.sha256.javascript],
    ["source map", sourceMap, receipt.entry.sha256.sourceMap],
    ["interface", interfaceText, receipt.entry.sha256.interface],
  ] as const) {
    const actual = sha256Text(content);
    if (actual !== expected) throw new Error(`Velar library artifact ${label} hash mismatch; the package is incomplete or was modified after its receipt was written`);
  }
  return {
    abiVersion: 1,
    target: receipt.target,
    compilerVersion: receipt.compilerVersion,
    receiptPath,
    entryPath,
    interfacePath,
    moduleInterface: decodeVelarLibraryInterface(interfaceText),
  };
}

function validateReceipt(value: unknown): VelarLibraryArtifactReceipt {
  const receipt = record(value, "Velar library artifact receipt");
  exactKeys(receipt, ["formatVersion", "kind", "abiVersion", "package", "target", "compilerVersion", "sourceEntry", "sources", "entry"], "Velar library artifact receipt");
  if (receipt.formatVersion !== 1 || receipt.kind !== "velar-library-artifact" || receipt.abiVersion !== 1) {
    throw new Error("Velar library artifact receipt must declare formatVersion 1, kind 'velar-library-artifact', and ABI 1");
  }
  const package_ = record(receipt.package, "Velar library artifact package identity");
  exactKeys(package_, ["name", "version"], "Velar library artifact package identity");
  if (typeof package_.name !== "string" || !PACKAGE_NAME.test(package_.name) || typeof package_.version !== "string" || !PACKAGE_VERSION.test(package_.version)) {
    throw new Error("Velar library artifact package identity must contain a package name and semantic version");
  }
  if (receipt.target !== "core" && receipt.target !== "node") throw new Error("Velar library ABI 1 target must be 'core' or 'node'");
  if (typeof receipt.compilerVersion !== "string" || !PACKAGE_VERSION.test(receipt.compilerVersion)) {
    throw new Error("Velar library artifact compilerVersion must be a semantic version");
  }
  normalizedRelativePath(receipt.sourceEntry, "Velar library artifact sourceEntry");
  if (!Array.isArray(receipt.sources) || receipt.sources.length === 0 || receipt.sources.length > 10_000) {
    throw new Error("Velar library artifact sources must be a non-empty bounded list");
  }
  const sourcePaths = new Set<string>();
  for (const source of receipt.sources) {
    const item = record(source, "Velar library artifact source");
    exactKeys(item, ["path", "sha256"], "Velar library artifact source");
    normalizedRelativePath(item.path, "Velar library artifact source path");
    if (sourcePaths.has(item.path as string)) throw new Error(`Velar library artifact repeats source '${String(item.path)}'`);
    sourcePaths.add(item.path as string);
    hash(item.sha256, "Velar library artifact source hash");
  }
  const entry = record(receipt.entry, "Velar library artifact entry");
  exactKeys(entry, ["javascript", "sourceMap", "interface", "sha256"], "Velar library artifact entry");
  normalizedRelativePath(entry.javascript, "Velar library artifact JavaScript path");
  normalizedRelativePath(entry.sourceMap, "Velar library artifact source map path");
  normalizedRelativePath(entry.interface, "Velar library artifact interface path");
  if (new Set([entry.javascript, entry.sourceMap, entry.interface]).size !== 3) {
    throw new Error("Velar library artifact JavaScript, source map, and interface paths must be distinct");
  }
  const hashes = record(entry.sha256, "Velar library artifact hashes");
  exactKeys(hashes, ["javascript", "sourceMap", "interface"], "Velar library artifact hashes");
  hash(hashes.javascript, "Velar library JavaScript hash");
  hash(hashes.sourceMap, "Velar library source map hash");
  hash(hashes.interface, "Velar library interface hash");
  return receipt as unknown as VelarLibraryArtifactReceipt;
}

function validateModuleInterface(value: unknown, label: string): asserts value is ModuleInterface {
  const interface_ = record(value, label);
  exactKeys(interface_, [
    "exports", "mutableExports", "reactiveExports", "reExports", "hoistedExports", "namedTypes",
    "namedTypeReadonlyFields", "namedTypeIdentities", "namedTypeBases", "genericTypes", "typeAliases",
    "enums", "classes", "tests", "extensionExports", "extensionData",
  ], label, true);
  stringMap(interface_.exports, `${label}.exports`, validateValueType);
  stringSet(interface_.mutableExports, `${label}.mutableExports`);
  stringMap(interface_.reactiveExports, `${label}.reactiveExports`, (item, itemLabel) => {
    if (item !== "state") throw new Error(`${itemLabel} must be 'state'`);
  });
  stringMap(interface_.reExports, `${label}.reExports`, (item, itemLabel) => {
    const target = record(item, itemLabel);
    exactKeys(target, ["source", "imported"], itemLabel);
    nonEmptyString(target.source, `${itemLabel}.source`);
    nonEmptyString(target.imported, `${itemLabel}.imported`);
  });
  if (interface_.hoistedExports !== undefined) stringSet(interface_.hoistedExports, `${label}.hoistedExports`);
  stringMap(interface_.namedTypes, `${label}.namedTypes`, (item, itemLabel) => stringMap(item, itemLabel, validateValueType));
  if (interface_.namedTypeReadonlyFields !== undefined) stringMap(interface_.namedTypeReadonlyFields, `${label}.namedTypeReadonlyFields`, (item, itemLabel) => stringSet(item, itemLabel));
  stringMap(interface_.namedTypeIdentities, `${label}.namedTypeIdentities`, (item, itemLabel) => nonEmptyString(item, itemLabel));
  if (interface_.namedTypeBases !== undefined) stringMap(interface_.namedTypeBases, `${label}.namedTypeBases`, validateValueType);
  if (interface_.genericTypes !== undefined) stringMap(interface_.genericTypes, `${label}.genericTypes`, validateGenericTypeInfo);
  stringMap(interface_.typeAliases, `${label}.typeAliases`, validateValueType);
  stringMap(interface_.enums, `${label}.enums`, validateEnumInfo);
  stringMap(interface_.classes, `${label}.classes`, validateClassInfo);
  if (!Array.isArray(interface_.tests) || interface_.tests.length > 100_000) throw new Error(`${label}.tests must be a bounded list`);
  for (const [index, item] of interface_.tests.entries()) {
    const test = record(item, `${label}.tests[${index}]`);
    exactKeys(test, ["name", "title"], `${label}.tests[${index}]`);
    nonEmptyString(test.name, `${label}.tests[${index}].name`);
    if (typeof test.title !== "string") throw new Error(`${label}.tests[${index}].title must be a string`);
  }
  stringMap(interface_.extensionExports, `${label}.extensionExports`, (item, itemLabel) => stringMap(item, itemLabel, validatePortableData));
  stringMap(interface_.extensionData, `${label}.extensionData`, validatePortableData);
}

function validateValueType(value: unknown, label: string, depth = 0): void {
  if (depth > MAX_WIRE_DEPTH) throw new RangeError(`${label} exceeds the ABI type nesting limit`);
  const type = record(value, label);
  if (typeof type.kind !== "string") throw new Error(`${label}.kind must be a string`);
  const nested = (item: unknown, itemLabel: string): void => validateValueType(item, itemLabel, depth + 1);
  switch (type.kind) {
    case "unknown":
      exactKeys(type, ["kind", "restricted", "boundary"], label, true);
      trueFlag(type.restricted, `${label}.restricted`);
      trueFlag(type.boundary, `${label}.boundary`);
      return;
    case "any":
      exactKeys(type, ["kind", "textConvertible"], label, true);
      trueFlag(type.textConvertible, `${label}.textConvertible`);
      return;
    case "null": case "string": case "number": case "bool":
      exactKeys(type, ["kind"], label);
      return;
    case "optional":
      exactKeys(type, ["kind", "inner"], label);
      nested(type.inner, `${label}.inner`);
      return;
    case "list": case "set":
      exactKeys(type, ["kind", "element", "readonlyView"], label, true);
      nested(type.element, `${label}.element`);
      trueFlag(type.readonlyView, `${label}.readonlyView`);
      return;
    case "map":
      exactKeys(type, ["kind", "key", "value", "readonlyView"], label, true);
      nested(type.key, `${label}.key`);
      nested(type.value, `${label}.value`);
      trueFlag(type.readonlyView, `${label}.readonlyView`);
      return;
    case "record":
      exactKeys(type, ["kind", "value", "readonlyView"], label, true);
      nested(type.value, `${label}.value`);
      trueFlag(type.readonlyView, `${label}.readonlyView`);
      return;
    case "promise": case "runtimeType":
      exactKeys(type, ["kind", "value"], label);
      nested(type.value, `${label}.value`);
      return;
    case "object":
      exactKeys(type, ["kind", "fields", "readonlyFields", "optionalFields", "readonlyView", "capabilityHandle"], label, true);
      stringMap(type.fields, `${label}.fields`, nested);
      if (type.readonlyFields !== undefined) stringSet(type.readonlyFields, `${label}.readonlyFields`);
      if (type.optionalFields !== undefined) stringSet(type.optionalFields, `${label}.optionalFields`);
      trueFlag(type.readonlyView, `${label}.readonlyView`);
      trueFlag(type.capabilityHandle, `${label}.capabilityHandle`);
      return;
    case "parameter":
      exactKeys(type, ["kind", "name", "index"], label);
      nonEmptyString(type.name, `${label}.name`);
      nonNegativeInteger(type.index, `${label}.index`);
      return;
    case "named":
      exactKeys(type, ["kind", "name", "identity", "readonlyView", "application"], label, true);
      nonEmptyString(type.name, `${label}.name`);
      optionalString(type.identity, `${label}.identity`);
      trueFlag(type.readonlyView, `${label}.readonlyView`);
      if (type.application !== undefined) {
        const application = record(type.application, `${label}.application`);
        exactKeys(application, ["declaration", "name", "arguments"], `${label}.application`);
        nonEmptyString(application.declaration, `${label}.application.declaration`);
        nonEmptyString(application.name, `${label}.application.name`);
        valueTypeList(application.arguments, `${label}.application.arguments`, nested);
      }
      return;
    case "class": case "classConstructor":
      exactKeys(type, ["kind", "name", "identity"], label, true);
      nonEmptyString(type.name, `${label}.name`);
      optionalString(type.identity, `${label}.identity`);
      return;
    case "enum":
      exactKeys(type, ["kind", "name", "identity"], label);
      nonEmptyString(type.name, `${label}.name`);
      nonEmptyString(type.identity, `${label}.identity`);
      return;
    case "enumMember":
      exactKeys(type, ["kind", "name", "identity", "member"], label);
      nonEmptyString(type.name, `${label}.name`);
      nonEmptyString(type.identity, `${label}.identity`);
      nonEmptyString(type.member, `${label}.member`);
      return;
    case "enumObject":
      exactKeys(type, ["kind", "name", "identity", "members"], label);
      nonEmptyString(type.name, `${label}.name`);
      nonEmptyString(type.identity, `${label}.identity`);
      stringSet(type.members, `${label}.members`);
      return;
    case "typeObject":
      exactKeys(type, ["kind", "name", "value"], label, true);
      nonEmptyString(type.name, `${label}.name`);
      if (type.value !== undefined) nested(type.value, `${label}.value`);
      return;
    case "function": case "action": case "intrinsic":
      exactKeys(type, ["kind", "name", "typeParameterNames", "typeParameterBounds", "parameters", "parameterNames", "requiredParameters", "rest", "result"], label, true);
      if (type.kind === "intrinsic") nonEmptyString(type.name, `${label}.name`);
      else if (type.name !== undefined) throw new Error(`${label}.name is only valid on an intrinsic type`);
      callableFields(type, label, nested);
      return;
    case "extension": {
      exactKeys(type, ["kind", "extensionId", "family", "role", "nominal", "properties", "requiredProperties", "arguments", "metadata", "display"], label, true);
      nonEmptyString(type.extensionId, `${label}.extensionId`);
      nonEmptyString(type.family, `${label}.family`);
      nonEmptyString(type.role, `${label}.role`);
      optionalString(type.nominal, `${label}.nominal`);
      stringMap(type.properties, `${label}.properties`, nested);
      stringSet(type.requiredProperties, `${label}.requiredProperties`);
      valueTypeList(type.arguments, `${label}.arguments`, nested);
      if (type.metadata !== undefined) stringRecord(type.metadata, `${label}.metadata`);
      validateExtensionDisplay(type.display, `${label}.display`);
      return;
    }
    case "union":
      exactKeys(type, ["kind", "members"], label);
      valueTypeList(type.members, `${label}.members`, nested);
      return;
    default:
      throw new Error(`${label}.kind '${type.kind}' is not part of Velar library ABI 1`);
  }
}

function callableFields(type: Record<string, unknown>, label: string, nested: (value: unknown, label: string) => void): void {
  if (type.typeParameterNames !== undefined) stringList(type.typeParameterNames, `${label}.typeParameterNames`);
  if (type.typeParameterBounds !== undefined) boundList(type.typeParameterBounds, `${label}.typeParameterBounds`);
  valueTypeList(type.parameters, `${label}.parameters`, nested);
  if (type.parameterNames !== undefined) stringList(type.parameterNames, `${label}.parameterNames`, true);
  nonNegativeInteger(type.requiredParameters, `${label}.requiredParameters`);
  if (type.rest !== undefined) nested(type.rest, `${label}.rest`);
  nested(type.result, `${label}.result`);
}

function validateGenericTypeInfo(value: unknown, label: string): void {
  const info = record(value, label);
  exactKeys(info, ["identity", "name", "parameterNames", "parameterBounds", "fields", "readonlyFields"], label, true);
  nonEmptyString(info.identity, `${label}.identity`);
  nonEmptyString(info.name, `${label}.name`);
  stringList(info.parameterNames, `${label}.parameterNames`);
  boundList(info.parameterBounds, `${label}.parameterBounds`);
  stringMap(info.fields, `${label}.fields`, validateValueType);
  if (info.readonlyFields !== undefined) stringSet(info.readonlyFields, `${label}.readonlyFields`);
}

function validateEnumInfo(value: unknown, label: string): void {
  const info = record(value, label);
  exactKeys(info, ["identity", "members", "wireValues"], label);
  nonEmptyString(info.identity, `${label}.identity`);
  stringSet(info.members, `${label}.members`);
  stringMap(info.wireValues, `${label}.wireValues`, (item, itemLabel) => {
    if (typeof item !== "string") throw new Error(`${itemLabel} must be a string`);
  });
  if ((info.members as ReadonlySet<string>).size !== (info.wireValues as ReadonlyMap<string, string>).size
    || [...info.members as ReadonlySet<string>].some((member) => !(info.wireValues as ReadonlyMap<string, string>).has(member))) {
    throw new Error(`${label}.wireValues must define exactly one value for every enum member`);
  }
}

function validateClassInfo(value: unknown, label: string): void {
  const info = record(value, label);
  exactKeys(info, [
    "identity", "dispose", "iterate", "iterateAsync", "parameters", "parameterNames", "requiredParameters",
    "constructorRest", "base", "abstract", "fields", "getters", "abstractGetters", "methods", "abstractMethods",
    "staticFields", "staticGetters", "staticMethods",
  ], label, true);
  optionalString(info.identity, `${label}.identity`);
  if (info.dispose !== undefined && info.dispose !== "sync" && info.dispose !== "async") throw new Error(`${label}.dispose must be 'sync' or 'async'`);
  if (info.iterate !== undefined) validateValueType(info.iterate, `${label}.iterate`);
  if (info.iterateAsync !== undefined) validateValueType(info.iterateAsync, `${label}.iterateAsync`);
  valueTypeList(info.parameters, `${label}.parameters`, validateValueType);
  if (info.parameterNames !== undefined) stringList(info.parameterNames, `${label}.parameterNames`, true);
  nonNegativeInteger(info.requiredParameters, `${label}.requiredParameters`);
  if (info.constructorRest !== undefined) validateValueType(info.constructorRest, `${label}.constructorRest`);
  if (info.base !== null && typeof info.base !== "string") throw new Error(`${label}.base must be a string or null`);
  if (typeof info.abstract !== "boolean") throw new Error(`${label}.abstract must be a bool`);
  stringMap(info.fields, `${label}.fields`, validateClassField);
  stringSet(info.getters, `${label}.getters`);
  stringSet(info.abstractGetters, `${label}.abstractGetters`);
  stringMap(info.methods, `${label}.methods`, validateValueType);
  stringSet(info.abstractMethods, `${label}.abstractMethods`);
  stringMap(info.staticFields, `${label}.staticFields`, validateClassField);
  stringSet(info.staticGetters, `${label}.staticGetters`);
  stringMap(info.staticMethods, `${label}.staticMethods`, validateValueType);
}

function validateClassField(value: unknown, label: string): void {
  const field = record(value, label);
  exactKeys(field, ["mutable", "type"], label);
  if (typeof field.mutable !== "boolean") throw new Error(`${label}.mutable must be a bool`);
  validateValueType(field.type, `${label}.type`);
}

function validateExtensionDisplay(value: unknown, label: string): void {
  const display = record(value, label);
  if (display.kind === "named") {
    exactKeys(display, ["kind", "name"], label);
    nonEmptyString(display.name, `${label}.name`);
  } else if (display.kind === "constructor") {
    exactKeys(display, ["kind", "prefix", "name"], label);
    if (typeof display.prefix !== "string") throw new Error(`${label}.prefix must be a string`);
    nonEmptyString(display.name, `${label}.name`);
  } else if (display.kind === "properties") {
    exactKeys(display, ["kind", "name", "result", "hiddenOptionalProperties"], label, true);
    nonEmptyString(display.name, `${label}.name`);
    nonEmptyString(display.result, `${label}.result`);
    if (display.hiddenOptionalProperties !== undefined) stringMap(display.hiddenOptionalProperties, `${label}.hiddenOptionalProperties`, (item, itemLabel) => nonEmptyString(item, itemLabel));
  } else {
    throw new Error(`${label}.kind must be named, constructor, or properties`);
  }
}

function validatePortableData(value: unknown, label: string, depth = 0): void {
  if (depth > MAX_WIRE_DEPTH) throw new RangeError(`${label} exceeds the ABI data nesting limit`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) validatePortableData(item, `${label}[${index}]`, depth + 1);
    return;
  }
  if (value instanceof Set) {
    for (const item of value) validatePortableData(item, `${label} set value`, depth + 1);
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value) {
      if (typeof key !== "string") throw new Error(`${label} map keys must be strings`);
      validatePortableData(item, `${label}.${key}`, depth + 1);
    }
    return;
  }
  const object = record(value, label);
  for (const [key, item] of Object.entries(object)) validatePortableData(item, `${label}.${key}`, depth + 1);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof Map || value instanceof Set) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, optional = false): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) throw new Error(`${label} has unknown field '${unknown}'`);
  if (!optional) {
    const missing = allowed.find((key) => !Object.hasOwn(value, key));
    if (missing) throw new Error(`${label} is missing field '${missing}'`);
  }
}

function stringMap(value: unknown, label: string, validate: (item: unknown, label: string) => void): void {
  if (!(value instanceof Map) || value.size > 100_000) throw new Error(`${label} must be a bounded map`);
  const seen = new Set<string>();
  for (const [key, item] of value) {
    if (typeof key !== "string" || key === "") throw new Error(`${label} keys must be non-empty strings`);
    if (seen.has(key)) throw new Error(`${label} repeats '${key}'`);
    seen.add(key);
    validate(item, `${label}.${key}`);
  }
}

function stringSet(value: unknown, label: string): void {
  if (!(value instanceof Set) || value.size > 100_000 || [...value].some((item) => typeof item !== "string" || item === "")) {
    throw new Error(`${label} must be a bounded set of non-empty strings`);
  }
}

function valueTypeList(value: unknown, label: string, validate: (item: unknown, label: string) => void): void {
  if (!Array.isArray(value) || value.length > 100_000) throw new Error(`${label} must be a bounded list`);
  value.forEach((item, index) => validate(item, `${label}[${index}]`));
}

function stringList(value: unknown, label: string, allowEmpty = false): void {
  if (!Array.isArray(value) || value.length > 100_000 || value.some((item) => typeof item !== "string" || (!allowEmpty && item === ""))) {
    throw new Error(`${label} must be a bounded list of ${allowEmpty ? "strings" : "non-empty strings"}`);
  }
}

function boundList(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length > 100_000 || value.some((item) => item !== null && item !== "Comparable" && item !== "Text" && item !== "Data")) {
    throw new Error(`${label} must contain only Comparable, Text, Data, or null`);
  }
}

function stringRecord(value: unknown, label: string): void {
  const object = record(value, label);
  for (const [key, item] of Object.entries(object)) {
    if (key === "" || typeof item !== "string") throw new Error(`${label} must map non-empty strings to strings`);
  }
}

function trueFlag(value: unknown, label: string): void {
  if (value !== undefined && value !== true) throw new Error(`${label} must be true when present`);
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value === "") throw new Error(`${label} must be a non-empty string`);
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined) nonEmptyString(value, label);
}

function nonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`);
}

function normalizedRelativePath(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value === "" || /[\u0000-\u001f\u007f]/u.test(value) || isAbsolute(value) || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a normalized relative path`);
  }
}

function artifactPath(root: string, value: unknown, label: string): string {
  normalizedRelativePath(value, label);
  const path = resolve(root, ...value.split("/"));
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error(`${label} escapes its package directory`);
  return path;
}

async function readArtifactText(packageRoot: string, path: string, maximum: number, label: string): Promise<string> {
  const [rootIdentity, metadata] = await Promise.all([realpath(packageRoot), lstat(path)]);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be an ordinary file`);
  const identity = await realpath(path);
  const fromRoot = relative(rootIdentity, identity);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error(`${label} escapes its package directory`);
  return readBoundedText(identity, maximum, label);
}

function hash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function packageExportTargets(exports: unknown, subpath: string): string[] {
  if (typeof exports === "string") return subpath === "." ? [exports] : [];
  if (exports === null || typeof exports !== "object" || Array.isArray(exports)) return [];
  const fields = exports as Record<string, unknown>;
  const target = Object.keys(fields).some((key) => key.startsWith(".")) ? fields[subpath] : subpath === "." ? exports : undefined;
  const output: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") output.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(target);
  return output;
}
