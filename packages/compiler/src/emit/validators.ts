/**
 * Runtime `Type` declaration emission: the validator and the copier a record,
 * alias or enum declaration compiles to, and the copy plans a nested record
 * shares between them.
 */
import type {
  EnumDeclaration,
  Program,
  TypeAliasDeclaration,
  TypeDeclaration,
  TypeSyntax,
  TypeReference,
} from "../ast.ts";
import { resolveTypeReference, type GenericApplication, type ValueType } from "../types.ts";
import { type LoweringHints } from "../contracts.ts";
import { copyPlanSelfReference } from "./javascript.ts";

export interface TypeValidatorEmitterHost {
  readonly copyPlanDeclarations: string[];
  copyPlanProbe: boolean;
  readonly copyPlans: Map<string, string>;
  emitTypeCheck(type: ValueType, value: string, state?: string): string;
  enumAliasTarget(name: string, seen?: readonly string[]): string | null;
  readonly expandedRuntimeTypes: Set<string>;
  readonly externModuleExports: Map<string, ReadonlySet<string>>;
  genericCopyPlanNames: Map<string, string> | null;
  genericCopyPlans: string[] | null;
  genericInstanceExpression(application: GenericApplication): string;
  genericTypeBinding(name: string): boolean;
  genericTypeParameters: readonly string[] | null;
  readonly hints: LoweringHints;
  needsRuntimeTypeHelpers: boolean;
  pendingGenericCopyPlans: readonly string[];
  resolveDeclarationType(reference: TypeReference): ValueType;
  runtimeTypeBinding(name: string): boolean;
  runtimeTypeCheckName(name: string): string;
  runtimeTypeNeedsTraversalGuard(name: string): boolean;
  runtimeTypeObjectExpression(type: ValueType): string | null;
  readonly runtimeTypes: Set<string>;
  readonly typeDeclarations: Map<string, TypeDeclaration | TypeAliasDeclaration>;
  typeTextExpression(type: ValueType, syntax: TypeSyntax | null): string;
}

/**
 * Everything one record declaration's emission has already decided by the time
 * its three parts — the explain companion, the Type object, and the generic
 * instantiation — are written. It is one object so those three read the same
 * decisions rather than recomputing any of them.
 */
interface RecordTypeEmission {
  readonly statement: TypeDeclaration;
  readonly fields: readonly {
    readonly name: string;
    readonly descriptor: string;
    readonly type: ValueType;
    readonly syntax: TypeSyntax;
  }[];
  readonly indentation: string;
  readonly generic: readonly string[] | null;
  readonly guarded: boolean;
  readonly checkName: string;
  readonly copyName: string;
  readonly explainName: string;
  readonly exportPrefix: string;
  readonly argumentsParameter: string;
  readonly ownCopyPlan: string;
  readonly displayName: string;
  readonly predicate: string;
  readonly baseExpression: string | null;
  readonly pathText: (suffix: string) => string;
}

export class TypeValidatorEmitter {
  private readonly host: TypeValidatorEmitterHost;

  constructor(host: TypeValidatorEmitterHost) {
    this.host = host;
  }

  collectDeclarations(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration") {
        this.host.typeDeclarations.set(statement.name, statement);
        if (statement.exported) {
          this.host.runtimeTypes.add(statement.name);
        }
      } else if (statement.kind === "ExternModuleDeclaration") {
        const names = new Set(this.host.externModuleExports.get(statement.source));
        for (const declaration of statement.functions) names.add(declaration.name);
        for (const declaration of statement.constants) names.add(declaration.name);
        for (const declaration of statement.classes) names.add(declaration.name);
        this.host.externModuleExports.set(statement.source, names);
      }
    }
    for (const name of [...this.host.runtimeTypes]) {
      this.markRuntimeType({ kind: "named", name });
    }
  }

  markRuntimeType(type: ValueType): void {
    this.host.needsRuntimeTypeHelpers = true;
    const structural = new Set<ValueType>();
    const visit = (value: ValueType): void => {
      // D55 rule 121: `Box<string>` needs `Box`'s factory emitted and every
      // argument's own runtime types marked; the application's display name is
      // not a declaration, so the walk asks the application which one it is.
      if (value.kind === "named" && value.application) {
        for (const argument of value.application.arguments) visit(argument);
        visit({ kind: "named", name: value.application.name });
        return;
      }
      if (value.kind === "named" && this.host.typeDeclarations.has(value.name) && !this.host.runtimeTypes.has(value.name)) {
        this.host.runtimeTypes.add(value.name);
      }
      if (value.kind === "named" && this.host.typeDeclarations.has(value.name) && !this.host.expandedRuntimeTypes.has(value.name)) {
        this.host.expandedRuntimeTypes.add(value.name);
        const declaration = this.host.typeDeclarations.get(value.name)!;
        if (declaration.kind === "TypeDeclaration") {
          // A field written in this module must retain the local spelling that
          // owns its runtime Type binding. The analyzer's complete structural
          // table expands aliases for static work; walking that expansion here
          // can lose the only imported/local validator name before emission.
          // A derived record retains the direct base spelling for the same
          // reason. Marking that base recursively makes its module own every
          // inherited field dependency instead of asking the child to recreate
          // validators for names that are not in the child's scope.
          if (declaration.base) visit(resolveTypeReference(declaration.base));
          declaration.fields.forEach((field) => visit(resolveTypeReference(field.type)));
        } else {
          visit(resolveTypeReference(declaration.target));
        }
      } else if (value.kind === "optional") {
        visit(value.inner);
      } else if (value.kind === "list") {
        visit(value.element);
      } else if (value.kind === "set") {
        visit(value.element);
      } else if (value.kind === "map") {
        visit(value.key);
        visit(value.value);
      } else if (value.kind === "record") {
        visit(value.value);
      } else if (value.kind === "promise") {
        visit(value.value);
      } else if (value.kind === "union") {
        value.members.forEach(visit);
      } else if (value.kind === "object") {
        // A structural field is proved inline, so whatever its own check needs
        // — a collection's `TypeIs` helper, a declared record's validator — is
        // this module's dependency exactly as a named field's would be.
        if (structural.has(value)) return;
        structural.add(value);
        value.fields.forEach(visit);
        structural.delete(value);
      }
    };
    visit(type);
  }

  markRuntimeNarrowingType(type: ValueType, structural: Set<ValueType> = new Set()): void {
    if (type.kind === "optional") {
      this.markRuntimeNarrowingType(type.inner, structural);
      return;
    }
    if (type.kind === "union") {
      for (const member of type.members) this.markRuntimeNarrowingType(member, structural);
      return;
    }
    // A structural object's recheck spells its field table inline, so every
    // field's own evidence is emitted into this module and its helpers must be
    // required here. The expansion the emitter bounds is the *expression*; the
    // dependency walk only has to terminate, so one visit per object suffices.
    if (type.kind === "object") {
      if (structural.has(type)) return;
      structural.add(type);
      for (const field of type.fields.values()) this.markRuntimeNarrowingType(field, structural);
      structural.delete(type);
      return;
    }
    if (type.kind === "list" || type.kind === "set" || type.kind === "map" || type.kind === "record"
      || type.kind === "promise" || type.kind === "named" || type.kind === "class") {
      this.markRuntimeType(type);
    }
  }

  emitTypeDeclaration(statement: TypeDeclaration, depth: number): string {
    const parameters = statement.typeParameters?.map((parameter) => parameter.name) ?? null;
    if (!parameters) return this.emitRecordTypeDeclaration(statement, depth);
    this.host.genericTypeParameters = parameters;
    try {
      return this.emitRecordTypeDeclaration(statement, depth);
    } finally {
      this.host.genericTypeParameters = null;
    }
  }


  private emitRecordTypeDeclaration(statement: TypeDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const generic = this.host.genericTypeParameters;
    const guarded = this.host.runtimeTypeNeedsTraversalGuard(statement.name);
    const checkName = this.host.runtimeTypeCheckName(statement.name);
    const baseType = statement.base ? this.host.resolveDeclarationType(statement.base) : null;
    const baseExpression = baseType ? this.host.runtimeTypeObjectExpression(baseType) : null;
    const fields = statement.fields.map((field, index) => ({
      name: field.name,
      descriptor: `__velarField${index}`,
      // Runtime validation follows source-visible bindings. Structural field
      // tables stay analyzer-owned, but an imported alias may be the only Type
      // object this module can legally name in emitted JavaScript.
      type: this.host.resolveDeclarationType(field.type),
      syntax: field.type.syntax,
    }));
    // D90 rule R5: the predicate stays the charter's "present own enumerable
    // data properties" and deliberately does not demand `writable` and
    // `configurable` the way `__velarRecordFields` does. Since parse now
    // returns a copy whose every field is an ordinary mutable data property, a
    // frozen source can no longer make a later write to the validated record
    // fail — so refusing frozen host configuration would cost expressiveness
    // and buy nothing.
    const checks = fields.map(({ descriptor, type }) => {
      const present = `${descriptor}?.enumerable && "value" in ${descriptor} && ${this.host.emitTypeCheck(type, `${descriptor}.value`, guarded ? "__state" : "undefined")}`;
      return type.kind === "optional" ? `(${descriptor} === undefined || (${present}))` : present;
    });
    // A base validates the fields it owns using the bindings available in its
    // declaring module. Delegating the whole inherited prefix is what carries
    // cross-package runtime dependencies through any number of derived modules.
    const predicateParts = [
      ...(baseType ? [this.host.emitTypeCheck(baseType, "value", guarded ? "__state" : "undefined")] : []),
      ...checks,
    ];
    const predicate = predicateParts.length > 0 ? predicateParts.join(" && ") : "true";
    const exportPrefix = statement.exported ? "export " : "";
    // COL-U5: parse failures name the failing field. The explain companion
    // re-runs the per-field checks only on the failure path, so is() and the
    // success path stay exactly as cheap as before.
    const explainName = `__velarTypeExplain_${statement.name}`;
    // D55 rule 121: a generic record's validator is the same validator with the
    // erased positions supplied from outside — the arguments carry a predicate,
    // a display text, and a key per type argument, so `parse` still names the
    // type the author wrote and the memo still answers with one Type object per
    // instantiation.
    const argumentsParameter = generic ? ", __velarArguments" : "";
    const copyName = this.runtimeTypeCopyName(statement.name);
    // The copy plan this declaration files its own copies under. It has to be
    // the same value at every visit within one parse and a different value for
    // every other declared shape: the copy function itself is that for a plain
    // record, and the arguments object is that for an instantiation, exactly as
    // the traversal guard already reads them.
    const ownCopyPlan = generic ? "__velarArguments" : copyName;
    const displayName = generic ? "__velarArguments.name" : JSON.stringify(statement.name);
    const pathText = (suffix: string): string => generic
      ? (suffix === "" ? displayName : `${displayName} + ${JSON.stringify(suffix)}`)
      : JSON.stringify(`${statement.name}${suffix}`);
    const context: RecordTypeEmission = {
      statement, fields, indentation, generic, guarded, checkName, copyName, explainName,
      exportPrefix, argumentsParameter, ownCopyPlan, displayName, predicate, baseExpression, pathText,
    };
    const explainLines = this.recordExplainLines(context);
    const typeObject = this.recordTypeObjectLines(context);
    if (generic) return this.emitGenericRecordType(context, explainLines, typeObject);
    return [
      ...explainLines,
      ...this.recordCheckFunctionLines(fields, predicate, checkName, indentation, "", guarded),
      "",
      ...this.recordCopyFunctionLines(fields, copyName, baseExpression, indentation, ""),
      "",
      `${indentation}${exportPrefix}const ${statement.name} = __velarRegisterRuntimeType(__velarValidationFreeze({`,
      ...typeObject,
      `${indentation}}));`,
    ].join("\n");
  }

  /**
   * The `__velarTypeExplain_*` companion a record carries: the one place that
   * turns a failed check into the path, field and reason a validation error
   * reports. COL-U5 runs it only on the failure path, so `is()` and the
   * success path stay exactly as cheap as before.
   */
  private recordExplainLines(context: RecordTypeEmission): readonly string[] {
    const { statement, fields, indentation, generic, guarded, checkName, copyName, explainName,
      exportPrefix, argumentsParameter, ownCopyPlan, displayName, predicate, baseExpression, pathText } = context;
    return [
      `${indentation}function ${explainName}(value${argumentsParameter}) {`,
      `${indentation}  if (value === null || typeof value !== "object" || __velarValidationIsArray(value) || !__velarValidationIsPlainObject(value)) {`,
      `${indentation}    return { path: ${pathText("")}, field: null, reason: "the value is not a record" };`,
      `${indentation}  }`,
      ...(baseExpression ? [
        // parse() is used only on this already-failing explanation path. It
        // preserves the base module's own field reason, then rebases the public
        // path onto the derived type so callers still see the type they parsed.
        `${indentation}  try {`,
        `${indentation}    ${baseExpression}.parse(value);`,
        `${indentation}  } catch (__velarBaseFailure) {`,
        `${indentation}    if (!__velarValidationIsInstance(__velarBaseFailure, __VelarValidationError)) throw __velarBaseFailure;`,
        `${indentation}    const __velarBaseField = __velarBaseFailure.field;`,
        `${indentation}    return { path: __velarBaseField === null ? ${pathText("")} : ${pathText("")} + "." + __velarBaseField, field: __velarBaseField, reason: __velarBaseFailure.reason };`,
        `${indentation}  }`,
      ] : []),
      ...fields.flatMap(({ name, type, syntax }) => {
        const descriptor = "__velarExplainField";
        const typeText = this.host.typeTextExpression(type, syntax);
        const lines = [
          `${indentation}  {`,
          `${indentation}    const ${descriptor} = __velarValidationOwnDescriptor(value, ${JSON.stringify(name)});`,
        ];
        if (type.kind === "optional") {
          lines.push(`${indentation}    if (${descriptor} !== undefined && !(${descriptor}.enumerable && "value" in ${descriptor} && ${this.host.emitTypeCheck(type, `${descriptor}.value`, "__velarValidationState()")})) {`);
        } else {
          lines.push(`${indentation}    if (${descriptor} === undefined) {`);
          lines.push(`${indentation}      return { path: ${pathText(`.${name}`)}, field: ${JSON.stringify(name)}, reason: ${JSON.stringify(`field '${name}' is missing`)} };`);
          lines.push(`${indentation}    }`);
          lines.push(`${indentation}    if (!(${descriptor}.enumerable && "value" in ${descriptor} && ${this.host.emitTypeCheck(type, `${descriptor}.value`, "__velarValidationState()")})) {`);
        }
        lines.push(`${indentation}      return { path: ${pathText(`.${name}`)}, field: ${JSON.stringify(name)}, reason: ${JSON.stringify(`field '${name}' does not match `)} + ${typeText} };`);
        lines.push(`${indentation}    }`);
        lines.push(`${indentation}  }`);
        return lines;
      }),
      `${indentation}  return { path: ${pathText("")}, field: null, reason: null };`,
      `${indentation}}`,
      "",
    ];
  }

  /**
   * The Type object itself: `is`, `parse` and `copy`, plus the metadata the
   * registry and a validation error read off it.
   */
  private recordTypeObjectLines(context: RecordTypeEmission): readonly string[] {
    const { statement, fields, indentation, generic, guarded, checkName, copyName, explainName,
      exportPrefix, argumentsParameter, ownCopyPlan, displayName, predicate, baseExpression, pathText } = context;
    return [
      guarded ? `${indentation}  is(value, __state) {` : `${indentation}  is(value) {`,
      guarded
        ? `${indentation}    return ${checkName}(value, __state${generic ? ", __velarArguments" : ""});`
        : `${indentation}    return ${checkName}(value${generic ? ", __velarArguments" : ""});`,
      `${indentation}  },`,
      `${indentation}  parse(value) {`,
      guarded
        ? `${indentation}    if (!${checkName}(value, __velarValidationState()${generic ? ", __velarArguments" : ""})) {`
        : `${indentation}    if (!${checkName}(value${generic ? ", __velarArguments" : ""})) {`,
      `${indentation}      const __velarDetail = ${explainName}(value${generic ? ", __velarArguments" : ""});`,
      `${indentation}      throw new __VelarValidationError(${generic ? `"Value does not match " + ${displayName}` : JSON.stringify(`Value does not match ${statement.name}`)} + (__velarDetail.reason ? " — " + __velarDetail.reason : "") + __velarValidationRejectionHint(value), __velarDetail);`,
      `${indentation}    }`,
      // D90 rule R5: parse hands back a fresh value built from the validated
      // shape, so a later write through the argument cannot falsify a field
      // the caller was handed, and a value reached through a readonly view
      // does not widen by passing through parse. The copy memo is keyed by
      // source object and plan, and this type's own plan is the identity that
      // is one per declaration — its arguments for an instantiation, since two
      // instantiations of one generic are two different declared shapes.
      `${indentation}    return ${copyName}(value, __velarValidationState(), ${ownCopyPlan}${generic ? ", __velarArguments" : ""});`,
      `${indentation}  },`,
      // A derived type calls this with the plan it is itself copying under, so
      // the inherited prefix lands on the derived copy instead of on a base
      // copy another position in the same parse may already be holding.
      `${indentation}  copy(value, __state = __velarValidationState(), __velarCopyPlan = ${ownCopyPlan}) {`,
      `${indentation}    return ${copyName}(value, __state, __velarCopyPlan${generic ? ", __velarArguments" : ""});`,
      `${indentation}  },`,
    ];
  }

  /**
   * A generic record's emission (D55 rule 121). Its checker, copier and copy
   * plan are built per instantiation rather than once, because each reads the
   * arguments the instantiation was applied to.
   */
  private emitGenericRecordType(context: RecordTypeEmission, explainLines: readonly string[], typeObject: readonly string[]): string {
    const { statement, fields, indentation, generic, guarded, checkName, copyName, explainName,
      exportPrefix, argumentsParameter, ownCopyPlan, displayName, predicate, baseExpression, pathText } = context;
    const instances = `__velarGenericInstances_${statement.name}`;
    const copyLines = this.recordCopyFunctionLines(fields, copyName, baseExpression, indentation, argumentsParameter);
    // A plan that reads the instantiation's arguments cannot hoist to module
    // level and must not be shared between instantiations, so it is built
    // once here, beside the arguments object it belongs to and reads.
    const plans = this.host.pendingGenericCopyPlans;
    return [
      ...explainLines,
      ...this.recordCheckFunctionLines(fields, predicate, checkName, indentation, argumentsParameter, guarded),
      "",
      ...copyLines,
      "",
      `${indentation}const ${instances} = [];`,
      // The instantiation memo: one frozen Type object per set of arguments,
      // found by a key the emitter builds from the arguments' own identities.
      // It is what makes `type Tree<T>: kids: List<Tree<T>>` terminate — the
      // body's reference to its own instantiation is a lookup, not a rebuild.
      `${indentation}${exportPrefix}const ${statement.name} = __velarValidationFreeze({`,
      `${indentation}  of(__velarKeys, __velarTexts, __velarChecks) {`,
      `${indentation}    let __velarKey = ${JSON.stringify(statement.name)};`,
      `${indentation}    for (let __velarIndex = 0; __velarIndex < __velarKeys.length; __velarIndex += 1) __velarKey += "\\u0000" + __velarKeys[__velarIndex];`,
      `${indentation}    for (let __velarIndex = 0; __velarIndex < ${instances}.length; __velarIndex += 1) {`,
      `${indentation}      if (${instances}[__velarIndex].key === __velarKey) return ${instances}[__velarIndex].type;`,
      `${indentation}    }`,
      `${indentation}    let __velarName = ${JSON.stringify(`${statement.name}<`)};`,
      `${indentation}    for (let __velarIndex = 0; __velarIndex < __velarTexts.length; __velarIndex += 1) __velarName += (__velarIndex === 0 ? "" : ", ") + __velarTexts[__velarIndex];`,
      `${indentation}    __velarName += ">";`,
      `${indentation}    const __velarArguments = { keys: __velarKeys, texts: __velarTexts, checks: __velarChecks, name: __velarName };`,
      ...(plans.length > 0 ? [
        `${indentation}    __velarArguments.plans = [`,
        ...plans.map((plan) => `${indentation}      ${plan},`),
        `${indentation}    ];`,
      ] : []),
      `${indentation}    const __velarType = __velarRegisterRuntimeType(__velarValidationFreeze({`,
      ...typeObject.map((line) => `${indentation}  ${line}`),
      `${indentation}    }));`,
      `${indentation}    ${instances}[${instances}.length] = { key: __velarKey, type: __velarType };`,
      `${indentation}    return __velarType;`,
      `${indentation}  },`,
      `${indentation}});`,
    ].join("\n");
  }

  /** The record predicate itself: identical for a plain record and a generic one but for the arguments it carries. */
  private recordCheckFunctionLines(
    fields: readonly { readonly name: string; readonly descriptor: string }[],
    predicate: string,
    checkName: string,
    indentation: string,
    argumentsParameter: string,
    guarded: boolean,
  ): readonly string[] {
    if (!guarded) {
      return [
        `${indentation}function ${checkName}(value${argumentsParameter}) {`,
        `${indentation}  if (value === null || typeof value !== "object" || __velarValidationIsArray(value) || !__velarValidationIsPlainObject(value)) return false;`,
        ...fields.map(({ name, descriptor }) => `${indentation}  const ${descriptor} = __velarValidationOwnDescriptor(value, ${JSON.stringify(name)});`),
        `${indentation}  return !!(${predicate});`,
        `${indentation}}`,
      ];
    }
    // The per-value cycle guard is keyed by the *instantiation*, not by the
    // function: `Tree<string>` and `Tree<number>` share one predicate, and a
    // value reached under both in one traversal is two questions, not one.
    const guard = argumentsParameter ? "__velarArguments" : checkName;
    return [
      `${indentation}function ${checkName}(value, __state = __velarValidationState()${argumentsParameter}) {`,
      // D44 rule 70: a record contract accepts only plain data objects, so a
      // class instance can never satisfy it — otherwise the validated record
      // view would alias the live instance and write through its const fields.
      `${indentation}  if (value === null || typeof value !== "object" || __velarValidationIsArray(value) || !__velarValidationIsPlainObject(value) || __state.depth >= 1000) return false;`,
      `${indentation}  let __active = __velarValidationWeakMapGet(__state.active, value);`,
      `${indentation}  if (__active && __velarValidationSetHas(__active, ${guard})) return false;`,
      `${indentation}  if (!__active) {`,
      `${indentation}    __active = __velarValidationSet();`,
      `${indentation}    __velarValidationWeakMapSet(__state.active, value, __active);`,
      `${indentation}  }`,
      `${indentation}  __velarValidationSetAdd(__active, ${guard});`,
      `${indentation}  __state.depth += 1;`,
      `${indentation}  try {`,
      ...fields.map(({ name, descriptor }) => `${indentation}    const ${descriptor} = __velarValidationOwnDescriptor(value, ${JSON.stringify(name)});`),
      `${indentation}    return !!(${predicate});`,
      `${indentation}  } finally {`,
      `${indentation}    __state.depth -= 1;`,
      `${indentation}    __velarValidationSetDelete(__active, ${guard});`,
      `${indentation}    if (__velarValidationSetSize(__active) === 0) __velarValidationWeakMapDelete(__state.active, value);`,
      `${indentation}  }`,
      `${indentation}}`,
    ];
  }

  private runtimeTypeCopyName(name: string): string {
    return `__velarTypeCopy_${name}`;
  }

  /**
   * D90 rule R5: the record's copy — one fresh object per source object *and*
   * declared type, with every declared field rebuilt. The plan the caller is
   * copying under is threaded in and passed on to the base, so a value reached
   * once as `Base` and once as `Derived` in the same parse is two copies, each
   * complete for its own type, rather than the base's copy with the derived
   * fields written over it. Within one plan a base still builds the object and
   * records it, and the derived fields land on that same copy, so one source
   * object still maps to exactly one copy however deep the chain is.
   */
  private recordCopyFunctionLines(
    fields: readonly { readonly name: string; readonly type: ValueType }[],
    copyName: string,
    baseExpression: string | null,
    indentation: string,
    argumentsParameter: string,
  ): readonly string[] {
    const fresh = baseExpression
      ? `${baseExpression}.copy(value, __state, __velarCopyPlan)`
      : `__state.copy.object(__state, value, __velarCopyPlan)`;
    const previousPlans = this.host.genericCopyPlans;
    const previousNames = this.host.genericCopyPlanNames;
    this.host.genericCopyPlans = argumentsParameter ? [] : null;
    this.host.genericCopyPlanNames = argumentsParameter ? new Map() : null;
    const fieldLines = fields.flatMap(({ name, type }) => {
      const descriptor = "__velarCopyField";
      const copied = this.typeCopyExpression(type, `${descriptor}.value`, "__state");
      return [
        `${indentation}  {`,
        `${indentation}    const ${descriptor} = __velarValidationOwnDescriptor(value, ${JSON.stringify(name)});`,
        `${indentation}    if (${descriptor} !== undefined) __state.copy.field(__velarCopy, ${JSON.stringify(name)}, ${copied ?? `${descriptor}.value`});`,
        `${indentation}  }`,
      ];
    });
    this.host.pendingGenericCopyPlans = this.host.genericCopyPlans ?? [];
    this.host.genericCopyPlans = previousPlans;
    this.host.genericCopyPlanNames = previousNames;
    return [
      `${indentation}function ${copyName}(value, __state, __velarCopyPlan${argumentsParameter}) {`,
      `${indentation}  const __velarCopySeen = __state.copy.seen(__state, value, __velarCopyPlan);`,
      `${indentation}  if (__velarCopySeen !== undefined) return __velarCopySeen;`,
      `${indentation}  const __velarCopy = ${fresh};`,
      ...fieldLines,
      `${indentation}  return __velarCopy;`,
      `${indentation}}`,
    ];
  }

  /**
   * D90 rule R5: the module-level function that carries one copy plan, or null
   * when the position rebuilds nothing. Interning is by the plan's own emitted
   * text — which is what the plan means, module-locally — so two positions that
   * copy the same shape share one plan and one memo entry, and two that copy
   * different shapes can never be handed each other's copy.
   */
  private copyPlanName(type: ValueType): string | null {
    const body = this.copyPlanBody(type);
    if (body === null) return null;
    if (this.host.copyPlanProbe) return copyPlanSelfReference;
    const generic = this.host.genericCopyPlans;
    const genericNames = this.host.genericCopyPlanNames;
    if (generic !== null && genericNames !== null && body.includes("__velarArguments")) {
      const interned = genericNames.get(body);
      if (interned !== undefined) return interned;
      const name = `__velarArguments.plans[${generic.length}]`;
      genericNames.set(body, name);
      generic.push(`(__velarCopyItem, __velarCopyState) => ${body.replaceAll(copyPlanSelfReference, name)}`);
      return name;
    }
    const known = this.host.copyPlans.get(body);
    if (known !== undefined) return known;
    const name = `__velarCopyPlan${this.host.copyPlans.size}`;
    this.host.copyPlans.set(body, name);
    this.host.copyPlanDeclarations.push([
      `function ${name}(__velarCopyItem, __velarCopyState) {`,
      `  return ${body.replaceAll(copyPlanSelfReference, name)};`,
      "}",
    ].join("\n"));
    return name;
  }

  /**
   * One copy plan's body. A container names itself where its memo key goes,
   * because the copy it files is the one a later visit under the same plan must
   * find — including the visit that reaches it through its own elements.
   */
  private copyPlanBody(type: ValueType): string | null {
    switch (type.kind) {
      case "list":
        return `__velarCopyState.copy.listOf(__velarCopyItem, __velarCopyState, ${this.typeCopyCallback(type.element)}, ${copyPlanSelfReference})`;
      case "set":
        return `__velarCopyState.copy.setOf(__velarCopyItem, __velarCopyState, ${this.typeCopyCallback(type.element)}, ${copyPlanSelfReference})`;
      case "map":
        return `__velarCopyState.copy.mapOf(__velarCopyItem, __velarCopyState, ${this.typeCopyCallback(type.key)}, ${this.typeCopyCallback(type.value)}, ${copyPlanSelfReference})`;
      case "record":
        return `__velarCopyState.copy.recordOf(__velarCopyItem, __velarCopyState, ${this.typeCopyCallback(type.value)}, ${copyPlanSelfReference})`;
      default:
        return this.typeCopyExpression(type, "__velarCopyItem", "__velarCopyState");
    }
  }

  /** Whether a position rebuilds anything, asked without interning the plan it would need. */
  private typeCopiesAnything(type: ValueType): boolean {
    const previous = this.host.copyPlanProbe;
    this.host.copyPlanProbe = true;
    try {
      return this.typeCopyExpression(type, "__velarCopyItem", "__velarCopyState") !== null;
    } finally {
      this.host.copyPlanProbe = previous;
    }
  }

  /**
   * D90 rule R5: the expression that rebuilds one validated position, or null
   * when the position has nothing to copy — a primitive, an enum member, a
   * class instance, or an opaque `unknown`. The copy follows the declared
   * shape rather than the value, so an `unknown` field keeps handing back the
   * reference the author was given: copying an opaque value structurally would
   * change what parse returns.
   */
  private typeCopyExpression(type: ValueType, value: string, state: string): string | null {
    switch (type.kind) {
      case "unknown":
      case "any":
      case "null":
      case "string":
      case "number":
      case "bool":
      case "promise":
      case "class":
      case "enum":
      case "enumMember":
      case "function":
      case "action":
      case "intrinsic":
      case "typeObject":
      case "runtimeType":
      case "enumObject":
      case "classConstructor":
      case "extension":
        return null;
      case "optional": {
        const inner = this.typeCopyExpression(type.inner, value, state);
        return inner === null ? null : `(${value} == null ? ${value} : ${inner})`;
      }
      // A container copies through its own interned plan, because the plan is
      // the identity its memo files the copy under and a fresh closure at every
      // visit would be a different identity every time.
      case "list":
      case "set":
      case "map":
      case "record": {
        const plan = this.copyPlanName(type);
        return plan === null ? null : `${plan}(${value}, ${state})`;
      }
      case "named":
        // An instantiation's copy is the declaration's, reached through the
        // same memoized Type object its predicate is reached through.
        if (type.application && this.host.genericTypeBinding(type.application.name)) {
          this.host.needsRuntimeTypeHelpers = true;
          return `${this.host.genericInstanceExpression(type.application)}.copy(${value}, ${state})`;
        }
        // Duration is text, an enum member is text, and a class instance is
        // not plain data — none of them can or should be rebuilt.
        if (type.name === "Duration") return null;
        if (this.host.hints.enumNames.has(type.name)) return null;
        if (this.host.hints.classNames.has(type.name)) return null;
        if (this.host.enumAliasTarget(type.name) !== null) return null;
        if (this.host.typeDeclarations.has(type.name)) return `${type.name}.copy(${value}, ${state})`;
        return this.host.runtimeTypeBinding(type.name) ? `${state}.copy.through(${type.name}, ${value}, ${state})` : null;
      // A union, a structural object, and an erased type parameter are all
      // positions the predicate did not fully decide, so the copy is the
      // structural one: plain data recurses and anything else passes through.
      case "union":
        return type.members.every((member) => !this.typeCopiesAnything(member))
          ? null
          : `${state}.copy.plain(${value}, ${state})`;
      case "object":
      case "parameter":
        return `${state}.copy.plain(${value}, ${state})`;
    }
  }

  /** The per-element copy a container hands its runtime helper, or `null` when the element position has nothing to copy. */
  private typeCopyCallback(type: ValueType): string {
    return this.copyPlanName(type) ?? "null";
  }

  emitTypeAliasDeclaration(statement: TypeAliasDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    // ENM-I4: identities follow aliases, so an alias whose target resolves to
    // an enum IS that enum object at runtime — members, is, parse, and
    // values() all answer through the one frozen object.
    const enumTarget = this.host.enumAliasTarget(statement.name);
    if (enumTarget !== null) {
      return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = ${enumTarget};`;
    }
    // D55 rule 123 on ENM-I4's precedent: naming an instantiation is *the*
    // idiom that gives a generic record a runtime Type object, so the name IS
    // that instantiation's Type object rather than a wrapper around it. One
    // object per instantiation program-wide, and `parse` answers with the
    // record's own per-field explanation instead of a bare refusal.
    const target = resolveTypeReference(statement.target);
    if (target.kind === "named" && target.application && this.host.genericTypeBinding(target.application.name)) {
      this.host.needsRuntimeTypeHelpers = true;
      return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = ${this.host.genericInstanceExpression(target.application)};`;
    }
    const checkName = this.host.runtimeTypeCheckName(statement.name);
    const guarded = this.host.runtimeTypeNeedsTraversalGuard(statement.name);
    const predicate = this.host.emitTypeCheck(resolveTypeReference(statement.target), "value", guarded ? "__state" : "undefined");
    // D90 rule R5: an alias copies whatever its target copies. An alias of a
    // primitive has nothing to rebuild, so its parse still returns the same
    // value and allocates nothing. An alias of a declared record is that
    // record's copy, so it passes on the plan it was called under too — an
    // alias is a legal base, and the derived fields must not land on a copy
    // the aliased record filed under its own plan.
    const aliasTarget = resolveTypeReference(statement.target);
    const copied = this.typeCopyExpression(aliasTarget, "value", "__state");
    const forwarded = copied !== null && aliasTarget.kind === "named" && this.host.typeDeclarations.has(aliasTarget.name)
      ? `${aliasTarget.name}.copy(value, __state, __velarCopyPlan)`
      : copied;
    const exportPrefix = statement.exported ? "export " : "";
    return [
      guarded
        ? `${indentation}function ${checkName}(value, __state = __velarValidationState()) {`
        : `${indentation}function ${checkName}(value) {`,
      `${indentation}  return ${predicate};`,
      `${indentation}}`,
      "",
      `${indentation}${exportPrefix}const ${statement.name} = __velarRegisterRuntimeType(__velarValidationFreeze({`,
      guarded ? `${indentation}  is(value, __state) {` : `${indentation}  is(value) {`,
      guarded
        ? `${indentation}    return ${checkName}(value, __state);`
        : `${indentation}    return ${checkName}(value);`,
      `${indentation}  },`,
      `${indentation}  parse(value) {`,
      `${indentation}    if (!${checkName}(value)) {`,
      `${indentation}      throw new __VelarValidationError(${JSON.stringify(`Value does not match ${statement.name}`)}, { path: ${JSON.stringify(statement.name)} });`,
      `${indentation}    }`,
      `${indentation}    return ${copied === null ? "value" : `${statement.name}.copy(value)`};`,
      `${indentation}  },`,
      ...(copied === null
        ? [`${indentation}  copy(value) {`, `${indentation}    return value;`, `${indentation}  },`]
        : [`${indentation}  copy(value, __state = __velarValidationState(), __velarCopyPlan) {`, `${indentation}    return ${forwarded};`, `${indentation}  },`]),
      `${indentation}}));`,
    ].join("\n");
  }

  emitEnumDeclaration(statement: EnumDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const values = statement.members.map((member) => JSON.stringify(member.value));
    const members = statement.members.map((member) => `${indentation}  ${member.name}: ${JSON.stringify(member.value)},`);
    const predicate = values.length === 1
      ? `value === ${values[0]}`
      : values.map((value) => `value === ${value}`).join(" || ");
    return [
      `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarRegisterRuntimeType(__velarValidationFreeze({`,
      ...members,
      `${indentation}  is(value) {`,
      `${indentation}    return ${predicate};`,
      `${indentation}  },`,
      `${indentation}  parse(value) {`,
      `${indentation}    if (!${statement.name}.is(value)) {`,
      `${indentation}      throw new __VelarValidationError(${JSON.stringify(`Value does not match ${statement.name}`)}, { path: ${JSON.stringify(statement.name)} });`,
      `${indentation}    }`,
      `${indentation}    return value;`,
      `${indentation}  },`,
      // D90 rule R5: every runtime Type object answers `copy`, so a record
      // field typed by an imported enum reaches the same ABI a record does. An
      // enum member is text, so the copy is the value itself.
      `${indentation}  copy(value) {`,
      `${indentation}    return value;`,
      `${indentation}  },`,
      // ENM-U1: the members in declaration order, a fresh mutable List per call.
      `${indentation}  values() {`,
      `${indentation}    return [${values.join(", ")}];`,
      `${indentation}  },`,
      `${indentation}}));`,
    ].join("\n");
  }
}
