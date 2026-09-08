import { diagnostic, formatDiagnostic, SourceText } from "@velarscript/compiler";
import type { ProjectFailure, ProjectResult } from "./project.ts";

/**
 * MD-I1/MD-I2: one rendering of a project failure, for every command that
 * prints one.
 *
 * A module-resolution failure is a compiler failure about a line the author
 * wrote, so when it carries a code and a span it is presented exactly as the
 * compiler's own diagnostics are — `path:line:col error VELxxxx: message`, the
 * source line, and a caret under the import. Before this existed, seven call
 * sites each spelled `${failure.path}: ${failure.message}`, which is how the
 * whole module-resolution family came to be the one diagnostic family with no
 * code and no position: there was nowhere for a code and a position to go.
 *
 * GA-D2 adds the second kind of site. A rule about how the *project* is
 * arranged is about a line of `velar.json`, which is not a module and is
 * therefore not in the graph a site is looked up in; a failure sited there
 * carries the manifest's own bytes and is rendered from those.
 *
 * A failure with no code — a project-wide limit, a host read error with no
 * import behind it — keeps the plain `path: message` line, because inventing a
 * position for it would point the author at source that is not the cause.
 */
export function formatProjectFailure(failure: ProjectFailure, project: ProjectResult): string {
  if (failure.code === undefined || failure.span === undefined) return `${failure.path}: ${failure.message}`;
  const source = failure.sourceText === undefined
    ? project.modules.find((item) => item.inputPath === failure.path)?.result.source
    : new SourceText(failure.path, failure.sourceText);
  if (source === undefined) return `${failure.path}: ${failure.message}`;
  return formatDiagnostic(source, diagnostic(failure.code, failure.message, failure.span));
}

/** Every failure of one project, rendered in the order the driver recorded them. */
export function formatProjectFailures(project: ProjectResult): string[] {
  return project.failures.map((failure) => formatProjectFailure(failure, project));
}
