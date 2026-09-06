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
import { astNodesOfKind, type NamedTypeSyntax, type Program } from "../ast.ts";
import { diagnostic, mechanicalEdits, type Diagnostic, type DiagnosticEdit } from "../diagnostic.ts";
import { spanIdentity, type Span } from "../source.ts";
import { permanentNamespaceImportRoster } from "./vocabulary.ts";

/**
 * D114 AS-I2: the exports a standard module retired into a name that needs no
 * import, with that name.
 *
 * `velar/task` published `TaskTimeoutError` while `Promise.timeout` rejected
 * with a bare `Error`, so one concept — "the budget ran out" — had two
 * identities and one of them was not discriminable at all. Charter §11 allows
 * an error exactly one classification, so the two became `TimeoutError`, a Core
 * built-in that every module can name without importing anything. The old
 * spelling is answered here, with the rewrite that carries a module across in
 * one pass.
 *
 * The retired name stays in the module's published interface as a tombstone.
 * Nothing throws it and no annotation can reach it, and keeping it is what lets
 * this migration be the *only* report an author sees: dropping the export
 * outright would add the project driver's "has no export named" beside it, and
 * that sentence carries no rewrite.
 */
export const RETIRED_MODULE_EXPORTS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  ["velar/task", new Map([["TaskTimeoutError", "TimeoutError"]])],
]);

/** The name one retired module export retired into, or null when the export stands. */
export function retiredModuleExport(source: string, name: string): string | null {
  return RETIRED_MODULE_EXPORTS.get(source)?.get(name) ?? null;
}

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
      const retiredExports = RETIRED_MODULE_EXPORTS.get(statement.source);
      if (!roster && !retiredExports) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.namespace) continue;
        if (!(roster?.members.has(specifier.imported) ?? false) && !(retiredExports?.has(specifier.imported) ?? false)) continue;
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
      const retiredExports = RETIRED_MODULE_EXPORTS.get(statement.source);
      if (!roster && !retiredExports) continue;
      const retired = statement.specifiers.filter((specifier) => specifier.namespace
        ? roster?.namespace != null
        : (roster?.members.has(specifier.imported) ?? false) || (retiredExports?.has(specifier.imported) ?? false));
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
        const replacement = this.replacementFor(statement.source, specifier.imported, roster);
        for (const read of this.reads) {
          if (read.span.start === statement.span.start) continue;
          if (read.local !== specifier.local || read.source !== statement.source || read.imported !== specifier.imported) continue;
          if (replacement === specifier.local) continue;
          edits.push({ span: read.span, text: replacement });
        }
        // D114 AS-I2: a retired *class* is read in type positions too — `is
        // TaskTimeoutError`, an annotation, a `catch` narrowing — and those are
        // not identifier expressions, so `reads` never sees them. A module-scope
        // import owns its local name outright (a local declaration of the same
        // spelling is VEL3004), so every type reference spelled that way in this
        // module is a use of it. Migrating the import without them would leave
        // the module holding a name nothing declares any more.
        if (retiredModuleExport(statement.source, specifier.imported) !== null && replacement !== specifier.local) {
          for (const reference of astNodesOfKind<NamedTypeSyntax>(program, "NamedTypeSyntax")) {
            if (reference.name === specifier.local) edits.push({ span: reference.span, text: replacement });
          }
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
        const message = this.retirementMessage(statement.source, specifier.imported, specifier.namespace, roster);
        if (fixAttached) {
          this.host.diagnostics.push(diagnostic("VEL3008", message, specifier.span));
          continue;
        }
        fixAttached = true;
        this.host.diagnostics.push(diagnostic("VEL3008", message, specifier.span, mechanicalEdits(
          edits,
          roster?.namespace == null
            ? "Drop the import; the name needs none"
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
      const retiredExports = RETIRED_MODULE_EXPORTS.get(statement.source);
      if (!roster && !retiredExports) continue;
      for (const specifier of statement.specifiers) {
        const retiredExport = retiredModuleExport(statement.source, specifier.imported);
        if (!(roster?.members.has(specifier.imported) ?? false) && retiredExport === null) continue;
        this.host.diagnostics.push(diagnostic(
          "VEL3008",
          retiredExport !== null
            ? `Use ${retiredExport} directly; a re-export cannot restore a retired import spelling, and the Core error class needs none`
            : roster?.namespace == null
              ? `Use ${specifier.imported}(...) directly; a re-export cannot restore a retired import spelling, and the Core prelude needs none`
              : `Use ${roster.namespace}.${specifier.imported} directly; a re-export cannot restore a retired import spelling`,
          specifier.span,
        ));
      }
    }
  }

  /** The text every read of one retired import spelling becomes. */
  private replacementFor(
    source: string,
    imported: string,
    roster: { readonly namespace: string | null; readonly members: ReadonlySet<string> } | null,
  ): string {
    const retiredExport = retiredModuleExport(source, imported);
    if (retiredExport !== null) return retiredExport;
    return roster?.namespace == null ? imported : `${roster.namespace}.${imported}`;
  }

  /** The one sentence a retired import spelling earns, whichever roster retired it. */
  private retirementMessage(
    source: string,
    imported: string,
    namespaceForm: boolean,
    roster: { readonly namespace: string | null; readonly members: ReadonlySet<string> } | null,
  ): string {
    const retiredExport = namespaceForm ? null : retiredModuleExport(source, imported);
    // D114 AS-I2: the replacement is a Core built-in error class, so the
    // sentence says the same thing the prelude's does — the name is already
    // yours — with the reason this one is.
    if (retiredExport !== null) return `Use ${retiredExport} directly; a timeout raises the Core error class, which needs no import`;
    if (namespaceForm) return `Use ${roster?.namespace} directly; VelarScript's pure namespaces need no import`;
    return roster?.namespace == null
      ? `Use ${imported}(...) directly; the Core prelude needs no import`
      : `Use ${roster.namespace}.${imported} directly; VelarScript's pure namespaces need no import`;
  }
}
