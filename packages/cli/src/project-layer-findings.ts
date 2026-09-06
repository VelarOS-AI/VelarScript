import type { VelarProjectConfig } from "./config.ts";
import {
  applicationEntry,
  applicationEntryMigration,
  type ApplicationEntryMigration,
} from "./application-entry.ts";
import { nodeApplicationConfig } from "./node-application-config.ts";
import type { ProjectResult } from "./project.ts";
import { isExplicitProjectSourceInput } from "./project-source-package.ts";

/** A project-owned refusal shared by check, fix, sessions, and the LSP. */
export interface ProjectLayerFinding {
  /** Source file that owns the project-level refusal, for editor diagnostics. */
  readonly path: string;
  readonly message: string;
  /** A provably equivalent rewrite, or null when author intent is required. */
  readonly fix: ApplicationEntryMigration | null;
}

/**
 * Evaluates rules about project arrangement that no single module compile can
 * see. Keeping this in a dependency-light module lets the CLI and bundled LSP
 * consume the exact same findings without pulling command-only code into the
 * language-server runtime.
 */
export function projectLayerFindings(
  config: VelarProjectConfig,
  project: ProjectResult,
): readonly ProjectLayerFinding[] {
  if (isExplicitProjectSourceInput(config)) return [];
  if (project.failures.length > 0 || project.modules.some((module) => module.result.diagnostics.length > 0)) return [];
  if (config.kind === "application" && (config.framework || nodeApplicationConfig(config))) {
    try {
      applicationEntry(project);
    } catch (error) {
      return [{
        path: project.entryPath,
        message: error instanceof Error ? error.message : "Application entry validation failed",
        fix: applicationEntryMigration(project),
      }];
    }
  } else if (config.kind === "library") {
    const entries = project.modules.filter((module) =>
      project.executionEntries.has(module.inputPath) && module.result.hasMain
    );
    if (entries.length > 0) {
      return entries.map((entry) => ({
        path: entry.inputPath,
        message: `${entry.inputPath}: A library entry cannot declare '@main'; move startup into an application project`,
        fix: null,
      }));
    }
  }
  return [];
}
