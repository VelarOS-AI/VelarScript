/** Anonymous record checks own reusable functions, just as declared records do. */
import type { ValueType } from "../types.ts";

type ObjectType = Extract<ValueType, {kind: "object"}>;
export interface StructuralCheckHost {
  readonly typeCheckDeclarations: string[];
}

export class StructuralCheckEmitter {
  private readonly plans = new Map<ObjectType, Map<string, string>>();
  private nextPlan = 0;
  private readonly traversal = new Map<ValueType, boolean>();
  private readonly host: StructuralCheckHost;
  constructor(host: StructuralCheckHost) { this.host = host; }

  emit(
    type: ObjectType,
    value: string,
    state: string,
    narrow: boolean,
    generic: boolean,
    check: (field: ValueType, value: string, state: string) => string,
  ): string {
    const key = `${narrow}:${generic}`;
    let modes = this.plans.get(type);
    if (!modes) { modes = new Map(); this.plans.set(type, modes); }
    let name = modes.get(key);
    if (name === undefined) {
      name = `__velarStructuralCheck${this.nextPlan++}`;
      // Publish the plan before visiting fields: a recursive type refers back
      // to this function instead of weakening its evidence or growing source.
      modes.set(key, name);
      const descriptors: string[] = [];
      const proofs: string[] = [];
      for (const [field, type_] of type.fields) {
        const descriptor = `__field${descriptors.length}`;
        descriptors.push(`  const ${descriptor} = __velarValidationOwnDescriptor(value, ${JSON.stringify(field)});`);
        const proof = `${descriptor}?.enumerable && "value" in ${descriptor} && (${check(type_, `${descriptor}.value`, "__state")})`;
        const optional = type_.kind === "optional" || type.optionalFields?.has(field);
        proofs.push(optional ? `(${descriptor} === undefined || (${proof}))` : `(${proof})`);
      }
      this.host.typeCheckDeclarations.push([
        `function ${name}(value, __state, __velarArguments) {`,
        ...descriptors,
        `  return !!(${proofs.join(" && ") || "true"});`,
        "}",
      ].join("\n"));
    }
    const arguments_ = generic ? "__velarArguments" : "undefined";
    return this.needsTraversal(type)
      ? `__velarObjectTypeIs(${value}, ${name}, ${state}${generic ? ", __velarArguments" : ""})`
      : `__velarObjectTypeIs(${value}, ${name}, ${state}, ${arguments_}, false)`;
  }

  /** Finite closed shapes need no graph memo; recursive or parameterized edges do. */
  private needsTraversal(type: ValueType, active = new Set<ValueType>()): boolean {
    const cached = this.traversal.get(type);
    if (cached !== undefined) return cached;
    if (active.has(type)) return true;
    active.add(type);
    let guarded = false;
    try {
      switch (type.kind) {
        case "object": guarded = [...type.fields.values()].some((field) => this.needsTraversal(field, active)); break;
        case "optional": guarded = this.needsTraversal(type.inner, active); break;
        case "list":
        case "set": guarded = this.needsTraversal(type.element, active); break;
        case "map": guarded = this.needsTraversal(type.key, active) || this.needsTraversal(type.value, active); break;
        case "record": guarded = this.needsTraversal(type.value, active); break;
        case "union": guarded = type.members.some((member) => this.needsTraversal(member, active)); break;
        case "named":
        case "parameter": guarded = true; break;
        default: break;
      }
    } finally { active.delete(type); }
    this.traversal.set(type, guarded);
    return guarded;
  }

}
