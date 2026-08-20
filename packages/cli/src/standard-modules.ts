import type { CompilerExtension, ModuleInterface } from "@velarscript/compiler";
import {
  CORE_WORKER_CONFIG_KEY,
  STANDARD_MODULE_ADAPTER_DEPENDENCIES,
  VELAR_STANDARD_API_VERSION,
  VELAR_WORKER_MANIFEST_MODULE,
  isStandardModule as coreIsStandardModule,
  standardModuleApi as coreStandardModuleApi,
  standardModuleAsset as coreStandardModuleAsset,
  standardModuleClosure as coreStandardModuleClosure,
  standardModuleDependencies as coreStandardModuleDependencies,
  standardModuleInterface as coreStandardModuleInterface,
  standardModuleInterfaces as coreStandardModuleInterfaces,
  standardModuleRoute,
  standardModuleSource as coreStandardModuleSource,
  standardModuleSources as coreStandardModuleSources,
  type StandardModuleApi,
} from "@velarscript/core";
import { velarNodeCompilerExtension } from "@velarscript/node/compiler";

export {
  CORE_WORKER_CONFIG_KEY,
  STANDARD_MODULE_ADAPTER_DEPENDENCIES,
  VELAR_STANDARD_API_VERSION,
  VELAR_WORKER_MANIFEST_MODULE,
  standardModuleRoute,
  type StandardModuleApi,
};

function withDefaultNode(extensions: readonly CompilerExtension[]): readonly CompilerExtension[] {
  return extensions.length === 0 ? [velarNodeCompilerExtension] : extensions;
}

export function standardModuleInterfaces(extensions: readonly CompilerExtension[] = []): ReadonlyMap<string, ModuleInterface> {
  return coreStandardModuleInterfaces(withDefaultNode(extensions));
}

export function isStandardModule(source: string, extensions: readonly CompilerExtension[] = []): boolean {
  return coreIsStandardModule(source, withDefaultNode(extensions));
}

export function standardModuleInterface(source: string, extensions: readonly CompilerExtension[] = []): ModuleInterface | null {
  return coreStandardModuleInterface(source, withDefaultNode(extensions));
}

export function standardModuleSources(extensions: readonly CompilerExtension[] = []): ReadonlyMap<string, string> {
  return coreStandardModuleSources(withDefaultNode(extensions));
}

export function standardModuleApi(extensions: readonly CompilerExtension[] = []): StandardModuleApi {
  return coreStandardModuleApi(withDefaultNode(extensions));
}

export function standardModuleSource(
  source: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): string | null {
  return coreStandardModuleSource(source, projectConfig, withDefaultNode(extensions));
}

export function standardModuleDependencies(
  source: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): readonly string[] | null {
  return coreStandardModuleDependencies(source, projectConfig, withDefaultNode(extensions));
}

export function standardModuleClosure(
  roots: Iterable<string>,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): ReadonlySet<string> {
  return coreStandardModuleClosure(roots, projectConfig, withDefaultNode(extensions));
}

export function standardModuleAsset(
  pathname: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): string | null {
  return coreStandardModuleAsset(pathname, projectConfig, withDefaultNode(extensions));
}
