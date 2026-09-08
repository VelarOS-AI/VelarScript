/** Inspection is legal, but often the author meant the eventual value. */
import type { Span } from "../../source.ts";
import type { ValueType } from "../../types.ts";
import type { Expression } from "../../ast.ts";
import type { Binding } from "../scopes.ts";

export type PromiseInspectionSite = "print" | "str";

/** Function types are not value identity: a mutable cell can change callees. */
export class PromiseInspectionAliases {
  private readonly aliases = new WeakMap<Binding, PromiseInspectionSite>();
  private readonly lookup: (name: string) => Binding | null;

  constructor(lookup: (name: string) => Binding | null) { this.lookup = lookup; }

  site(expression: Expression): PromiseInspectionSite | null {
    if (expression.kind !== "IdentifierExpression") return null;
    const binding = this.lookup(expression.name);
    if (binding) return this.aliases.get(binding.storageBinding ?? binding) ?? null;
    return expression.name === "print" || expression.name === "str" ? expression.name : null;
  }

  bind(binding: Binding, site: PromiseInspectionSite | null): void {
    if (!binding.mutable && site !== null) this.aliases.set(binding, site);
  }
}

export interface PromiseInspectionHost {
  expandAliases(type: ValueType): ValueType;
  advise(code: string, message: string, span: Span): void;
}

export function advisePromiseInspection(
  host: PromiseInspectionHost,
  type: ValueType,
  span: Span,
  site: "print" | "str" | "f-string",
): void {
  let remaining = 256;
  const containsPromise = (source: ValueType): boolean => {
    if (--remaining < 0) return false;
    if (source.kind === "promise") return true;
    if (source.kind === "optional") return containsPromise(source.inner);
    if (source.kind === "union") return source.members.some(containsPromise);
    if (source.kind !== "named") return false;
    const expanded = host.expandAliases(source);
    return expanded !== source && containsPromise(expanded);
  };
  if (!containsPromise(type)) return;
  host.advise("A19", `${site === "f-string" ? "This f-string receives" : `${site}() receives`} a Promise, not its resolved value; await the operation before using its result. If inspecting the Promise itself is intentional, explain that with 'velar-allow A19'`, span);
}
