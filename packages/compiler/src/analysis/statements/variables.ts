/**
 * The declaration statement heads: `const`/`let`, `type`, `enum` and `class`.
 *
 * D114 R1f: what these four share is the question this module answers — where
 * a declaration may stand, and what the name it introduces is bound to. The
 * bodies of three of them belong to clusters that already own them
 * (`declarations/records.ts`, `classes/members.ts`), so those arms are the
 * module-scope refusal plus the one call that hands the body over; the `enum`
 * member checks and the whole of a variable declaration are here because
 * nothing else owns them.
 */
import { type BindingPattern, type Expression, type Statement, type TypeReference } from "../../ast.ts";
import { diagnostic, type Diagnostic } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import {
  invalidType,
  typeContainsAnyOutput,
  unknownType,
  type ValueType,
} from "../../types.ts";
import { type Binding, type MutableCellTarget } from "../scopes.ts";

/**
 * Everything the declaration statements ask of the analyzer that hosts them,
 * and nothing more. The scope stack is a live read: a declaration writes into
 * the scope it is standing in.
 */
export interface DeclarationStatementsHost {
  analyzeClassBody(statement: Extract<Statement, { kind: "ClassDeclaration" }>): void;
  analyzeRecordTypeDeclaration(statement: Extract<Statement, { kind: "TypeDeclaration" }>): void;
  assignedFactDomain(expression: Expression, inferred: ValueType): ValueType;
  carriedOwnedResource(expression: Expression | null): { readonly handle: string; readonly depth: number } | null;
  claimArrowDeferredFrame(pattern: BindingPattern, initializer: Expression): void;
  collectPatternNames(pattern: BindingPattern, add: (name: string) => void): void;
  declarePattern(pattern: BindingPattern, mutable: boolean, type: ValueType, declaredType?: ValueType): void;
  readonly diagnostics: Diagnostic[];
  establishAssignedPatternFacts(pattern: BindingPattern, assigned: ValueType): void;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  readonly promiseInitializerBindings: WeakSet<Binding>;
  recordBindingHoleSource(pattern: BindingPattern, initializer: Expression, reported: boolean): void;
  reportExportedAny(exported: readonly string[], span: Span): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  requireSettledCollectionElement(initializer: Expression, declared: ValueType, annotated: boolean): boolean;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  readonly scopes: Map<string, Binding>[];
  validateKnownBindingShape(pattern: BindingPattern, value: Expression): void;
  validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean;
  widenAggregateSingleton(type: ValueType): ValueType;
}

export class DeclarationStatements {
  private readonly host: DeclarationStatementsHost;

  constructor(host: DeclarationStatementsHost) {
    this.host = host;
  }

  analyzeTypeDeclaration(statement: Extract<Statement, { kind: "TypeDeclaration" }>): void {
    // Shapes are only registered from module scope (registerTypeShapes
    // walks program.body), so a nested declaration would analyze against
    // a missing — or worse, a same-named module-level — shape.
    if (this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic("VEL3011", "Types can only be declared at module scope", statement.span));
    }
    this.host.analyzeRecordTypeDeclaration(statement);
  }

  analyzeEnumDeclaration(statement: Extract<Statement, { kind: "EnumDeclaration" }>): void {
    if (this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic("VEL3011", "Enums can only be declared at module scope", statement.span));
    }
    const seen = new Set<string>();
    // D102 ruling 1: wire values are unique by *value identity*, across the
    // string and integer kinds alike. Keying on the value itself is exactly
    // that rule — a Map separates the string `"2"` from the number `2`, so
    // both may stand in one enum, which is right because neither parses as
    // the other. `JSON.stringify` in the report keeps the two spellings
    // apart on the page as well.
    const serializedValues = new Map<string | number, string>();
    for (const member of statement.members) {
      if (member.name === "is" || member.name === "parse" || member.name === "values") {
        this.host.diagnostics.push(diagnostic("VEL4014", `Enum member '${member.name}' is reserved for the enum's runtime surface (is, parse, values)`, member.span));
      }
      if (member.name === "prototype" || member.name === "__proto__") {
        this.host.diagnostics.push(diagnostic("VEL4014", `Enum member '${member.name}' is unavailable because VelarScript does not expose prototype manipulation`, member.span));
      }
      if (seen.has(member.name)) {
        this.host.diagnostics.push(diagnostic("VEL4014", `Enum member '${member.name}' is declared more than once`, member.span));
      }
      seen.add(member.name);
      const previous = serializedValues.get(member.value);
      if (previous && previous !== member.name) {
        this.host.diagnostics.push(diagnostic(
          "VEL4014",
          `Enum members '${previous}' and '${member.name}' cannot share the runtime value ${JSON.stringify(member.value)}`,
          member.valueSpan ?? member.span,
        ));
      } else {
        serializedValues.set(member.value, member.name);
      }
    }
  }

  analyzeClassDeclaration(statement: Extract<Statement, { kind: "ClassDeclaration" }>): void {
    // registerClassShapes only walks program.body, so a nested class body
    // would be analyzed against the module-level shape of the same name
    // (silent wrong types) and `export class` in a block emits invalid
    // JavaScript.
    if (this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic("VEL3011", "Classes can only be declared at module scope", statement.span));
    }
    this.host.analyzeClassBody(statement);
  }

  analyzeVariableDeclaration(statement: Extract<Statement, { kind: "VariableDeclaration" }>): void {
    // MOD-D1: `export const`/`export let` below module scope emitted an
    // `export` statement inside a block — invalid JavaScript.
    if (statement.exported && this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic("VEL3011", "Exports can only be declared at module scope", statement.span));
    }
    const annotated = statement.type ? this.host.resolveAnnotation(statement.type) : null;
    const annotationValid = statement.type ? this.host.validateTypeReference(statement.type) : true;
    const actual = this.host.inferExpression(statement.initializer, annotationValid ? annotated ?? unknownType : invalidType);
    // D44 rule 71: an unannotated alias of an assignment-established fact
    // declares the source's domain and re-establishes the fact below, so
    // the alias keeps the declared question testable (`taken != null`
    // stays a real check) while reads still see the refined type.
    const aliasSource = !annotated ? this.host.assignedFactDomain(statement.initializer, actual) : actual;
    const inferredStorage = statement.binding === "let" && !annotated
      ? this.host.widenAggregateSingleton(aliasSource)
      : aliasSource;
    const declared = annotationValid ? annotated ?? inferredStorage : invalidType;
    const contract = annotationValid ? annotated ?? inferredStorage : invalidType;
    if (annotationValid) this.host.requireAssignable(actual, declared, statement.initializer.span);
    // D85 rule 209: the construction that just reported is invalid from
    // here on. Binding the name to the hole instead would reproduce
    // `Cannot assign List<unknown> to ...` on a later line that has no
    // `[]` in it — the second, contradicting report the ruling deletes.
    // D90 R12: `any` may not cross a module boundary. The written spelling
    // is already refused by validateTypeReference above, so only the
    // inferred one reaches here — and that asymmetry was the defect, since
    // the spelling that got refused is the honest one. Checking the
    // settled type before declarePattern covers every pattern shape at
    // once, including `export const {a, b} = thing`.
    if (statement.exported && annotationValid && typeContainsAnyOutput(declared)) {
      const exported: string[] = [];
      this.host.collectPatternNames(statement.pattern, (name) => exported.push(name));
      this.host.reportExportedAny(exported, statement.span);
    }
    const unsettled = this.host.requireSettledCollectionElement(statement.initializer, declared, annotated !== null);
    this.host.declarePattern(statement.pattern, statement.binding === "let", unsettled ? invalidType : declared, unsettled ? invalidType : contract);
    if (statement.binding === "const" && statement.pattern.kind === "NameBindingPattern") {
      const declaredBinding = this.host.scopes.at(-1)?.get(statement.pattern.name);
      if (declaredBinding) declaredBinding.stableOptionalCopy = true;
    }
    if (annotated === null) this.host.recordBindingHoleSource(statement.pattern, statement.initializer, unsettled);
    this.host.claimArrowDeferredFrame(statement.pattern, statement.initializer);
    // D51 rule 101: an alias of an owned handle — or a closure over one —
    // is the same resource under a second name, so it inherits the
    // ownership and the escape check follows it.
    if (statement.pattern.kind === "NameBindingPattern") {
      const carried = this.host.carriedOwnedResource(statement.initializer);
      const declaredBinding = carried ? this.host.scopes.at(-1)?.get(statement.pattern.name) : null;
      if (carried && declaredBinding) declaredBinding.ownedResource = carried;
    }
    this.host.validateKnownBindingShape(statement.pattern, statement.initializer);
    // D44 rule 71: the initializer's type is a fact for each declared
    // binding — `const x: string? = "a"` reads as string until a write
    // says otherwise.
    if (annotationValid) this.host.establishAssignedPatternFacts(statement.pattern, actual);
    if (statement.pattern.kind === "NameBindingPattern") {
      const binding = this.host.scopes.at(-1)?.get(statement.pattern.name);
      if (binding?.span.start === statement.pattern.span.start && binding.span.end === statement.pattern.span.end) {
        if (this.host.expandAliases(actual).kind === "promise") this.host.promiseInitializerBindings.add(binding);
      }
    }
  }
}
