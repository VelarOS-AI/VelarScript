/**
 * What a Promise may resolve to. JavaScript resolves a thenable by calling its
 * `then`, so a value that carries one — a data field, a getter, a method,
 * anywhere in a union or behind an optional — would be executed instead of
 * delivered. This module is the one place that decides whether a type carries
 * that hazard, whether the lowering needs a runtime guard for it, and what the
 * refusal says.
 *
 * D114 R1f: the family reaches three statement heads — a `return`, an async
 * `def`, and an `extern` declaration's result — so it is its own module rather
 * than a private half of any one of them.
 */
import { diagnostic, type Diagnostic } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";
import { describeType, isInvalidType, resolvedAsyncType, sameType, type ValueType } from "../../types.ts";
import { type ClassField } from "../../contracts.ts";

/**
 * Everything the async-result rules ask of the analyzer that hosts them, and
 * nothing more. The reported set is a live read: one hazard per span, whichever
 * declaration reaches the span first.
 */
export interface AsyncResultsHost {
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  findField(className: string, name: string): ClassField | null;
  findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  readonly diagnostics: Diagnostic[];
  readonly reportedPromiseResolutionHazards: Set<string>;
  resolveNamedClasses(type: ValueType): ValueType;
}

export class AsyncResults {
  private readonly host: AsyncResultsHost;

  constructor(host: AsyncResultsHost) {
    this.host = host;
  }

  asyncResultContainsPromise(type: ValueType): boolean {
    const expanded = this.host.expandAliases(type);
    return !sameType(expanded, resolvedAsyncType(expanded));
  }

  private callableThenMember(type: ValueType): boolean {
    const expanded = this.host.expandAliases(type);
    if (expanded.kind === "any" || expanded.kind === "unknown") return !isInvalidType(expanded);
    if (expanded.kind === "optional") return this.callableThenMember(expanded.inner);
    if (expanded.kind === "union") return expanded.members.some((member) => this.callableThenMember(member));
    return expanded.kind === "function"
      || expanded.kind === "action"
      || expanded.kind === "intrinsic"
      || expanded.kind === "classConstructor";
  }

  promiseResolutionHazard(type: ValueType): string | null {
    const expanded = this.host.resolveNamedClasses(this.host.expandAliases(type));
    if (expanded.kind === "optional") return this.promiseResolutionHazard(expanded.inner);
    if (expanded.kind === "union") {
      for (const member of expanded.members) {
        const hazard = this.promiseResolutionHazard(member);
        if (hazard) return hazard;
      }
      return null;
    }
    if (expanded.kind === "object") {
      const then = expanded.fields.get("then");
      return then && this.callableThenMember(then) ? "its 'then' data field may be callable" : null;
    }
    if (expanded.kind === "named") {
      const identity = expanded.identity ?? expanded.name;
      const then = this.host.fieldsOf(identity)?.get("then");
      return then && this.callableThenMember(then) ? `type '${expanded.name}' exposes a callable 'then' data field` : null;
    }
    if (expanded.kind !== "class") return null;
    const identity = expanded.identity ?? expanded.name;
    if (this.host.findGetter(identity, "then") || this.host.findGetter(expanded.name, "then")) {
      return `class '${expanded.name}' exposes a 'then' getter that Promise resolution would execute`;
    }
    if (this.host.findMethod(identity, "then") || this.host.findMethod(expanded.name, "then")) {
      return `class '${expanded.name}' exposes a callable 'then' method`;
    }
    const field = this.host.findField(identity, "then") ?? this.host.findField(expanded.name, "then");
    return field && this.callableThenMember(field.type)
      ? `class '${expanded.name}' exposes a callable 'then' field`
      : null;
  }

  promiseResolutionNeedsRuntimeGuard(type: ValueType): boolean {
    if (isInvalidType(type)) return false;
    const expanded = this.host.resolveNamedClasses(this.host.expandAliases(type));
    if (expanded.kind === "optional") return this.promiseResolutionNeedsRuntimeGuard(expanded.inner);
    if (expanded.kind === "union") return expanded.members.some((member) => this.promiseResolutionNeedsRuntimeGuard(member));
    return expanded.kind !== "null"
      && expanded.kind !== "string"
      && expanded.kind !== "number"
      && expanded.kind !== "bool"
      && expanded.kind !== "enum"
      && expanded.kind !== "enumMember"
      && expanded.kind !== "promise";
  }

  reportPromiseResolutionHazard(type: ValueType, errorSpan: Span): void {
    const hazard = this.promiseResolutionHazard(type);
    if (!hazard) return;
    const key = spanIdentity(errorSpan);
    if (this.host.reportedPromiseResolutionHazards.has(key)) return;
    this.host.reportedPromiseResolutionHazards.add(key);
    this.host.diagnostics.push(diagnostic(
      "VEL4024",
      `A Promise cannot resolve to ${describeType(type)} because ${hazard}; JavaScript would treat the value as a magic thenable. Rename 'then' or keep this value outside an async result`,
      errorSpan,
    ));
  }

  reportPromiseCarrierHazard(type: ValueType, errorSpan: Span): void {
    const expanded = this.host.expandAliases(type);
    if (expanded.kind === "promise") this.reportPromiseResolutionHazard(expanded.value, errorSpan);
    else if (expanded.kind === "optional") this.reportPromiseCarrierHazard(expanded.inner, errorSpan);
    else if (expanded.kind === "union") {
      for (const member of expanded.members) this.reportPromiseCarrierHazard(member, errorSpan);
    }
  }
}
