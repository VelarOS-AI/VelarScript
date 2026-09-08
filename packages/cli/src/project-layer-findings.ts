import type { VelarProjectConfig } from "./config.ts";
import {
  applicationEntryMigration,
  applicationEntryRefusal,
  ENTRY_MODULE_SITE,
  LIBRARY_ENTRY_DIAGNOSTIC,
  type ApplicationEntryMigration,
} from "./application-entry.ts";
import { nodeApplicationConfig } from "./node-application-config.ts";
import type { ProjectFailure, ProjectResult } from "./project.ts";
import { isExplicitProjectSourceInput } from "./project-source-package.ts";
import { projectManifestBytes, projectManifestSite } from "./project-manifest-site.ts";
import { configuredServerConfigurationFailure } from "./server-configuration-snapshot.ts";

/**
 * A project-owned refusal shared by check, fix, sessions, and the LSP.
 *
 * GA-I4: it is a `ProjectFailure` with a rewrite attached, so it prints through
 * `formatProjectFailure` like every other project-level failure —
 * `path:line:column error VELxxxx: message` with a source frame. The mechanical
 * half of this family always named its site (`src/main.vel:12:1 fixed
 * application-entry: …`); the refusing half named none.
 */
export interface ProjectLayerFinding extends ProjectFailure {
  /** A provably equivalent rewrite, or null when author intent is required. */
  readonly fix: ApplicationEntryMigration | null;
}

/**
 * Evaluates rules about project arrangement that no single module compile can
 * see. Keeping this in a dependency-light module lets the CLI and bundled LSP
 * consume the exact same findings without pulling command-only code into the
 * language-server runtime.
 */
export async function projectLayerFindings(
  config: VelarProjectConfig,
  project: ProjectResult,
): Promise<readonly ProjectLayerFinding[]> {
  const configuration = nodeApplicationConfig(config)?.configuration;
  const message = configuration == null ? null : await configuredServerConfigurationFailure(config.root, configuration);
  const findings = sourceLayerFindings(config, project);
  if (message === null) return findings;
  const manifest = projectManifestBytes(config);
  const site = manifest === null ? null : projectManifestSite(manifest.text, ["server", "configuration"]);
  return [{
    path: manifest?.path ?? config.root,
    message,
    code: "VEL6013",
    ...(manifest === null || site === null ? {} : { span: site.value, sourceText: manifest.text }),
    fix: null,
  }, ...findings];
}

function sourceLayerFindings(config: VelarProjectConfig, project: ProjectResult): readonly ProjectLayerFinding[] {
  if (isExplicitProjectSourceInput(config)) return [];
  if (project.failures.length > 0 || project.modules.some((module) => module.result.diagnostics.length > 0)) return [];
  if (config.kind === "application" && (config.framework || nodeApplicationConfig(config))) {
    const refusal = applicationEntryRefusal(project);
    if (refusal) return [{ ...refusal, fix: applicationEntryMigration(project) }];
  } else if (config.kind === "library") {
    const entries = project.modules.filter((module) =>
      project.executionEntries.has(module.inputPath) && module.result.hasMain
    );
    if (entries.length > 0) {
      return entries.map((entry) => ({
        path: entry.inputPath,
        message: "A library entry cannot declare '@main'; move startup into an application project",
        code: LIBRARY_ENTRY_DIAGNOSTIC,
        span: ENTRY_MODULE_SITE,
        fix: null,
      }));
    }
  }
  return [];
}
