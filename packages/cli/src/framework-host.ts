import { relative } from "node:path";
import type { FrameworkHostArtifacts } from "@velarscript/compiler/framework-host";
import type { ResolvedFrameworkHost } from "./config.ts";
import type { ProjectResult } from "./project.ts";
import { standardModuleRoute, standardModuleSources } from "./standard-modules.ts";

export interface FrameworkArtifactOverrides {
  readonly entryPath?: string;
  readonly stylesheetPath?: string | null;
  readonly includeStandardImports?: boolean;
}

export function createFrameworkArtifacts(
  project: ProjectResult,
  development = false,
  packageImports: Readonly<Record<string, string>> = {},
  overrides: FrameworkArtifactOverrides = {},
): FrameworkHostArtifacts | null {
  const framework = project.framework;
  if (!framework) return null;
  const base = frameworkBase(framework);
  const standardImports = overrides.includeStandardImports === false ? {} : Object.fromEntries(
    [...standardModuleSources(project.compilerExtensions).keys()].map((source) => [source, withBase(base, standardModuleRoute(source))]),
  );
  return framework.host.createArtifacts({
    config: framework.config,
    development,
    entryPath: overrides.entryPath ?? relative(project.sourceRoot, project.entryPath).replace(/\.vel$/u, ".js").replaceAll("\\", "/"),
    stylesheetPath: overrides.stylesheetPath === undefined ? "styles.css" : overrides.stylesheetPath,
    styles: project.modules.map((module) => module.result.css ?? "").filter(Boolean).join("\n"),
    imports: { ...standardImports, ...packageImports },
  });
}

export function frameworkBase(framework: ResolvedFrameworkHost | null): string {
  return framework ? framework.host.base(framework.config) : "/";
}

function withBase(base: string, path: string): string {
  return `${base}${path.replace(/^\/+/, "")}`;
}
