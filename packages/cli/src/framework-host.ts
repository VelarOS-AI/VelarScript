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
    styles: projectStyles(project),
    imports: { ...standardImports, ...packageImports },
  });
}

export function projectStyles(project: ProjectResult): string {
  const before: string[] = [];
  const controlled: string[] = [];
  const after: string[] = [];
  for (const module of project.modules) {
    const segments = module.result.styleSegments;
    if (segments) {
      if (segments.before) before.push(segments.before);
      // A controlled segment is the module's generated rules joined by a blank
      // line, so splitting on that separator recovers the rules themselves.
      if (segments.controlled) controlled.push(...segments.controlled.split("\n\n"));
      if (segments.after) after.push(segments.after);
    } else if (module.result.css) {
      controlled.push(module.result.css);
    }
  }
  const raw = [...before, ...lastOfEach(controlled), ...after].filter(Boolean).join("\n\n");
  const styles = raw ? `${raw}\n` : "";
  return project.framework?.host.prepareStyles?.(project.framework.config, styles) ?? styles;
}

/**
 * A generated rule means the same thing in every module that produced it, so
 * the stylesheet carries each distinct rule once. Keeping the last occurrence
 * rather than the first leaves the document-order cascade winner exactly where
 * it was: a duplicate that used to decide a tie by coming last still does.
 */
function lastOfEach(rules: readonly string[]): string[] {
  const last = new Map<string, number>();
  rules.forEach((rule, index) => last.set(rule, index));
  return rules.filter((rule, index) => last.get(rule) === index);
}

export function frameworkBase(framework: ResolvedFrameworkHost | null): string {
  return framework ? framework.host.base(framework.config) : "/";
}

function withBase(base: string, path: string): string {
  return `${base}${path.replace(/^\/+/, "")}`;
}
