/**
 * Initialization order: which reads run while the module itself evaluates, and
 * which are deferred into a function body that runs later.
 *
 * D114 R1d: the initialization half of the module cluster. The frames
 * (`deferredReadFrames`, `localFunctionFrames`, `arrowDeferredFrames`) stay
 * fields of `Analyzer`, because the statement dispatch pushes and pops them.
 */
import { type Expression, type BindingPattern } from "../../ast.ts";
import { type InitializationImportRead } from "../../contracts.ts";
import { spanIdentity, type Span } from "../../source.ts";
import { type Binding } from "../scopes.ts";

/**
 * A deferred body — a module-local `def` or an arrow bound to a module-local
 * name — with the imported bindings it reads and the local functions it calls.
 * Calls are held as bindings rather than as resolved frames because a `def` is
 * hoisted: `const x = pull()` may be analyzed before `def pull()` is.
 */
export interface DeferredReadFrame {
  readonly reads: InitializationImportRead[];
  readonly calls: Binding[];
}

/**
 * Everything this half of the module cluster asks of the analyzer that hosts
 * it. The three halves share one host object.
 */
export interface ModuleInitializationHost {
  readonly arrowDeferredFrames: Map<string, DeferredReadFrame>;
  readonly deferredReadFrames: DeferredReadFrame[];
  readonly importedBindingSources: Map<Binding, { readonly source: string; readonly imported: string | null }>;
  inModuleInitializationPosition(): boolean;
  readonly initializationImportReadSites: Map<string, InitializationImportRead>;
  readonly initializationLocalCalls: { readonly binding: Binding; readonly span: Span }[];
  readonly localFunctionFrames: Map<Binding, DeferredReadFrame>;
  lookup(name: string): Binding | null;
  readonly scopes: Map<string, Binding>[];
}

export class ModuleInitialization {
  private readonly host: ModuleInitializationHost;

  constructor(host: ModuleInitializationHost) {
    this.host = host;
  }

  recordInitializationImportRead(binding: Binding, local: string, span: Span): void {
    const origin = this.host.importedBindingSources.get(binding);
    if (origin === undefined) return;
    const read: InitializationImportRead = { local, source: origin.source, imported: origin.imported, span };
    // D31 item 23: a read inside a deferred body belongs to that body, not to
    // the module. Whether it runs during module evaluation is decided by
    // `moduleInitializationImportReads`, once the top-level calls are known.
    const frame = this.host.deferredReadFrames.at(-1);
    if (frame) {
      frame.reads.push(read);
      return;
    }
    if (!this.host.inModuleInitializationPosition()) return;
    const key = spanIdentity(span);
    if (!this.host.initializationImportReadSites.has(key)) this.host.initializationImportReadSites.set(key, read);
  }

  /**
   * D31 item 23: the call edge. Inside a deferred body it is an edge of the
   * reachability graph; at module top level it is a root, because that call
   * runs the callee while the module itself evaluates. The callee is held as
   * a binding, not as a frame — a `def` is hoisted, so `const x = pull()` can
   * be analyzed before `def pull()` is.
   */
  recordDeferredCallEdge(callee: Expression, span: Span): void {
    if (callee.kind !== "IdentifierExpression") return;
    // The two cheap questions first: every other call would pay for a scope
    // lookup whose answer nothing reads.
    const frame = this.host.deferredReadFrames.at(-1);
    if (!frame && !this.host.inModuleInitializationPosition()) return;
    const binding = this.host.lookup(callee.name);
    if (!binding) return;
    if (frame) frame.calls.push(binding);
    else this.host.initializationLocalCalls.push({ binding, span });
  }

  /** Files an arrow's deferred frame under the module-local name it was bound to. */
  claimArrowDeferredFrame(pattern: BindingPattern, initializer: Expression): void {
    if (initializer.kind !== "ArrowFunctionExpression" || pattern.kind !== "NameBindingPattern") return;
    const frame = this.host.arrowDeferredFrames.get(spanIdentity(initializer.span));
    const binding = this.host.scopes.at(-1)?.get(pattern.name);
    if (frame && binding) this.host.localFunctionFrames.set(binding, frame);
  }

  /**
   * Initialization-position reads of imported bindings, for the project
   * module-cycle check.
   *
   * D31 item 23 recorded the indirect shape as a v1 residual: a top-level call
   * of a module-local function runs that body while the module evaluates, so
   * an imported binding read inside it is an initialization-position read too
   * — and following VEL3019's own remediation ("Move this read into a
   * function") and then calling that function at top level re-created the bare
   * `ReferenceError` the check exists to delete. The closure below is the
   * intra-module reachability pass that closes it: one module, one walk over
   * the call edges already collected, no cross-module analysis.
   *
   * An indirect read is reported at the *call*, not at the read. The call is
   * the line that runs during module evaluation and the line an author can
   * move; the read inside the body is already in a function, which is what the
   * remediation asks for.
   */
  moduleInitializationImportReads(): readonly InitializationImportRead[] {
    const sites = new Map(this.host.initializationImportReadSites);
    const visited = new Set<DeferredReadFrame>();
    const collect = (frame: DeferredReadFrame, callSpan: Span): void => {
      if (visited.has(frame)) return;
      visited.add(frame);
      for (const read of frame.reads) {
        const key = `${spanIdentity(callSpan)}\0${read.local}\0${read.source}`;
        if (!sites.has(key)) sites.set(key, { ...read, span: callSpan });
      }
      for (const called of frame.calls) {
        const next = this.host.localFunctionFrames.get(called);
        if (next) collect(next, callSpan);
      }
    };
    for (const call of this.host.initializationLocalCalls) {
      const frame = this.host.localFunctionFrames.get(call.binding);
      // One root at a time: two roots reaching the same body must each report,
      // so the visited set is per root rather than per module.
      if (frame) {
        visited.clear();
        collect(frame, call.span);
      }
    }
    return [...sites.values()];
  }
}
