/**
 * The migration off the import spellings a permanent namespace replaced.
 *
 * D52 rule 116 / D50 rule 90 retired `import {stringify} from "velar/json"` in
 * favour of `Json.stringify`, and `import {range} from "velar/collections"` in
 * favour of the Core prelude name. What is left is one report per specifier and
 * the rewrite that carries the whole module across in a single pass — a subject
 * of its own, about a module's import list rather than about any type, so under
 * D115 §三 it is its own module rather than another hundred lines of
 * `analyzer.ts`.
 */
import type { Program, Statement } from "../ast.ts";
import { diagnostic, mechanicalEdits, type Diagnostic, type DiagnosticEdit } from "../diagnostic.ts";
import { spanIdentity, type Span } from "../source.ts";
import { permanentNamespaceImportRoster } from "./vocabulary.ts";

/** What this migration asks of the analyzer that hosts it, and nothing more. */
export interface PermanentNamespaceImportHost {
  readonly diagnostics: Diagnostic[];
  renderNamedImport(source: string, specifiers: readonly { readonly imported: string; readonly local: string }[]): string;
}

export class PermanentNamespaceImports {
  private readonly host: PermanentNamespaceImportHost;

  constructor(host: PermanentNamespaceImportHost) {
    this.host = host;
  }

  /** D52 rule 116: reads of a name imported from a module that has a permanent namespace. */
  readonly reads: { readonly local: string; readonly source: string; readonly imported: string; readonly span: Span }[] = [];

  /** The import each such local came from, keyed by the local name. */
  readonly origins = new Map<string, { readonly source: string; readonly imported: string; readonly specifier: Span }>();

  /**
   * D114 0.28.0 D-I1: the import specifiers this migration's report already
   * answers for, by span. `declareBinding` leaves the reserved-Core-binding
   * sentence unsaid at those, exactly as `refusedTypeNames` does for a type
   * name a nearer roster already refused — one spelling, one report. They are
   * kept by span rather than by name because only *this* import of the name is
   * answered for; a local of the same name elsewhere is still refused.
   */
  readonly refusedSpecifiers = new Set<string>();

  register(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" || statement.javascript) continue;
      const roster = permanentNamespaceImportRoster(statement.source);
      if (!roster) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.namespace || !roster.members.has(specifier.imported)) continue;
        // D114 0.28.0 D-I1: `import {range} from "velar/collections"` is one
        // mistake and used to earn two reports — VEL3007 because `range` is a
        // reserved Core binding, and the VEL3008 below because the prelude
        // needs no import. The second says why the name is taken *and* what to
        // write instead, so it is the one that survives; the specifier is
        // marked here, before `predeclareTopLevel` declares it.
        this.refusedSpecifiers.add(spanIdentity(specifier.span));
        this.origins.set(specifier.local, {
          source: statement.source,
          imported: specifier.imported,
          specifier: specifier.span,
        });
      }
    }
  }

  /**
   * D52 rule 116 / D50 rule 90: a permanent namespace needs no import, so the
   * import spelling retires. The rewrite is the import's own inverse — take the
   * specifier out, put the prefix on every read it left behind — and it is
   * carried whole so the author never sees a half-migrated module.
   */
  report(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" || statement.javascript) continue;
      const roster = permanentNamespaceImportRoster(statement.source);
      if (!roster) continue;
      const retired = statement.specifiers.filter((specifier) => specifier.namespace
        ? roster.namespace !== null
        : roster.members.has(specifier.imported));
      if (retired.length === 0) continue;
      const survivors = statement.specifiers.filter((specifier) => !retired.includes(specifier));
      const edits: DiagnosticEdit[] = [];
      let rewritable = true;
      for (const specifier of retired) {
        if (specifier.namespace) {
          // D50 rule 97.3: the namespace form reaches every retired member at
          // once, so it retires with them. Which member each `local.member`
          // read wanted is a rewrite this migration does not claim to know.
          rewritable = false;
          continue;
        }
        const replacement = roster.namespace === null ? specifier.imported : `${roster.namespace}.${specifier.imported}`;
        for (const read of this.reads) {
          if (read.span.start === statement.span.start) continue;
          if (read.local !== specifier.local || read.source !== statement.source || read.imported !== specifier.imported) continue;
          if (replacement === specifier.local) continue;
          edits.push({ span: read.span, text: replacement });
        }
      }
      if (rewritable) {
        edits.push(survivors.length === 0
          ? { span: { start: statement.span.start, end: statement.span.end + 1 }, text: "" }
          : {
            span: statement.span,
            text: this.host.renderNamedImport(statement.source, survivors.map((specifier) => ({ imported: specifier.imported, local: specifier.local }))),
          });
      }
      let fixAttached = !rewritable;
      for (const specifier of retired) {
        const message = specifier.namespace
          ? `Use ${roster.namespace} directly; VelarScript's pure namespaces need no import`
          : roster.namespace === null
            ? `Use ${specifier.imported}(...) directly; the Core prelude needs no import`
            : `Use ${roster.namespace}.${specifier.imported} directly; VelarScript's pure namespaces need no import`;
        if (fixAttached) {
          this.host.diagnostics.push(diagnostic("VEL3008", message, specifier.span));
          continue;
        }
        fixAttached = true;
        this.host.diagnostics.push(diagnostic("VEL3008", message, specifier.span, mechanicalEdits(
          edits,
          roster.namespace === null
            ? "Drop the import; the Core prelude needs none"
            : `Drop the import and read through ${roster.namespace}`,
        )));
      }
    }
  }

  /**
   * D50 rule 97.3: a retirement that leaves one surviving spelling did not
   * happen. `export {stringify} from "velar/json"` is an import spelling with
   * an export in front of it — the barrel republishes the retired bare name
   * and every downstream `import {stringify} from "./barrel.vel"` is clean
   * forever after. No mechanical fix: which reads in which other modules
   * wanted the name is not a rewrite this module can make.
   */
  reportReExports(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ReExportDeclaration") continue;
      const roster = permanentNamespaceImportRoster(statement.source);
      if (!roster) continue;
      for (const specifier of statement.specifiers) {
        if (!roster.members.has(specifier.imported)) continue;
        this.host.diagnostics.push(diagnostic(
          "VEL3008",
          roster.namespace === null
            ? `Use ${specifier.imported}(...) directly; a re-export cannot restore a retired import spelling, and the Core prelude needs none`
            : `Use ${roster.namespace}.${specifier.imported} directly; a re-export cannot restore a retired import spelling`,
          specifier.span,
        ));
      }
    }
  }
}
