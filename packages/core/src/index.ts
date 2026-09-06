/**
 * The VelarScript Standard API: the target-neutral `velar/*` contracts, the
 * JavaScript each one is made of, and the hidden compiler runtimes they reach.
 *
 * D115 §三 — this file is the aggregator and nothing else. One interface table
 * per module lives in `interfaces/<module>.ts`; one runtime body per module
 * lives in `runtime/<module>.js` and reaches TypeScript through the generated
 * `runtime-sources.generated.ts`. What is left here is the roster — which
 * modules exist, what each is made of, which internal runtime module each one
 * depends on — and the functions a host asks those questions through.
 */
import type { CompilerExtension, ModuleInterface } from "@velarscript/compiler";
import {
  VELAR_CLASS_FIELD_MODULE,
  VELAR_CLASS_FIELD_MODULE_SOURCE,
  VELAR_COLLECTION_HOST_MODULE,
  VELAR_COLLECTION_HOST_MODULE_SOURCE,
  VELAR_COLLECTION_LOWERING_DEPENDENCIES,
  VELAR_COLLECTION_LOWERING_MODULE,
  VELAR_COLLECTION_LOWERING_MODULE_SOURCE,
  VELAR_ERROR_NORMALIZATION_MODULE,
  VELAR_ERROR_NORMALIZATION_MODULE_SOURCE,
  VELAR_NARROWING_MODULE,
  VELAR_NARROWING_MODULE_SOURCE,
  VELAR_PRIMITIVE_METHOD_MODULE,
  VELAR_PRIMITIVE_METHOD_MODULE_SOURCE,
  VELAR_PROMISE_NORMALIZATION_MODULE,
  VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE,
  VELAR_RANGE_MODULE,
  VELAR_RANGE_MODULE_SOURCE,
  VELAR_REACTIVE_BRIDGE_MODULE,
  VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE,
  VELAR_TYPE_VALIDATION_MODULE,
  VELAR_TYPE_VALIDATION_MODULE_SOURCE,
} from "@velarscript/compiler/extension";
import {
  VELAR_CORE_ASYNC_MODULE_SOURCE,
  VELAR_CORE_BINARY_MODULE_SOURCE,
  VELAR_CORE_HASH_MODULE_SOURCE,
  VELAR_CORE_ID_MODULE_SOURCE,
  VELAR_CORE_JSON_MODULE_SOURCE,
  VELAR_CORE_LOG_MODULE_SOURCE,
  VELAR_CORE_MATH_MODULE_SOURCE,
  VELAR_CORE_RANDOM_MODULE_SOURCE,
  VELAR_CORE_TASK_MODULE_SOURCE,
  VELAR_CORE_TEST_MODULE_SOURCE,
  VELAR_CORE_TEXT_MODULE_SOURCE,
  VELAR_CORE_TIME_MODULE_SOURCE,
  VELAR_CORE_URL_MODULE_SOURCE,
  VELAR_CORE_VALIDATION_MODULE_SOURCE,
} from "./runtime-sources.generated.ts";
import { textModuleInterface } from "./interfaces/text.ts";
import { mathModuleInterface } from "./interfaces/math.ts";
import { binaryModuleInterface } from "./interfaces/binary.ts";
import { hashModuleInterface } from "./interfaces/hash.ts";
import { validationModuleInterface } from "./interfaces/validation.ts";
import { randomModuleInterface } from "./interfaces/random.ts";
import { taskModuleInterface } from "./interfaces/task.ts";
import { workerModuleInterface } from "./interfaces/worker.ts";
import { jsonModuleInterface } from "./interfaces/json.ts";
import { asyncModuleInterface } from "./interfaces/async.ts";
import { urlModuleInterface } from "./interfaces/url.ts";
import { timeModuleInterface } from "./interfaces/time.ts";
import { idModuleInterface } from "./interfaces/id.ts";
import { logModuleInterface } from "./interfaces/log.ts";
import { testModuleInterface } from "./interfaces/test.ts";
import { standardModuleRoute, standardModuleSpecifierFromRoute } from "./standard-module-route.ts";
export { standardModuleRoute } from "./standard-module-route.ts";
export const CORE_WORKER_CONFIG_KEY = "velar:core-workers-v1";
export const VELAR_STANDARD_API_VERSION = "0.7";

export const VELAR_WORKER_MANIFEST_MODULE = "velar/worker-manifest";

/** Every `velar/*` module Core itself owns, in the order the Standard API lists them. */
const coreModuleInterfaces = new Map<string, ModuleInterface>([
  ["velar/text", textModuleInterface],
  ["velar/math", mathModuleInterface],
  ["velar/binary", binaryModuleInterface],
  ["velar/hash", hashModuleInterface],
  ["velar/validation", validationModuleInterface],
  ["velar/random", randomModuleInterface],
  ["velar/task", taskModuleInterface],
  ["velar/worker", workerModuleInterface],
  ["velar/json", jsonModuleInterface],
  ["velar/async", asyncModuleInterface],
  ["velar/url", urlModuleInterface],
  ["velar/time", timeModuleInterface],
  ["velar/id", idModuleInterface],
  ["velar/log", logModuleInterface],
  ["velar/test", testModuleInterface],
]);

export function standardModuleInterfaces(extensions: readonly CompilerExtension[] = []): ReadonlyMap<string, ModuleInterface> {
  const activeExtensions = standardExtensions(extensions);
  return new Map([
    ...coreModuleInterfaces,
    ...combinedExtensionModules<ModuleInterface>(activeExtensions, "interfaces"),
  ]);
}

export function isStandardModule(source: string, extensions: readonly CompilerExtension[] = []): boolean {
  return standardModuleInterface(source, extensions) !== null;
}

export function standardModuleInterface(source: string, extensions: readonly CompilerExtension[] = []): ModuleInterface | null {
  for (const extension of standardExtensions(extensions)) {
    const interface_ = extension.modules?.interfaces.get(source);
    if (interface_) return interface_;
  }
  return coreModuleInterfaces.get(source) ?? null;
}

/**
 * The JavaScript each standard module is, plus the compiler-owned runtime
 * modules a project materializes beside them. `velar/worker` is absent on
 * purpose: it is a contract every target implements with its own host, so Core
 * publishes the interface and no source.
 */
const coreModuleSources: ReadonlyMap<string, string> = new Map([
  [VELAR_WORKER_MANIFEST_MODULE, "export const workerEntries = Object.freeze({});\n"],
  [VELAR_CLASS_FIELD_MODULE, VELAR_CLASS_FIELD_MODULE_SOURCE],
  [VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_HOST_MODULE_SOURCE],
  [VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_MODULE_SOURCE],
  [VELAR_ERROR_NORMALIZATION_MODULE, VELAR_ERROR_NORMALIZATION_MODULE_SOURCE],
  [VELAR_NARROWING_MODULE, VELAR_NARROWING_MODULE_SOURCE],
  [VELAR_PRIMITIVE_METHOD_MODULE, VELAR_PRIMITIVE_METHOD_MODULE_SOURCE],
  [VELAR_PROMISE_NORMALIZATION_MODULE, VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE],
  [VELAR_RANGE_MODULE, VELAR_RANGE_MODULE_SOURCE],
  [VELAR_REACTIVE_BRIDGE_MODULE, VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE],
  [VELAR_TYPE_VALIDATION_MODULE, VELAR_TYPE_VALIDATION_MODULE_SOURCE],
  ["velar/text", VELAR_CORE_TEXT_MODULE_SOURCE],
  ["velar/math", VELAR_CORE_MATH_MODULE_SOURCE],
  ["velar/binary", VELAR_CORE_BINARY_MODULE_SOURCE],
  ["velar/hash", VELAR_CORE_HASH_MODULE_SOURCE],
  ["velar/validation", VELAR_CORE_VALIDATION_MODULE_SOURCE],
  ["velar/random", VELAR_CORE_RANDOM_MODULE_SOURCE],
  ["velar/task", VELAR_CORE_TASK_MODULE_SOURCE],
  ["velar/json", VELAR_CORE_JSON_MODULE_SOURCE],
  ["velar/async", VELAR_CORE_ASYNC_MODULE_SOURCE],
  ["velar/url", VELAR_CORE_URL_MODULE_SOURCE],
  ["velar/time", VELAR_CORE_TIME_MODULE_SOURCE],
  ["velar/id", VELAR_CORE_ID_MODULE_SOURCE],
  ["velar/log", VELAR_CORE_LOG_MODULE_SOURCE],
  ["velar/test", VELAR_CORE_TEST_MODULE_SOURCE],
]);

/**
 * Implementation-only edges onto compiler-owned JavaScript modules. Public
 * ModuleInterface dependencies remain source-level VelarScript imports; this
 * graph only guarantees that unbundled targets materialize every hidden
 * runtime module a generated or standard module reaches for. A standard
 * module may appear on the left when it reuses a Core runtime algorithm
 * rather than restating it.
 */
const coreModuleDependencies: ReadonlyMap<string, readonly string[]> = new Map([
  [VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_DEPENDENCIES],
  ["velar/binary", [VELAR_COLLECTION_LOWERING_MODULE]],
  ["velar/hash", ["velar/binary"]],
  ["velar/validation", [VELAR_COLLECTION_LOWERING_MODULE, VELAR_TYPE_VALIDATION_MODULE]],
  // D50 rule 97.2: 'toEqual' is the language's own equals(a, b).
  ["velar/test", [VELAR_COLLECTION_LOWERING_MODULE] as readonly string[]],
]);


export function standardModuleSources(extensions: readonly CompilerExtension[] = []): ReadonlyMap<string, string> {
  const activeExtensions = standardExtensions(extensions);
  return new Map([
    ...coreModuleSources,
    ...combinedExtensionModules<string>(activeExtensions, "sources"),
  ]);
}

export interface StandardModuleApi {
  readonly standardVersion: string;
  readonly extensions: Readonly<Record<string, string>>;
  readonly modules: Readonly<Record<string, readonly string[]>>;
}

export function standardModuleApi(extensions: readonly CompilerExtension[] = []): StandardModuleApi {
  const activeExtensions = standardExtensions(extensions);
  const interfaces = standardModuleInterfaces(activeExtensions);
  return {
    standardVersion: VELAR_STANDARD_API_VERSION,
    extensions: Object.fromEntries(activeExtensions.map((extension) => [extension.id, extension.modules?.apiVersion ?? "unknown"])),
    modules: Object.fromEntries([...interfaces].map(([source, interface_]) => [source, [...interface_.exports.keys()].sort()])),
  };
}

export function standardModuleSource(
  source: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): string | null {
  if (source === VELAR_WORKER_MANIFEST_MODULE) {
    const configured = projectConfig instanceof Map ? projectConfig.get(CORE_WORKER_CONFIG_KEY) : undefined;
    const entries = configured && typeof configured === "object" && !Array.isArray(configured)
      ? Object.fromEntries(Object.entries(configured as Record<string, unknown>)
        .filter(([name, path]) => /^[a-z][a-z0-9_-]{0,63}$/u.test(name) && typeof path === "string")
        .map(([name, path]) => [name, path]))
      : {};
    return `export const workerEntries = Object.freeze(${JSON.stringify(entries)});\n`;
  }
  for (const extension of standardExtensions(extensions)) {
    const extensionConfig = projectConfig instanceof Map ? projectConfig.get(extension.id) : projectConfig;
    const framework = extension.modules?.source?.(source, extensionConfig) ?? extension.modules?.sources.get(source) ?? null;
    if (framework !== null) return framework;
  }
  return coreModuleSources.get(source) ?? null;
}

export function standardModuleDependencies(
  source: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): readonly string[] | null {
  for (const extension of standardExtensions(extensions)) {
    const extensionConfig = projectConfig instanceof Map ? projectConfig.get(extension.id) : projectConfig;
    const moduleSource = extension.modules?.source?.(source, extensionConfig) ?? extension.modules?.sources.get(source) ?? null;
    if (moduleSource !== null) return extension.modules?.dependencies?.get(source) ?? [];
  }
  return coreModuleSources.has(source) ? coreModuleDependencies.get(source) ?? [] : null;
}

export function standardModuleClosure(
  roots: Iterable<string>,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): ReadonlySet<string> {
  const modules = new Set<string>();
  const visit = (source: string, owner: string | null): void => {
    if (modules.has(source)) return;
    const dependencies = standardModuleDependencies(source, projectConfig, extensions);
    if (dependencies === null) {
      throw new Error(owner === null
        ? `Unknown VelarScript standard module '${source}'`
        : `VelarScript standard module '${owner}' depends on unknown module '${source}'`);
    }
    modules.add(source);
    for (const dependency of dependencies) visit(dependency, source);
  };
  for (const root of roots) visit(root, null);
  return modules;
}

function standardExtensions(extensions: readonly CompilerExtension[]): readonly CompilerExtension[] {
  return [...extensions];
}

function combinedExtensionModules<T>(
  extensions: readonly CompilerExtension[],
  field: "interfaces" | "sources",
): ReadonlyMap<string, T> {
  const combined = new Map<string, T>();
  for (const extension of [...extensions].reverse()) {
    const modules = extension.modules?.[field] as ReadonlyMap<string, T> | undefined;
    if (!modules) continue;
    for (const [source, value] of modules) {
      // A higher-priority, explicitly selected target owns both the contract
      // and source when two platforms intentionally share a module name.
      combined.delete(source);
      combined.set(source, value);
    }
  }
  return combined;
}
export function standardModuleAsset(
  pathname: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): string | null {
  const source = standardModuleSpecifierFromRoute(pathname);
  return source !== null && standardModuleSources(extensions).has(source)
    ? standardModuleSource(source, projectConfig, extensions) : null;
}
