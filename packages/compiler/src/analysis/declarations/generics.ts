/**
 * Generic declarations and their applications: instantiating a template's
 * field table, remembering every application a module reaches, and the bound
 * and recursion checks an application has to pass.
 *
 * D114 R1d: `noteGenericApplications`, the two resolvers and the four
 * validation passes were private methods of `Analyzer`; they are one thing —
 * what `Box<string>` means and whether it is legal — and live here now.
 */
import {
  type ClassDeclaration,
  type Program,
  type TypeDeclaration,
  type TypeReference,
  type TypeSyntax,
} from "../../ast.ts";
import { type ClassInfo } from "../../contracts.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";

import { type Span } from "../../source.ts";
import { boundVocabularyGuidance } from "../calls/generic-calls.ts";
import {
  classApplicationType,
  collectTypeArgumentBoundViolations,
  describeType,
  genericApplicationType,
  substituteTypeParameters,
  typeContainsRuntimeTypeCheck,
  unknownType,
  type GenericApplication,
  type GenericTypeInfo,
  type TypeParameterBound,
  type ValueType,
} from "../../types.ts";

/**
 * Everything this half of the declaration cluster asks of the analyzer that
 * hosts it. The five halves share one host object, so the interface is the
 * same shape for each and the union of them is what the analyzer builds.
 */
export interface GenericDeclarationsHost {
  readonly canonicalGenericApplications: Map<string, ValueType>;
  readonly classes: Map<string, ClassInfo>;
  readonly diagnostics: Diagnostic[];
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  findClassInReadonlyData(type: ValueType, seen?: Set<string>, sawCycle?: { cut: boolean }): { readonly suffix: string; readonly className: string } | null;
  readonly genericApplications: Map<string, GenericApplication>;
  readonly genericTypes: Map<string, GenericTypeInfo>;
  readonly genericTypesByIdentity: Map<string, GenericTypeInfo>;
  readonly namedTypeReadonlyFields: Map<string, ReadonlySet<string>>;
  readonly namedTypes: Map<string, ReadonlyMap<string, ValueType>>;
  noteClassApplication(identity: string, application: GenericApplication): void;
  readonlyDataViewOf(type: ValueType): ValueType;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  resolveNamedClasses(type: ValueType): ValueType;
  satisfiesBound(type: ValueType, bound: TypeParameterBound): boolean;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean;
}

export class GenericDeclarations {
  private readonly host: GenericDeclarationsHost;

  constructor(host: GenericDeclarationsHost) {
    this.host = host;
  }

  /**
   * D55 rule 121: an instantiation's field table is the declaration's fields
   * with the arguments substituted, registered under the instantiation's own
   * identity. Computing it on demand rather than at the point the application
   * was written is what makes `type Tree<T>: kids: List<Tree<T>>` terminate:
   * the application is *noted* while the declaration is still being read, and
   * substituted only once someone asks, by which time the template is whole.
   * Substitution rebuilds nested applications through the same constructor, so
   * each one is noted in turn and the walk is finite in the number of distinct
   * instantiations — homogeneous recursion reaches its fixed point, and rule
   * 125's declaration-site rule is what stops a polymorphic one from existing.
   */
  instantiateGenericFields(identity: string): ReadonlyMap<string, ValueType> | null {
    if (this.host.namedTypes.has(identity)) return this.host.namedTypes.get(identity)!;
    const application = this.host.genericApplications.get(identity);
    if (!application) return null;
    const info = this.host.genericTypesByIdentity.get(application.declaration);
    if (!info) return null;
    const bindings = info.parameterNames.map((_, index) => application.arguments[index] ?? unknownType);
    const fields = new Map<string, ValueType>();
    // Registered before the field types are walked: a field that mentions this
    // very instantiation finds the entry instead of recurring into it.
    this.host.namedTypes.set(identity, fields);
    for (const [name, type] of info.fields) {
      const substituted = substituteTypeParameters(type, bindings);
      this.noteGenericApplications(substituted);
      fields.set(name, substituted);
    }
    if (info.readonlyFields?.size) this.host.namedTypeReadonlyFields.set(identity, info.readonlyFields);
    return fields;
  }

  /**
   * Records every generic application inside a type so its field table can be
   * built on demand. Called wherever an application can first become visible —
   * a resolved annotation, an imported binding, a substituted field — because a
   * missed site is an instantiation whose fields silently read as "not a
   * record" (the batch M failure shape, one layer out).
   */
  noteGenericApplications(type: ValueType, seen = new Set<string>()): void {
    switch (type.kind) {
      // D55 rule 120 layer two: a class instantiation is noted the same way a
      // record's is, so `classInfo` can build its member table when asked.
      case "class": {
        const application = type.application;
        if (!application || !type.identity || seen.has(type.identity)) return;
        seen.add(type.identity);
        this.host.noteClassApplication(type.identity, application);
        for (const argument of application.arguments) this.noteGenericApplications(argument, seen);
        return;
      }
      case "named": {
        const application = type.application;
        if (!application || !type.identity || seen.has(type.identity)) return;
        seen.add(type.identity);
        if (this.host.genericTypesByIdentity.has(application.declaration)) this.host.genericApplications.set(type.identity, application);
        for (const argument of application.arguments) this.noteGenericApplications(argument, seen);
        return;
      }
      case "optional":
        return this.noteGenericApplications(type.inner, seen);
      case "list":
      case "set":
        return this.noteGenericApplications(type.element, seen);
      case "map":
        this.noteGenericApplications(type.key, seen);
        return this.noteGenericApplications(type.value, seen);
      case "record":
      case "promise":
      case "runtimeType":
        return this.noteGenericApplications(type.value, seen);
      case "typeObject":
        if (type.value) this.noteGenericApplications(type.value, seen);
        return;
      case "object":
        for (const field of type.fields.values()) this.noteGenericApplications(field, seen);
        return;
      case "extension":
        for (const property of type.properties.values()) this.noteGenericApplications(property, seen);
        for (const argument of type.arguments) this.noteGenericApplications(argument, seen);
        return;
      case "function":
      case "action":
      case "intrinsic":
        for (const parameter of type.parameters) this.noteGenericApplications(parameter, seen);
        if (type.rest) this.noteGenericApplications(type.rest, seen);
        return this.noteGenericApplications(type.result, seen);
      case "union":
        for (const member of type.members) this.noteGenericApplications(member, seen);
        return;
      default:
        return;
    }
  }

  /**
   * D55 rule 121: the one place an application written in this module becomes
   * canonical — declaration identity, display text, instantiation identity, and
   * the note that lets its field table be built. Every path that can be the
   * first to see an application calls this, so none of them can produce a
   * half-resolved one.
   */
  resolveGenericApplication(
    type: Extract<ValueType, { kind: "named" }>,
    resolveArgument: (argument: ValueType) => ValueType = (argument) => this.host.resolveNamedClasses(argument),
  ): ValueType | null {
    const application = type.application;
    if (!application || type.identity) return null;
    const info = this.host.genericTypes.get(application.name);
    if (!info) return null;
    const built = genericApplicationType(
      info.identity,
      info.name,
      application.arguments.map(resolveArgument),
      type.readonlyView === true,
    );
    // One object per instantiation, not one per resolution. A recursive
    // generic re-enters resolution, so handing back a fresh equal object each
    // time would defeat any traversal that memoizes by type identity and recur
    // without end.
    const key = `${built.identity}${built.readonlyView ? "\u0000readonly" : ""}`;
    const cached = this.host.canonicalGenericApplications.get(key);
    if (cached) return cached;
    this.host.canonicalGenericApplications.set(key, built);
    this.noteGenericApplications(built);
    return built;
  }

  /**
   * D55 rule 120 layer two: an application whose name is a generic class. The
   * declaration key is the class's identity where it has one and its local name
   * otherwise, which is the same key `this.host.classes` is filed under, so the
   * instantiation and its template are always found together.
   */
  resolveGenericClassApplication(type: Extract<ValueType, { kind: "named" }>): ValueType | null {
    const application = type.application;
    if (!application || type.identity) return null;
    const info = this.host.classes.get(application.name);
    if (!info?.typeParameterNames?.length) return null;
    const arguments_ = application.arguments.map((argument) => this.host.resolveNamedClasses(argument));
    const built = classApplicationType(info.identity ?? application.name, application.name, arguments_);
    const cached = this.host.canonicalGenericApplications.get(built.identity!);
    if (cached) return cached;
    this.host.canonicalGenericApplications.set(built.identity!, built);
    this.noteGenericApplications(built);
    return built;
  }

  /**
   * D55 rules 124 and 126: everything an instantiation has to answer for at the
   * place it is written — arity, the declared bounds, and the one argument
   * shape a runtime-validated record can never hold.
   */
  validateGenericApplication(info: GenericTypeInfo, syntax: Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>): boolean {
    const arity = info.parameterNames.length;
    if (syntax.arguments.length !== arity) {
      this.host.typeError(
        `Generic type '${info.name}' takes ${arity === 1 ? "1 type argument" : `${arity} type arguments`}, not ${syntax.arguments.length}; write '${info.name}<${info.parameterNames.join(", ")}>'`,
        syntax.span,
      );
      return false;
    }
    const arguments_ = syntax.arguments.map((argument) => this.host.resolveAnnotation({ syntax: argument, span: argument.span }));
    let valid = true;
    for (const [index, argument] of arguments_.entries()) {
      // D55 rule 124: `Box<Type<User>>` puts a static carrier in a field the
      // record validates at runtime, which is the existing VEL4022 refusal
      // reaching the position that actually caused it.
      if (!typeContainsRuntimeTypeCheck(argument)) continue;
      this.host.diagnostics.push(diagnostic(
        "VEL4022",
        `Type<T> is a static runtime-Type carrier and cannot be a type argument of '${info.name}', whose fields are validated at runtime; keep it in a function, class, or ordinary value instead`,
        syntax.arguments[index]!.span,
      ));
      valid = false;
    }
    if (!valid) return false;
    // D44 rule 72 reaching the instantiation: a bare `T` under `readonly` is
    // legal at the declaration — opacity is as good as immutability there — but
    // the argument is what decides whether the promise holds, and only this
    // site knows it. Without this, `type Held<T>: readonly value: T` applied to
    // a class kept a `readonly` view that could be written through.
    if (info.readonlyFields?.size) {
      const instantiated = this.host.resolveAnnotation({ syntax, span: syntax.span });
      const fields = instantiated.kind === "named" && instantiated.identity ? this.host.fieldsOf(instantiated.identity) : null;
      for (const name of info.readonlyFields) {
        const field = fields?.get(name);
        const violation = field ? this.host.findClassInReadonlyData(this.host.readonlyDataViewOf(field)) : null;
        if (!violation) continue;
        this.host.typeError(
          `'readonly' accepts only pure data at every depth; '${describeType(instantiated)}.${name}${violation.suffix}' is class '${violation.className}' — model it as a data record, or drop 'readonly'`,
          syntax.span,
        );
        valid = false;
      }
    }
    if (!valid) return false;
    // D55 rule 124: the same grant table, the same decision procedure, the same
    // violation shape a call site reports — only the declaration form differs.
    const violations = collectTypeArgumentBoundViolations(
      info.parameterNames,
      info.parameterBounds,
      arguments_,
      (type, bound) => this.host.satisfiesBound(type, bound),
    );
    for (const violation of violations) {
      this.host.diagnostics.push(diagnostic(
        "VEL4031",
        `Type parameter '${violation.name}' of '${info.name}' is bound by ${violation.bound}, so this argument cannot be ${describeType(violation.solved)}; ${boundVocabularyGuidance[violation.bound]}`,
        syntax.arguments[violation.index]?.span ?? syntax.span,
      ));
    }
    return violations.length === 0;
  }

  /**
   * D55 rule 120 layer two: `extends Stack<number>` — the base must apply a
   * generic class fully, and a base that is not generic takes no arguments at
   * all. The refusals are the type position's, because `extends` is a type
   * position: the same missing-arity teaching, the same bound check.
   */
  checkGenericClassBase(statement: ClassDeclaration, base: NonNullable<ClassDeclaration["base"]>): void {
    const parameters = this.host.classes.get(base.name)?.typeParameterNames;
    if (!parameters?.length) {
      if (base.typeArguments?.length) {
        this.host.typeError(`Class '${base.name}' declares no type parameters, so it takes no type arguments`, base.span);
      }
      return;
    }
    if (!base.typeArguments?.length) {
      this.host.typeError(
        `Generic class '${base.name}' needs ${parameters.length === 1 ? "a type argument" : `${parameters.length} type arguments`}; write 'extends ${base.name}<${parameters.join(", ")}>' with concrete types`,
        base.nameSpan,
      );
      return;
    }
    const syntax: Extract<TypeSyntax, { kind: "GenericTypeSyntax" }> = {
      kind: "GenericTypeSyntax",
      name: base.name,
      nameSpan: base.nameSpan,
      arguments: base.typeArguments,
      span: base.span,
    };
    const argumentsValid = base.typeArguments
      .map((argument) => this.host.validateTypeReference({ syntax: argument, span: argument.span }))
      .every(Boolean);
    if (!argumentsValid) return;
    this.validateGenericClassApplication(base.name, this.host.classes.get(base.name)!, syntax);
    void statement;
  }

  /**
   * D55 rule 125 reaching layer two: a generic class's reference to itself —
   * in a field, a parameter, a result, or its own base — must pass its own
   * parameters straight through. `class Node<T>: let next: Node<T>?` is
   * homogeneous and reaches a fixed point; `Node<List<T>>` would demand
   * `Node<List<List<T>>>` at every depth, without end. Reported on the line
   * that writes it, exactly as the record rule is.
   */
  rejectPolymorphicClassRecursion(program: Program): void {
    const declarations = program.body.filter((statement): statement is ClassDeclaration =>
      statement.kind === "ClassDeclaration" && (statement.typeParameters?.length ?? 0) > 0);
    if (declarations.length === 0) return;
    const local = new Set(declarations.map((statement) => statement.name));
    for (const statement of declarations) {
      const parameters = statement.typeParameters!.map((parameter) => parameter.name);
      const check = (syntax: TypeSyntax): void => {
        switch (syntax.kind) {
          case "GenericTypeSyntax": {
            if (local.has(syntax.name)) {
              const passesThrough = syntax.arguments.length === parameters.length
                && syntax.arguments.every((argument, index) =>
                  argument.kind === "NamedTypeSyntax" && argument.name === parameters[index]);
              if (!passesThrough) {
                this.host.diagnostics.push(diagnostic(
                  "VEL4021",
                  `Recursive generic class '${statement.name}' must use its own type parameters where it refers to '${syntax.name}'; write '${syntax.name}<${parameters.join(", ")}>' — arguments that change with the depth would need a new instantiation at every depth, without end`,
                  syntax.span,
                ));
              }
            }
            syntax.arguments.forEach(check);
            return;
          }
          case "ReadonlyTypeSyntax":
          case "OptionalTypeSyntax":
            return check(syntax.inner);
          case "UnionTypeSyntax":
            return syntax.members.forEach(check);
          case "FunctionTypeSyntax":
            syntax.parameters.forEach((parameter) => check(parameter.type));
            return check(syntax.result);
          default:
            return;
        }
      };
      const annotation = (reference: TypeReference | null): void => {
        if (reference) check(reference.syntax);
      };
      for (const parameter of statement.parameters) annotation(parameter.type);
      for (const field of statement.fields) annotation(field.type);
      for (const getter of statement.getters) annotation(getter.returnType);
      for (const method of statement.methods) {
        for (const parameter of method.parameters) annotation(parameter.type);
        annotation(method.returnType);
      }
      for (const argument of statement.base?.typeArguments ?? []) check(argument);
    }
  }

  /**
   * D55 rules 124 and 126 on the class side: arity and the declared bounds,
   * decided by the same grant table and reported in the same shape. A class is
   * never runtime-validated field by field, so the `Type<T>` argument refusal
   * a record carries has nothing to say here.
   */
  validateGenericClassApplication(
    name: string,
    info: ClassInfo,
    syntax: Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>,
  ): boolean {
    const parameters = info.typeParameterNames ?? [];
    const arity = parameters.length;
    if (syntax.arguments.length !== arity) {
      this.host.typeError(
        `Generic class '${name}' takes ${arity === 1 ? "1 type argument" : `${arity} type arguments`}, not ${syntax.arguments.length}; write '${name}<${parameters.join(", ")}>'`,
        syntax.span,
      );
      return false;
    }
    const arguments_ = syntax.arguments.map((argument) => this.host.resolveAnnotation({ syntax: argument, span: argument.span }));
    const violations = collectTypeArgumentBoundViolations(
      parameters,
      info.typeParameterBounds ?? parameters.map(() => null),
      arguments_,
      (type, bound) => this.host.satisfiesBound(type, bound),
    );
    for (const violation of violations) {
      this.host.diagnostics.push(diagnostic(
        "VEL4031",
        `Type parameter '${violation.name}' of '${name}' is bound by ${violation.bound}, so this argument cannot be ${describeType(violation.solved)}; ${boundVocabularyGuidance[violation.bound]}`,
        syntax.arguments[violation.index]?.span ?? syntax.span,
      ));
    }
    return violations.length === 0;
  }

  /**
   * D55 rule 125: a generic record's reference to a declaration in its own
   * recursive group must pass that group's parameters straight through.
   * `type Tree<T>: kids: List<Tree<T>>` is homogeneous — `Tree<string>` needs
   * only `Tree<string>`, and monomorphization reaches its fixed point. The
   * refused shape, `type Bad<T>: next: Bad<List<T>>?`, demands
   * `Bad<List<string>>`, `Bad<List<List<string>>>`, without end. The rule is
   * checked here, on the line that declares it, because an instantiation-depth
   * limit could only say "too deep" at some later call — the undirected
   * diagnostic family D42 spent its length removing.
   */
  rejectPolymorphicRecursion(program: Program): void {
    const declarations = program.body.filter((statement): statement is TypeDeclaration =>
      statement.kind === "TypeDeclaration" && (statement.typeParameters?.length ?? 0) > 0);
    if (declarations.length === 0) return;
    const local = new Set(declarations.map((statement) => statement.name));
    const applications = (statement: TypeDeclaration): Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>[] => {
      const found: Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>[] = [];
      const visit = (syntax: TypeSyntax): void => {
        switch (syntax.kind) {
          case "GenericTypeSyntax":
            if (local.has(syntax.name)) found.push(syntax);
            syntax.arguments.forEach(visit);
            return;
          case "ReadonlyTypeSyntax":
          case "OptionalTypeSyntax":
            return visit(syntax.inner);
          case "UnionTypeSyntax":
            return syntax.members.forEach(visit);
          case "FunctionTypeSyntax":
            syntax.parameters.forEach((parameter) => visit(parameter.type));
            return visit(syntax.result);
          default:
            return;
        }
      };
      for (const field of statement.fields) visit(field.type.syntax);
      return found;
    };
    const mentions = new Map(declarations.map((statement) =>
      [statement.name, new Set(applications(statement).map((syntax) => syntax.name))] as const));
    // The reachable set, to a fixed point: a group is every declaration that
    // reaches this one and is reached by it, which is what makes the rule catch
    // `A<T>` -> `B<List<T>>` -> `A<T>` as surely as it catches direct self-use.
    const reaches = new Map([...mentions].map(([name, direct]) => [name, new Set(direct)] as const));
    for (let changed = true; changed;) {
      changed = false;
      for (const [, reachable] of reaches) {
        for (const name of [...reachable]) {
          for (const next of reaches.get(name) ?? []) {
            if (reachable.has(next)) continue;
            reachable.add(next);
            changed = true;
          }
        }
      }
    }
    for (const statement of declarations) {
      const group = new Set([...reaches.get(statement.name) ?? []]
        .filter((name) => name === statement.name || reaches.get(name)?.has(statement.name)));
      const parameters = statement.typeParameters!.map((parameter) => parameter.name);
      for (const syntax of applications(statement)) {
        if (!group.has(syntax.name)) continue;
        const passesThrough = syntax.arguments.length === parameters.length
          && syntax.arguments.every((argument, index) =>
            argument.kind === "NamedTypeSyntax" && argument.name === parameters[index]);
        if (passesThrough) continue;
        this.host.diagnostics.push(diagnostic(
          "VEL4021",
          `Recursive generic type '${statement.name}' must use its own type parameters where it refers to '${syntax.name}'; write '${syntax.name}<${parameters.join(", ")}>' — arguments that change with the depth would need a new instantiation at every depth, without end`,
          syntax.span,
        ));
      }
    }
  }
}
