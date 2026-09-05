/**
 * What a module publishes: the re-export forms, and D90 R12's rule that a
 * public surface may not carry an inferred `any` out of the module.
 *
 * D114 R1d: the export half of the module cluster.
 */
import { type BindingPattern, type Program } from "../../ast.ts";
import { type ClassInfo } from "../../contracts.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import { type ValueType } from "../../types.ts";
import { type ClassRegistry } from "../classes/registry.ts";
import { type AnalyzableFunctionDeclaration } from "../functions.ts";
import { type Binding } from "../scopes.ts";

/**
 * D90 R12: the class and record names a consumer can read a value *out of*
 * this type, collected into two frontiers so `exportReachableClasses` can walk
 * a record's fields without recursing through a cyclic record here.
 *
 * It visits output positions for the reason `typeContainsAnyOutput` (types.ts)
 * does: an input position accepts a value *from* the consumer, so a class
 * named there is one the consumer already had. The one deliberate difference
 * is an extension type's `properties`, documented at that case.
 */
function collectOutputTypeNames(type: ValueType, classes: string[], records: string[]): void {
  switch (type.kind) {
    case "class":
    case "classConstructor":
      classes.push(type.name);
      return;
    case "optional":
      collectOutputTypeNames(type.inner, classes, records);
      return;
    case "list":
    case "set":
      collectOutputTypeNames(type.element, classes, records);
      return;
    case "map":
      collectOutputTypeNames(type.key, classes, records);
      collectOutputTypeNames(type.value, classes, records);
      return;
    case "record":
    case "promise":
    case "runtimeType":
      collectOutputTypeNames(type.value, classes, records);
      return;
    case "object":
      for (const field of type.fields.values()) collectOutputTypeNames(field, classes, records);
      return;
    case "named":
    case "typeObject":
      // A `named` may still denote a class before resolveNamedClasses runs, so
      // the name joins both frontiers; the one that does not match a
      // declaration simply finds nothing.
      classes.push(type.name);
      records.push(type.name);
      for (const argument of type.kind === "named" ? type.application?.arguments ?? [] : []) {
        collectOutputTypeNames(argument, classes, records);
      }
      return;
    case "extension":
      // An extension family's `properties` are its *named parameters* — a Web
      // component's props are supplied by whoever renders it — so they are the
      // `function` case's `parameters` under another spelling, and are skipped
      // for the same reason. Walking them made `export component Panel(inner:
      // Inner)` report `Inner`'s inferred member while `export def take(box:
      // Inner)` stayed silent: one question, two answers. `arguments` carry
      // the family's payload — a component's exposed Handle, a route input's
      // validated value, a provider's result — which a consumer does read out.
      for (const argument of type.arguments) collectOutputTypeNames(argument, classes, records);
      return;
    case "function":
    case "action":
    case "intrinsic":
      collectOutputTypeNames(type.result, classes, records);
      return;
    case "union":
      for (const member of type.members) collectOutputTypeNames(member, classes, records);
      return;
    default:
  }
}

/**
 * Everything this half of the module cluster asks of the analyzer that hosts
 * it. The three halves share one host object.
 */
export interface ModuleExportsHost {
  readonly classRegistry: ClassRegistry;
  collectPatternNames(pattern: BindingPattern, add: (name: string) => void): void;
  readonly diagnostics: Diagnostic[];
  readonly exportPositionCandidates: {
    readonly className: string;
    readonly member: string;
    readonly span: Span;
  }[];
  readonly namedTypes: Map<string, ReadonlyMap<string, ValueType>>;
  readonly scopes: Map<string, Binding>[];
  readonly typeAliases: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class ModuleExports {
  private readonly host: ModuleExportsHost;

  constructor(host: ModuleExportsHost) {
    this.host = host;
  }

  validateReExports(program: Program): void {
    const exported = new Set<string>();
    const addPatternNames = (pattern: BindingPattern): void => {
      if (pattern.kind === "NameBindingPattern") {
        exported.add(pattern.name);
        return;
      }
      if (pattern.kind === "ListBindingPattern") {
        for (const element of pattern.elements) if (element) addPatternNames(element);
        if (pattern.rest) exported.add(pattern.rest.name);
        return;
      }
      for (const entry of pattern.entries) addPatternNames(entry.pattern);
      if (pattern.rest) exported.add(pattern.rest.name);
    };
    for (const statement of program.body) {
      if (statement.kind === "ReExportDeclaration" || !("exported" in statement) || !statement.exported) continue;
      if (statement.kind === "VariableDeclaration") addPatternNames(statement.pattern);
      else if ("name" in statement && typeof statement.name === "string") exported.add(statement.name);
    }
    for (const statement of program.body) {
      if (statement.kind !== "ReExportDeclaration") continue;
      for (const specifier of statement.specifiers) {
        if (exported.has(specifier.exported)) {
          this.host.diagnostics.push(diagnostic(
            "VEL3016",
            `Export '${specifier.exported}' is declared more than once in this module; rename the re-export with 'as'`,
            specifier.span,
          ));
          continue;
        }
        exported.add(specifier.exported);
      }
    }
  }

  /**
   * D90 R12: "exported" is a property of the declaration a consumer can reach,
   * not of the `def` keyword. A module-level declaration carries the flag
   * itself and is judged here and now. A class member carries none — a public
   * member of a class this module publishes is read by a consumer exactly as
   * an exported `const` is — but whether the class is published is a question
   * about the whole module, so the member waits for reportExportPositionAny. A
   * `private` member is never reachable, and R12's boundary does not move:
   * module-internal `any` stays legal.
   */
  recordExportedAny(statement: AnalyzableFunctionDeclaration, className: string | null, span: Span): void {
    if (statement.exported === true) {
      this.reportExportedAny([statement.name], span);
      return;
    }
    if (className === null || statement.private === true) return;
    this.host.exportPositionCandidates.push({ className, member: statement.name, span });
  }

  /**
   * D90 R12: the class members that turned out to be at an export position.
   * Reported once the module is analyzed, because the answer is reachability
   * and reachability is a property of the module, not of the declaration.
   */
  reportExportPositionAny(program: Program): void {
    if (this.host.exportPositionCandidates.length === 0) return;
    const reachable = this.exportReachableClasses(program);
    for (const candidate of this.host.exportPositionCandidates) {
      if (reachable.has(candidate.className)) {
        this.reportExportedAny([`${candidate.className}.${candidate.member}`], candidate.span);
      }
    }
  }

  /**
   * D90 R12: which class declarations a consuming module can reach. Exported
   * classes seed the set; from there it follows every position a consumer can
   * read a value *out of* — the type of anything else this module exports, the
   * base a reachable class names, and the public surface of a class already
   * reachable. `export class Box extends Base:` publishes `Base`'s members,
   * and `def make() -> Inner` publishes `Inner`'s, whether or not either name
   * is exported.
   *
   * Input positions are deliberately absent, for the same reason
   * `typeContainsAnyOutput` omits them: a consumer that has to *supply* an
   * instance obtained it from an output position first, and that position is
   * what makes the class reachable.
   */
  exportReachableClasses(program: Program): ReadonlySet<string> {
    const classes: string[] = [];
    const records: string[] = [];
    const reach = (type: ValueType | undefined): void => {
      if (type) collectOutputTypeNames(type, classes, records);
    };
    // The same walk validateReExports makes over the module's export surface,
    // so the two cannot disagree about what "this module exports" means.
    const publish = (name: string): void => {
      reach(this.host.scopes[0]!.get(name)?.type);
      records.push(name);
    };
    for (const statement of program.body) {
      if (statement.kind === "ReExportDeclaration" || !("exported" in statement) || !statement.exported) continue;
      if (statement.kind === "ClassDeclaration") classes.push(statement.name);
      else if (statement.kind === "VariableDeclaration") this.host.collectPatternNames(statement.pattern, publish);
      else if ("name" in statement && typeof statement.name === "string") publish(statement.name);
    }
    const reachable = new Set<string>();
    const visitedRecords = new Set<string>();
    while (classes.length > 0 || records.length > 0) {
      if (records.length > 0) {
        const name = records.pop()!;
        if (visitedRecords.has(name)) continue;
        visitedRecords.add(name);
        // A record a consumer holds is read field by field, so a class in a
        // field is reachable even when the record type itself is not exported.
        for (const field of this.host.namedTypes.get(name)?.values() ?? []) reach(field);
        reach(this.host.typeAliases.get(name));
        continue;
      }
      const name = classes.pop()!;
      if (reachable.has(name)) continue;
      reachable.add(name);
      const info = this.host.classRegistry.classInfo(name);
      if (!info) continue;
      if (info.base) classes.push(info.base);
      reach(info.iterate);
      // ClassInfo is exactly the public surface — private members live in
      // their own tables — and `fields` carries the getters' result types.
      // The constructor's parameters are inputs, so they are not followed.
      for (const field of info.fields.values()) reach(field.type);
      for (const field of info.staticFields.values()) reach(field.type);
      for (const method of info.methods.values()) reach(method);
      for (const method of info.staticMethods.values()) reach(method);
    }
    return reachable;
  }

  /**
   * D90 R12: the diagnostic has to teach the way out, not only refuse. A
   * consuming module never writes `unsafe`, so an exported `any` hands it a
   * value carrying no guarantee at all; the escape is to validate the value
   * into a declared type in the module that owns the boundary, which is what
   * `Type.parse` exists for. No new diagnostic code and no unsafe marker: this
   * is the rule at validateTypeReference finished, not a second rule.
   */
  reportExportedAny(exported: readonly string[], span: Span): void {
    const names = exported.map((name) => `'${name}'`).join(", ");
    this.host.typeError(
      `${exported.length === 1 ? "Export" : "Exports"} ${names} ${exported.length === 1 ? "is" : "are"} 'any', which cannot cross a module boundary; validate the value into a declared type in this module first — 'const settled = Config.parse(candidate)' — and export that`,
      span,
    );
  }
}
