import {
  type CompilerExtension,
} from "@velarscript/compiler";
import { isToolchainExtensionPackage } from "./extension-metadata.ts";
import {
  createJavaScriptModuleGraphBudget,
  inspectJavaScriptModuleWithinBudget,
  type JavaScriptModuleGraphBudget,
} from "./javascript-module-budget.ts";

export const MAX_EXTENSION_RUNTIME_SOURCE_BYTES = 1024 * 1024;
export const MAX_ACTIVE_EXTENSION_RUNTIME_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_EXTENSION_RUNTIME_MODULES = 256;
export const MAX_EXTENSION_RUNTIME_DEPENDENCIES = MAX_EXTENSION_RUNTIME_MODULES;
export const MAX_ACTIVE_EXTENSION_RUNTIME_DEPENDENCIES = 4096;

/** Detaches the runtime graph from Maps and arrays retained by third-party package code. */
export function snapshotExtensionRuntimeModules(
  extension: CompilerExtension,
  manifestPath: string,
): CompilerExtension {
  const modules = extension.modules;
  if (!modules || isToolchainExtensionPackage(extension.id)) return extension;
  if (!(modules.interfaces instanceof Map) || !(modules.sources instanceof Map)) {
    throw new Error(`${manifestPath}: extension '${extension.id}' module interfaces and sources must be Maps`);
  }
  if (modules.source !== undefined) {
    throw new Error(
      `${manifestPath}: extension '${extension.id}' cannot generate runtime module source dynamically; `
      + "third-party runtime modules must publish a closed static source graph",
    );
  }
  const dependencies = modules.dependencies;
  if (dependencies !== undefined && !(dependencies instanceof Map)) {
    throw new Error(`${manifestPath}: extension '${extension.id}' modules.dependencies must be a Map`);
  }
  const dependencySnapshot = new Map<string, readonly string[]>();
  for (const [specifier, targets] of dependencies ?? new Map()) {
    dependencySnapshot.set(specifier, Array.isArray(targets) ? Object.freeze([...targets]) : targets);
  }
  const capabilities = snapshotExtensionCapabilities(extension, manifestPath);
  return Object.freeze({
    ...extension,
    capabilities,
    modules: Object.freeze({
      ...modules,
      interfaces: new Map(modules.interfaces),
      sources: new Map(modules.sources),
      dependencies: dependencySnapshot,
    }),
  });
}

function snapshotExtensionCapabilities(
  extension: CompilerExtension,
  manifestPath: string,
): readonly string[] {
  const capabilities = extension.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.length > 16) {
    throw new Error(`${manifestPath}: extension '${extension.id}' capabilities must be a list with at most 16 entries`);
  }
  const snapshot: string[] = [];
  for (const capability of capabilities) {
    if (typeof capability !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(capability)) {
      throw new Error(`${manifestPath}: extension '${extension.id}' capabilities must use normalized capability names`);
    }
    if (snapshot.includes(capability)) {
      throw new Error(`${manifestPath}: extension '${extension.id}' declares duplicate capability '${capability}'`);
    }
    snapshot.push(capability);
  }
  return Object.freeze(snapshot);
}

/**
 * Third-party runtime modules are a closed compiler-owned graph. They cannot
 * invent an npm dependency ABI that the extension protocol cannot own or
 * materialize yet.
 */
export function validateExtensionRuntimeClosure(
  extensions: readonly CompilerExtension[],
  activeRuntimeModules: ReadonlySet<string>,
  manifestPath: string,
): void {
  const thirdParty = extensions.filter((extension) => !isToolchainExtensionPackage(extension.id) && extension.modules);
  let totalSourceBytes = 0;
  for (const extension of thirdParty) {
    const modules = extension.modules!;
    if (!(modules.sources instanceof Map)) {
      throw new Error(`${manifestPath}: extension '${extension.id}' module sources must be a Map`);
    }
    if (modules.source !== undefined) {
      throw new Error(
        `${manifestPath}: extension '${extension.id}' cannot generate runtime module source dynamically; `
        + "third-party runtime modules must publish a closed static source graph",
      );
    }
    for (const specifier of modules.interfaces.keys()) {
      if (!modules.sources.has(specifier)) {
        throw new Error(
          `${manifestPath}: extension '${extension.id}' module interface '${specifier}' has no runtime source implementation`,
        );
      }
    }
    for (const [specifier, source] of modules.sources) {
      if (typeof source !== "string") {
        throw new Error(`${manifestPath}: extension '${extension.id}' module '${specifier}' has a non-string runtime source`);
      }
      const sourceBytes = Buffer.byteLength(source, "utf8");
      if (sourceBytes > MAX_EXTENSION_RUNTIME_SOURCE_BYTES) {
        throw new RangeError(
          `${manifestPath}: extension '${extension.id}' module '${specifier}' runtime source exceeds `
          + `${MAX_EXTENSION_RUNTIME_SOURCE_BYTES} bytes`,
        );
      }
      totalSourceBytes += sourceBytes;
      if (totalSourceBytes > MAX_ACTIVE_EXTENSION_RUNTIME_SOURCE_BYTES) {
        throw new RangeError(
          `${manifestPath}: active third-party runtime module sources exceed `
          + `${MAX_ACTIVE_EXTENSION_RUNTIME_SOURCE_BYTES} bytes in total`,
        );
      }
    }
  }
  const syntaxBudget = createJavaScriptModuleGraphBudget();
  let dependencyCount = 0;
  for (const extension of thirdParty) {
    const modules = extension.modules!;
    const sources = modules.sources;
    const dependencies = validatedDependencyMap(extension, sources, activeRuntimeModules, manifestPath);
    for (const targets of dependencies.values()) dependencyCount += targets.length;
    if (dependencyCount > MAX_ACTIVE_EXTENSION_RUNTIME_DEPENDENCIES) {
      throw new RangeError(
        `${manifestPath}: active third-party runtime modules cannot declare more than `
        + `${MAX_ACTIVE_EXTENSION_RUNTIME_DEPENDENCIES} dependency edges in total`,
      );
    }
    for (const [specifier, source] of sources) {
      const inspection = inspectRuntimeSource(extension.id, specifier, source, manifestPath, syntaxBudget);
      const declared = new Set(dependencies.get(specifier) ?? []);
      for (const edge of inspection.edges) {
        if (edge.source === null) {
          throw new Error(
            `${manifestPath}: extension '${extension.id}' module '${specifier}' uses a computed dynamic import; `
            + "third-party runtime dependencies must be static compiler-owned module specifiers",
          );
        }
        if (!activeRuntimeModules.has(edge.source)) {
          throw new Error(
            `${manifestPath}: extension '${extension.id}' module '${specifier}' imports '${edge.source}', `
            + "but third-party runtime modules may import only active compiler-owned modules",
          );
        }
        if (!declared.has(edge.source)) {
          throw new Error(
            `${manifestPath}: extension '${extension.id}' module '${specifier}' imports compiler-owned module `
            + `'${edge.source}' without declaring it in modules.dependencies`,
          );
        }
      }
    }
  }
}

function validatedDependencyMap(
  extension: CompilerExtension,
  sources: ReadonlyMap<string, string>,
  activeRuntimeModules: ReadonlySet<string>,
  manifestPath: string,
): ReadonlyMap<string, readonly string[]> {
  const dependencies = extension.modules?.dependencies;
  if (dependencies === undefined) return new Map();
  if (!(dependencies instanceof Map)) {
    throw new Error(`${manifestPath}: extension '${extension.id}' modules.dependencies must be a Map`);
  }
  if (dependencies.size > MAX_EXTENSION_RUNTIME_MODULES) {
    throw new RangeError(
      `${manifestPath}: extension '${extension.id}' modules.dependencies cannot declare more than `
      + `${MAX_EXTENSION_RUNTIME_MODULES} module keys`,
    );
  }
  const output = new Map<string, readonly string[]>();
  for (const [specifier, targets] of dependencies as ReadonlyMap<unknown, unknown>) {
    if (typeof specifier !== "string" || !sources.has(specifier)) {
      throw new Error(
        `${manifestPath}: extension '${extension.id}' modules.dependencies key '${String(specifier)}' `
        + "must identify one of its runtime module sources",
      );
    }
    if (!Array.isArray(targets)) {
      throw new Error(
        `${manifestPath}: extension '${extension.id}' module '${specifier}' dependencies must be an array of module specifiers`,
      );
    }
    if (targets.length > MAX_EXTENSION_RUNTIME_DEPENDENCIES) {
      throw new RangeError(
        `${manifestPath}: extension '${extension.id}' module '${specifier}' cannot declare more than `
        + `${MAX_EXTENSION_RUNTIME_DEPENDENCIES} runtime dependencies`,
      );
    }
    const unique = new Set<string>();
    for (const target of targets) {
      if (typeof target !== "string" || !activeRuntimeModules.has(target)) {
        throw new Error(
          `${manifestPath}: extension '${extension.id}' module '${specifier}' dependency '${String(target)}' `
          + "must identify an active compiler-owned runtime module",
        );
      }
      if (unique.has(target)) {
        throw new Error(
          `${manifestPath}: extension '${extension.id}' module '${specifier}' declares duplicate runtime dependency '${target}'`,
        );
      }
      unique.add(target);
    }
    output.set(specifier, Object.freeze([...unique]));
  }
  return output;
}

function inspectRuntimeSource(
  extensionId: string,
  specifier: string,
  source: string,
  manifestPath: string,
  syntaxBudget: JavaScriptModuleGraphBudget,
): ReturnType<typeof inspectJavaScriptModuleWithinBudget> {
  try {
    return inspectJavaScriptModuleWithinBudget(source, syntaxBudget);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof RangeError) {
      throw new RangeError(
        `${manifestPath}: extension '${extensionId}' module '${specifier}' exceeds its JavaScript syntax boundary: ${message}`,
      );
    }
    throw new Error(`${manifestPath}: extension '${extensionId}' module '${specifier}' contains invalid ESM: ${message}`);
  }
}
