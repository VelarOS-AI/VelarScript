/**
 * `type` declarations: the field table a record name stands for, the shape
 * checks it has to pass, and the refusals for a name the language owns.
 *
 * D114 R1d: `registerTypeShapes` and the four validation passes around it were
 * private methods of `Analyzer`. They answer one question — what does a
 * declared record name mean, and is the declaration legal — so they live in
 * one collaborator the analyzer owns as `this.typeRecords`. The tables
 * themselves (`namedTypes`, `namedTypeIdentities`, …) stay fields of the
 * analyzer, which is where the member, call and class clusters already read
 * them from, and arrive here through the shared declarations host.
 */
import {
  type ClassDeclaration,
  type FunctionDeclaration,
  type Program,
  type TypeAliasDeclaration,
  type TypeDeclaration,
  type TypeParameterDeclaration,
  type TypeReference,
  type TypeSyntax,
} from "../../ast.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";

import { type Span } from "../../source.ts";
import {
  describeType,
  isTypeParameterBound,
  typeContainsRuntimeTypeCheck,
  typeParameterBoundNames,
  type GenericTypeInfo,
  type ValueType,
} from "../../types.ts";
import { type LoweringRecorder } from "../lowering-recorder.ts";
import { type BuiltinTypeNamePosition } from "../scopes.ts";

/**
 * Everything this half of the declaration cluster asks of the analyzer that
 * hosts it. The five halves share one host object, so the interface is the
 * same shape for each and the union of them is what the analyzer builds.
 */
export interface TypeRecordsHost {
  checkTypeParameterDeclarations(declarations: readonly TypeParameterDeclaration[] | undefined): void;
  declareTypeNameBinding(name: string, type: ValueType, declarationSpan: Span, position: BuiltinTypeNamePosition): void;
  readonly diagnostics: Diagnostic[];
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  findClassInReadonlyData(type: ValueType, seen?: Set<string>, sawCycle?: { cut: boolean }): { readonly suffix: string; readonly className: string } | null;
  readonly genericTypes: Map<string, GenericTypeInfo>;
  readonly genericTypesByIdentity: Map<string, GenericTypeInfo>;
  readonly inheritedTypeFields: WeakMap<TypeDeclaration, ReadonlySet<string>>;
  readonly invalidDeclaredTypes: Set<string>;
  isPrimitiveType(name: string): boolean;
  readonly lowering: LoweringRecorder;
  markTypeNameRefused(name: string): void;
  memberTypeParameterFrame(classParameters: readonly TypeParameterDeclaration[] | undefined, ownParameters: readonly TypeParameterDeclaration[] | undefined): ReadonlyMap<string, ValueType>;
  readonly modulePath: string | null;
  readonly namedTypeBases: Map<string, ValueType>;
  readonly namedTypeIdentities: Map<string, string>;
  readonly namedTypeReadonlyFields: Map<string, ReadonlySet<string>>;
  readonly namedTypes: Map<string, ReadonlyMap<string, ValueType>>;
  readonly predeclared: WeakSet<object>;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  staticMemberTypeParameters: { readonly className: string; readonly names: ReadonlySet<string> } | null;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  typeParameterFrame(declarations: readonly TypeParameterDeclaration[] | undefined): ReadonlyMap<string, ValueType>;
  validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean;
  withTypeParameterFrame<T>(frame: ReadonlyMap<string, ValueType>, action: () => T): T;
}

export class TypeRecords {
  private readonly host: TypeRecordsHost;

  constructor(host: TypeRecordsHost) {
    this.host = host;
  }

  registerTypeShapes(program: Program): void {
    const declarations = new Map<string, TypeDeclaration>();
    const concrete = new Map<string, { readonly fields: Map<string, ValueType>; readonly readonlyFields: Set<string> }>();
    const generic = new Map<string, { readonly info: GenericTypeInfo; readonly fields: Map<string, ValueType>; readonly readonlyFields: Set<string> }>();

    // Register every name and mutable placeholder first. A base may be declared
    // later, and a generic base may mention the child's own parameters.
    for (const statement of program.body) {
      if (statement.kind !== "TypeDeclaration") continue;
      declarations.set(statement.name, statement);
      const fields = new Map<string, ValueType>();
      const readonlyFields = new Set<string>();
      if (statement.typeParameters?.length) {
        const info: GenericTypeInfo = {
          identity: this.host.namedTypeIdentities.get(statement.name) ?? statement.name,
          name: statement.name,
          parameterNames: statement.typeParameters.map((parameter) => parameter.name),
          parameterBounds: statement.typeParameters.map((parameter) =>
            parameter.bound && isTypeParameterBound(parameter.bound) ? parameter.bound : null),
          fields,
          readonlyFields,
        };
        this.host.genericTypes.set(statement.name, info);
        this.host.genericTypesByIdentity.set(info.identity, info);
        generic.set(statement.name, { info, fields, readonlyFields });
      } else {
        this.host.namedTypes.set(statement.name, fields);
        this.host.namedTypeReadonlyFields.set(statement.name, readonlyFields);
        concrete.set(statement.name, { fields, readonlyFields });
      }
    }

    const resolved = new Set<string>();
    const resolving: string[] = [];
    const localIdentity = (name: string): string => this.host.namedTypeIdentities.get(name)
      ?? (this.host.modulePath ? `velar:${this.host.modulePath}#type:${name}` : name);
    const declarationName = (type: ValueType): string | null => type.kind === "named"
      ? type.application?.name ?? type.name
      : null;
    const declarationKey = (type: ValueType): string | null => {
      if (type.kind !== "named") return null;
      const name = type.application?.name ?? type.name;
      if (declarations.has(name)) return localIdentity(name);
      return type.application?.declaration ?? type.identity ?? type.name;
    };

    const resolveDeclaration = (statement: TypeDeclaration): void => {
      if (resolved.has(statement.name)) return;
      if (resolving.includes(statement.name)) return;
      resolving.push(statement.name);
      const target = concrete.get(statement.name) ?? generic.get(statement.name)!;
      const withParameters = <T>(action: () => T): T => statement.typeParameters?.length
        ? this.host.withTypeParameterFrame(this.host.typeParameterFrame(statement.typeParameters), action)
        : action();
      withParameters(() => {
        let inherited = new Map<string, ValueType>();
        let inheritedReadonly = new Set<string>();
        if (statement.base) {
          let base = this.host.resolveAnnotation(statement.base);
          const baseName = declarationName(base);
          const localBase = baseName ? declarations.get(baseName) : undefined;
          if (localBase && !resolving.includes(localBase.name)) {
            resolveDeclaration(localBase);
            base = this.host.resolveAnnotation(statement.base);
          }
          this.host.namedTypeBases.set(statement.name, base);
          this.host.namedTypeBases.set(localIdentity(statement.name), base);
          const baseFields = base.kind === "named" ? this.host.fieldsOf(base.identity ?? base.name) : null;
          if (baseFields) inherited = new Map(baseFields);
          const readonly = base.kind === "named" ? this.host.readonlyFieldsOf(base.identity ?? base.name) : null;
          if (readonly) inheritedReadonly = new Set(readonly);
        }
        this.host.inheritedTypeFields.set(statement, new Set(inherited.keys()));
        for (const [name, type] of inherited) target.fields.set(name, type);
        for (const name of inheritedReadonly) target.readonlyFields.add(name);
        for (const field of statement.fields) {
          target.fields.set(field.name, this.host.resolveAnnotation(field.type));
          if (field.readonly) target.readonlyFields.add(field.name);
        }
        if (statement.readonly) {
          for (const name of target.fields.keys()) target.readonlyFields.add(name);
        }
        this.host.lowering.typeDeclarationFields.set(statement.span.start, [...target.fields].map(([name, type]) => ({ name, type })));
      });
      resolving.pop();
      resolved.add(statement.name);
    };

    for (const statement of declarations.values()) resolveDeclaration(statement);

    // The direct edge is preserved separately from the flattened fields, so a
    // cycle that crosses module boundaries cannot stabilize into an apparently
    // valid structural map during the project interface fixed point.
    for (const statement of declarations.values()) {
      if (!statement.base) continue;
      const start = localIdentity(statement.name);
      const path = [start];
      let current = start;
      const seen = new Set([start]);
      while (true) {
        const base = this.host.namedTypeBases.get(current);
        const next = base ? declarationKey(base) : null;
        if (!next) break;
        path.push(next);
        if (next === start) {
          const display = path.map((identity) => identity.replace(/^.*#type:/u, "")).join(" -> ");
          this.host.diagnostics.push(diagnostic("VEL4017", `Type inheritance is cyclic: ${display}`, statement.base.span));
          this.host.invalidDeclaredTypes.add(statement.name);
          break;
        }
        if (seen.has(next)) break;
        seen.add(next);
        current = next;
      }
    }
  }

  validateDataTypeDeclarations(program: Program): void {
    const declarations = program.body.filter((statement): statement is TypeDeclaration | TypeAliasDeclaration =>
      statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration");
    for (const declaration of declarations) {
      // D55 rule 120: a generic record's own parameters are in scope for every
      // rule that reads its field annotations, exactly as a `def`'s are inside
      // its signature.
      const withParameters = <T>(action: () => T): T => declaration.kind === "TypeDeclaration" && declaration.typeParameters?.length
        ? this.host.withTypeParameterFrame(this.host.typeParameterFrame(declaration.typeParameters), action)
        : action();
      let valid = withParameters(() => declaration.kind === "TypeAliasDeclaration"
        ? this.host.validateTypeReference(declaration.target)
        : [
          ...(declaration.base ? [this.host.validateTypeReference(declaration.base)] : []),
          ...declaration.fields.map((field) => this.host.validateTypeReference(field.type)),
        ].every(Boolean));
      if (valid && declaration.kind === "TypeDeclaration" && declaration.base) {
        withParameters(() => {
          const base = this.host.resolveAnnotation(declaration.base);
          const fields = base.kind === "named" && !base.readonlyView
            ? this.host.fieldsOf(base.identity ?? base.name)
            : null;
          if (base.kind === "named" && fields !== null && !this.host.isPrimitiveType(base.name)) return;
          this.host.typeError(
            `Type '${declaration.name}' can only extend one concrete record type; ${describeType(base)} is not a record declaration`,
            declaration.base!.span,
          );
          valid = false;
        });
      }
      if (valid) {
        withParameters(() => {
          const runtimeCheckedReferences = declaration.kind === "TypeAliasDeclaration"
            ? [declaration.target]
            : declaration.fields.map((field) => field.type);
          for (const reference of runtimeCheckedReferences) {
            if (!typeContainsRuntimeTypeCheck(this.host.resolveAnnotation(reference))) continue;
            this.host.diagnostics.push(diagnostic(
              "VEL4022",
              "Type<T> is a static runtime-Type carrier and cannot be embedded in a runtime-validated 'type'; keep it in a function, class, or ordinary value instead",
              reference.span,
            ));
            valid = false;
          }
        });
      }
      // D44 rule 72: a `readonly` field modifier and a `readonly type`
      // declaration make the same deep promise as a `readonly T` annotation,
      // so both obey the same pure-data rule.
      if (valid && declaration.kind === "TypeDeclaration") {
        withParameters(() => {
          const declaredFields = new Map(declaration.fields.map((field) => [field.name, field]));
          const fields = declaration.readonly
            ? [...(this.host.fieldsOf(this.host.namedTypeIdentities.get(declaration.name) ?? declaration.name) ?? new Map())]
              .map(([name, type]) => ({ name, type, span: declaredFields.get(name)?.span ?? declaration.span }))
            : declaration.fields.filter((field) => field.readonly)
              .map((field) => ({ name: field.name, type: this.host.resolveAnnotation(field.type), span: field.span }));
          for (const field of fields) {
            const violation = this.host.findClassInReadonlyData(field.type);
            if (!violation) continue;
            this.host.typeError(
              `'readonly' accepts only pure data at every depth; '${declaration.name}.${field.name}${violation.suffix}' is class '${violation.className}' — model it as a data record, or drop 'readonly'`,
              field.span,
            );
            valid = false;
          }
        });
      }
      if (!valid) this.host.invalidDeclaredTypes.add(declaration.name);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const declaration of declarations) {
        if (this.host.invalidDeclaredTypes.has(declaration.name)) continue;
        const syntaxes = declaration.kind === "TypeAliasDeclaration"
          ? [declaration.target.syntax]
          : [
            ...(declaration.base ? [declaration.base.syntax] : []),
            ...declaration.fields.map((field) => field.type.syntax),
          ];
        if (!syntaxes.some((syntax) => this.typeSyntaxReferencesInvalidDeclaration(syntax))) continue;
        this.host.invalidDeclaredTypes.add(declaration.name);
        changed = true;
      }
    }
  }

  validateCoreDeclarationSignatures(program: Program): void {
    const validateFunction = (
      statement: Pick<FunctionDeclaration, "typeParameters" | "parameters" | "returnType">,
      classParameters?: readonly TypeParameterDeclaration[],
    ): void => {
      this.host.withTypeParameterFrame(this.host.memberTypeParameterFrame(classParameters, statement.typeParameters), () => {
        for (const parameter of statement.parameters) {
          if (parameter.type) this.host.validateTypeReference(parameter.type);
        }
        if (statement.returnType) this.host.validateTypeReference(statement.returnType);
      });
    };
    for (const statement of program.body) {
      if (statement.kind === "VariableDeclaration") {
        if (statement.type) this.host.validateTypeReference(statement.type);
      } else if (statement.kind === "FunctionDeclaration") {
        validateFunction(statement);
      } else if (statement.kind === "ClassDeclaration") {
        // D55 rule 120 layer two: the class's own parameters are in scope for
        // every instance member and for none of the static ones, and this is
        // the pass that decides each annotation's validity once — a frame
        // missing here would freeze `T` as "Unknown type" for the whole module.
        const classParameters = statement.typeParameters?.length ? statement.typeParameters : undefined;
        const staticNames = classParameters ? new Set(classParameters.map((parameter) => parameter.name)) : null;
        const asStatic = <T>(action: () => T): T => {
          if (!staticNames) return action();
          const outer = this.host.staticMemberTypeParameters;
          this.host.staticMemberTypeParameters = { className: statement.name, names: staticNames };
          try {
            return action();
          } finally {
            this.host.staticMemberTypeParameters = outer;
          }
        };
        this.host.withTypeParameterFrame(this.host.typeParameterFrame(classParameters), () => {
          for (const parameter of statement.parameters) {
            if (parameter.type) this.host.validateTypeReference(parameter.type);
          }
          for (const field of statement.fields) {
            if (field.static) asStatic(() => this.host.withTypeParameterFrame(new Map(), () => this.host.validateTypeReference(field.type)));
            else this.host.validateTypeReference(field.type);
          }
          for (const getter of statement.getters) {
            if (getter.static) asStatic(() => validateFunction(getter));
            else validateFunction(getter, classParameters);
          }
          for (const method of statement.methods) {
            if (method.static) asStatic(() => validateFunction(method));
            else validateFunction(method, classParameters);
          }
        });
      }
    }
  }

  typeSyntaxReferencesInvalidDeclaration(syntax: TypeSyntax): boolean {
    switch (syntax.kind) {
      case "NamedTypeSyntax":
        return this.host.invalidDeclaredTypes.has(syntax.name);
      case "EnumMemberTypeSyntax":
        return (syntax.arguments ?? []).some((argument) => this.typeSyntaxReferencesInvalidDeclaration(argument));
      case "GenericTypeSyntax":
        return syntax.arguments.some((argument) => this.typeSyntaxReferencesInvalidDeclaration(argument));
      case "ReadonlyTypeSyntax":
      case "OptionalTypeSyntax":
        return this.typeSyntaxReferencesInvalidDeclaration(syntax.inner);
      case "UnionTypeSyntax":
        return syntax.members.some((member) => this.typeSyntaxReferencesInvalidDeclaration(member));
      case "FunctionTypeSyntax":
        return syntax.parameters.some((parameter) => this.typeSyntaxReferencesInvalidDeclaration(parameter.type))
          || this.typeSyntaxReferencesInvalidDeclaration(syntax.result);
    }
  }

  rejectUnproductiveRecursiveTypes(program: Program): void {
    const declarations = new Map(program.body
      .filter((statement) => statement.kind === "TypeDeclaration")
      .map((statement) => [statement.name, statement]));
    const productive = new Set<string>();
    const typeIsProductive = (source: ValueType): boolean => {
      const type = this.host.expandAliases(source);
      // D55: an instantiation stands for its declaration here — `Tree<T>` is
      // productive exactly when `Tree` is, and the finite-value question is the
      // same question for every argument it could be applied to.
      if (type.kind === "named" && type.application) {
        const name = type.application.name;
        return !declarations.has(name) || productive.has(name);
      }
      if (type.kind === "named") return !declarations.has(type.name) || productive.has(type.name);
      if (type.kind === "union") return type.members.some(typeIsProductive);
      if (type.kind === "object") return [...type.fields.values()].every(typeIsProductive);
      if (type.kind === "optional" || type.kind === "list" || type.kind === "set" || type.kind === "map" || type.kind === "record" || type.kind === "promise") return true;
      return true;
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name] of declarations) {
        if (productive.has(name)) continue;
        const fields = this.host.namedTypes.get(name) ?? this.host.genericTypes.get(name)?.fields;
        if (fields && [...fields.values()].every(typeIsProductive)) {
          productive.add(name);
          changed = true;
        }
      }
    }
    for (const [name, declaration] of declarations) {
      if (!productive.has(name)) this.host.diagnostics.push(diagnostic("VEL4009", `Recursive type '${name}' cannot construct a finite value; add an optional, collection, or terminating union path`, declaration.span));
    }
  }

  analyzeTypeDeclaration(statement: TypeDeclaration): void {
    if (!this.host.predeclared.has(statement)) this.host.declareTypeNameBinding(statement.name, { kind: "typeObject", name: statement.name }, statement.span, "type");
    // D55 rule 124: the parameter-list rules — duplicate names, a reserved
    // bound name used as a parameter, shadowing a declared type, an unknown
    // bound — are about the list and not about which declaration carries it,
    // so a `type` is judged by the same procedure a `def` is.
    this.host.checkTypeParameterDeclarations(statement.typeParameters);
    const seen = new Set<string>();
    const inherited = this.host.inheritedTypeFields.get(statement) ?? new Set<string>();
    for (const field of statement.fields) {
      if (inherited.has(field.name)) {
        this.host.diagnostics.push(diagnostic(
          "VEL4004",
          `Type '${statement.name}' cannot redeclare inherited field '${field.name}'; inherited record fields keep their original contract`,
          field.span,
        ));
      }
      if (seen.has(field.name)) {
        this.host.diagnostics.push(diagnostic("VEL4004", `Type '${statement.name}' declares '${field.name}' more than once`, field.span));
      }
      seen.add(field.name);
    }
  }

  /**
   * D51 rule 109: `Comparable`, `Text`, and `Data` are the compiler's own
   * closed bound vocabulary (D41 item 61). A user type of the same name used to
   * be accepted and then silently ignored at every `<T: Data>` — the bound won,
   * so `save(42)` passed a function whose author had declared a record. The
   * name is rejected where it is introduced, which is the only place a rename
   * is cheap; the use site could only report an ambiguity nobody can fix.
   *
   * `Text` is also a reserved Core binding, so `class Text:` earned this
   * sentence and the binding's as well — two reports for one mistake. This one
   * says *why* the name is taken, so it marks the name refused and the general
   * one stays silent.
   */
  rejectReservedTypeNames(program: Program): void {
    const vocabulary = typeParameterBoundNames.join(", ");
    const reject = (name: string, errorSpan: Span, noun: string): void => {
      if (!isTypeParameterBound(name)) return;
      this.host.markTypeNameRefused(name);
      this.host.diagnostics.push(diagnostic(
        "VEL4021",
        `'${name}' is a reserved type-parameter bound — the bounds are ${vocabulary} — so it cannot also name ${/^[aeiou]/iu.test(noun) ? "an" : "a"} ${noun}; rename this declaration`,
        errorSpan,
      ));
    };
    for (const statement of program.body) {
      switch (statement.kind) {
        case "TypeDeclaration":
        case "TypeAliasDeclaration":
          reject(statement.name, statement.span, "type");
          break;
        case "ClassDeclaration":
          reject(statement.name, statement.span, "class");
          break;
        case "EnumDeclaration":
          reject(statement.name, statement.span, "enum");
          break;
        case "ExternModuleDeclaration":
          for (const declaration of statement.classes) reject(declaration.name, declaration.span, "extern class");
          break;
        case "ImportDeclaration":
          for (const specifier of statement.specifiers) {
            reject(specifier.local, statement.span, specifier.local === specifier.imported ? "imported name" : "import alias");
          }
          break;
        default:
          break;
      }
    }
  }
}
