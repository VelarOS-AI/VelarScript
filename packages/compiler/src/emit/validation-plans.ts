/** Diagnostic plans preserve source bindings and recursive graph identity. */
import { describeType, mapNestedTypes, type ValueType } from "../types.ts";

export interface ValidationPlanHost {
  emitTypeCheck(type: ValueType, value: string, state?: string): string;
  runtimeTypeObjectExpression(type: ValueType): string | null;
}

// Display has a separate budget from proof: cutting text must never cut a
// validation edge. The finite projection also lets describeType name recursive
// structural graphs without recursing forever in its ordinary tree formatter.
function planDisplay(type: ValueType): string {
  const active = new Set<ValueType>();
  let remaining = 128;
  const project = (value: ValueType, depth: number): ValueType => {
    if (--remaining < 0 || depth >= 32 || active.has(value)) return {kind: "named", name: "…"};
    active.add(value);
    try { return mapNestedTypes(value, (nested) => project(nested, depth + 1)); }
    finally { active.delete(value); }
  };
  return describeType(project(type, 0)).slice(0, 4096);
}

export function validationPlanExpression(host: ValidationPlanHost, type: ValueType): string {
  const names = new Map<ValueType, string>();
  const declarations: string[] = [];
  const visit = (value: ValueType): string => {
    if (value.kind === "parameter") return `__velarArguments.diagnostics[${value.index}]`;
    let name = names.get(value);
    if (name === undefined) {
      name = `__velarDiagnosticPlan${names.size}`;
      names.set(value, name);
      const body = describe(value);
      declarations.push(`function ${name}() { return ${body}; }`);
    }
    return `{kind: "lazy", target: ${name}}`;
  };
  const describe = (value: ValueType): string => {
    const name = JSON.stringify(planDisplay(value));
    const check = () => host.emitTypeCheck(value, "value", "__velarValidationState()");
    if (value.kind === "named" && !check().startsWith("__velarValidationIsInstance(")) {
      const target = host.runtimeTypeObjectExpression(value);
      if (target) return `{kind: "reference", target: () => ${target}, name: ${name}}`;
    }
    if (value.kind === "optional") return `{kind: "optional", inner: ${visit(value.inner)}, name: ${name}}`;
    if (value.kind === "list" || value.kind === "set") return `{kind: ${JSON.stringify(value.kind)}, element: ${visit(value.element)}, name: ${name}}`;
    if (value.kind === "map") return `{kind: "map", key: ${visit(value.key)}, element: ${visit(value.value)}, name: ${name}}`;
    if (value.kind === "record") return `{kind: "record", element: ${visit(value.value)}, name: ${name}}`;
    if (value.kind === "union") return `{kind: "union", members: [${value.members.map(visit).join(", ")}], name: ${name}}`;
    if (value.kind === "object") return `{kind: "object", fields: [${[...value.fields].map(([field, nested]) => `{name: ${JSON.stringify(field)}, optional: ${nested.kind === "optional" || !!value.optionalFields?.has(field)}, plan: ${visit(nested)}}`).join(", ")}], name: ${name}}`;
    return `{kind: "leaf", name: ${name}, discriminant: ${value.kind === "enumMember"}, check: (value) => ${check()}}`;
  };
  const result = visit(type);
  return declarations.length === 0 ? result : `(() => { ${declarations.join(" ")} return ${result}; })()`;
}
