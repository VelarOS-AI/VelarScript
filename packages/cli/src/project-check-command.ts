import { resolve } from "node:path";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import type { VelarProjectConfig } from "./config.ts";
import { hostErrorMessage } from "./host-error.ts";
import { checkResolvedProject, type CheckedProject } from "./project-check.ts";
import { isExplicitProjectSourceInput } from "./project-source-package.ts";

interface ProjectCheckCommandArguments {
  readonly input: string | null;
  readonly output: string | null;
  readonly outputDirectory: string | null;
  readonly sourceMaps: boolean | null;
}

export type CheckedProjectCommandResult =
  | { readonly checked: CheckedProject; readonly error: null; readonly exitCode: 0 }
  | { readonly checked: null; readonly error: string; readonly exitCode: 1 | 2 };

/** Keeps project-resolution failures on the command's ordinary user-error channel. */
export async function checkedProjectForCommand(
  command: string,
  config: VelarProjectConfig,
  arguments_: ProjectCheckCommandArguments,
): Promise<CheckedProjectCommandResult> {
  const explicitProjectSource = isExplicitProjectSourceInput(config);
  if (command === "build" && arguments_.output !== null && !explicitProjectSource) {
    return { checked: null, error: "--out requires an explicit .vel source input", exitCode: 2 };
  }
  if (command === "build" && config.manifestPath !== null && explicitProjectSource
    && arguments_.output === null && arguments_.outputDirectory === null) {
    return {
      checked: null,
      error: "an explicit .vel source inside a project cannot replace the project's declared outDir; use --out <file.js>, --out-dir <directory>, or build the project directory",
      exitCode: 2,
    };
  }
  if (command === "build" && config.manifestPath !== null && explicitProjectSource
    && arguments_.output === null && arguments_.outputDirectory !== null) {
    try {
      const requestedOutput = resolve(arguments_.outputDirectory);
      const declaredOutput = resolve(config.outDir);
      if (requestedOutput === declaredOutput
        || await canonicalizePotentialPath(requestedOutput) === await canonicalizePotentialPath(declaredOutput)) {
        return {
          checked: null,
          error: "an explicit .vel source inside a project cannot replace the project's declared outDir; choose a different --out-dir or build the project directory",
          exitCode: 2,
        };
      }
    } catch (error) {
      return { checked: null, error: hostErrorMessage(error), exitCode: 1 };
    }
  }
  const emitSourceMaps = command === "check"
    ? false
    : command === "package"
      ? config.build.sourceMaps
      : arguments_.sourceMaps ?? config.build.sourceMaps;
  try {
    const checked = await checkResolvedProject(config, arguments_.input, {
      emitSourceMaps,
    });
    return { checked, error: null, exitCode: 0 };
  } catch (error) {
    return { checked: null, error: hostErrorMessage(error), exitCode: 1 };
  }
}
