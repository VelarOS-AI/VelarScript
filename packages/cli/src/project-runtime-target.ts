import type { CompilerExtension } from "@velarscript/compiler";
import { isNodeOnlyModule, nodeModuleDiagnostic } from "@velarscript/node/compiler";
import {
  unknownCompilerRuntimeModuleMessage,
  unknownCompilerRuntimeModules,
} from "./compiler-runtime-modules.ts";
import { compilerRuntimeTargetViolation } from "./compiler-runtime-target.ts";
import type { VelarPackageTarget } from "./package-target.ts";
import { isStandardModule } from "./standard-modules.ts";

interface RuntimeModuleResult {
  readonly runtimeModules: readonly string[];
}

interface RuntimeModuleProjectEntry {
  readonly inputPath: string;
  readonly result: RuntimeModuleResult;
}

interface RuntimeTargetFailure {
  readonly path: string;
  readonly message: string;
}

/** Handles an active compiler-owned import and records any target mismatch. */
export function handleStandardModuleTarget(
  source: string,
  inputPath: string,
  failures: RuntimeTargetFailure[],
  packageTarget: VelarPackageTarget,
  browserTarget: boolean,
  extensionConfig: unknown,
  compilerExtensions: readonly CompilerExtension[],
): boolean {
  if (isNodeOnlyModule(source) && browserTarget && !extensionOwnsStandardModule(source, compilerExtensions)) {
    failures.push({ path: inputPath, message: nodeModuleDiagnostic(source) });
    return true;
  }
  if (!isStandardModule(source, compilerExtensions)) return false;
  if (packageTarget !== "core") return true;
  const violation = compilerRuntimeTargetViolation(source, "core", extensionConfig, compilerExtensions);
  if (violation === null) return true;
  const transit = violation.root === violation.source ? "" : ` through '${violation.source}'`;
  failures.push({
    path: inputPath,
    message: `Core target cannot import compiler runtime '${violation.root}'${transit}; `
      + `it requires target extension '${violation.owner}'`,
  });
  return true;
}

/** Reports target-specific helpers selected implicitly by compiler lowering. */
export function appendCompilerRuntimeTargetDiagnostics(
  modules: readonly RuntimeModuleProjectEntry[],
  failures: RuntimeTargetFailure[],
  packageTarget: VelarPackageTarget,
  extensionConfig: unknown,
  compilerExtensions: readonly CompilerExtension[],
): void {
  const unknown = unknownCompilerRuntimeModules(modules, compilerExtensions);
  for (const violation of unknown) failures.push({
    path: violation.inputPath,
    message: unknownCompilerRuntimeModuleMessage(violation),
  });
  if (packageTarget !== "core") return;
  const unknownRoots = new Set(unknown.map((violation) => `${violation.inputPath}\0${violation.source}`));
  for (const module of modules) {
    for (const source of module.result.runtimeModules) {
      if (unknownRoots.has(`${module.inputPath}\0${source}`)) continue;
      const violation = compilerRuntimeTargetViolation(source, "core", extensionConfig, compilerExtensions);
      if (violation === null) continue;
      const transit = violation.root === violation.source ? "" : ` through '${violation.source}'`;
      failures.push({
        path: module.inputPath,
        message: `Core target lowering requires compiler runtime '${violation.root}'${transit}; `
          + `it requires target extension '${violation.owner}'`,
      });
    }
  }
}

function extensionOwnsStandardModule(source: string, extensions: readonly CompilerExtension[]): boolean {
  return extensions.some((extension) => extension.id !== "@velarscript/node" && extension.modules?.interfaces.has(source));
}
