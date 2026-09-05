/**
 * What a class name stands for: its shape table, its type parameters, the
 * instantiations of it a module reaches, and the extern classes a foreign
 * module declares.
 *
 * D114 R1d: the registration half of the class cluster. `classes`,
 * `classApplications`, `classInstantiations` and `classDeclarations` stay
 * fields of `Analyzer` — every other cluster reads them — and arrive here
 * through the shared class host.
 */
import {
  type ClassDeclaration,
  type ClassIterateBlock,
  type Expression,
  type FunctionDeclaration,
  type Program,
  type Statement,
  type TypeParameterDeclaration,
  type TypeReference,
} from "../../ast.ts";
import { type ClassField, type ClassInfo } from "../../contracts.ts";
import { diagnostic, type Diagnostic } from "../../diagnostic.ts";
import {
  classApplicationType,
  genericApplicationIdentity,
  substituteTypeParameters,
  unknownType,
  type GenericApplication,
  type TypeParameterBound,
  type ValueType,
} from "../../types.ts";
import { type GenericDeclarations } from "../declarations/generics.ts";
import { blockContainsDirectAwait } from "../../ast.ts";

/**
 * Everything this half of the class cluster asks of the analyzer that hosts
 * it. The four halves share one host object; the union of their interfaces is
 * what the analyzer builds.
 */
export interface ClassRegistryHost {
  readonly classApplications: Map<string, GenericApplication>;
  readonly classDeclarations: Map<string, ClassDeclaration>;
  readonly classInstantiations: Map<string, ClassInfo>;
  classShapesRegistered: boolean;
  readonly classes: Map<string, ClassInfo>;
  readonly diagnostics: Diagnostic[];
  extensionExpressionContainsDirectAwait(expression: Expression, contains: (expression: Expression) => boolean): boolean | undefined;
  extensionStatementContainsDirectAwait(statement: Statement, containsExpression: (expression: Expression) => boolean, containsBlock: (statements: readonly Statement[]) => boolean): boolean | undefined;
  readonly externClassDeclarations: Map<string, ReadonlySet<string>>;
  functionType(statement: FunctionDeclaration, classParameters?: readonly TypeParameterDeclaration[]): ValueType;
  readonly generics: GenericDeclarations;
  readonly invalidExternTypeReferences: WeakSet<TypeReference>;
  readonly privateFields: Map<string, Map<string, ClassField>>;
  readonly privateGetters: Map<string, Set<string>>;
  readonly privateMethods: Map<string, Map<string, ValueType>>;
  readonly privateStaticFields: Map<string, Map<string, ClassField>>;
  readonly privateStaticGetters: Map<string, Set<string>>;
  readonly privateStaticMethods: Map<string, Map<string, ValueType>>;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  resolveExternAnnotation(reference: TypeReference | null, source: string, classNames: ReadonlySet<string>): ValueType;
  resolveValidatedAnnotation(reference: TypeReference | null): ValueType;
  resolveValidatedResult(reference: TypeReference | null): ValueType;
  seededIterationInfo(block: ClassIterateBlock): { readonly iterate: ValueType } | { readonly iterateAsync: ValueType };
  staticMemberTypeParameters: { readonly className: string; readonly names: ReadonlySet<string> } | null;
  typeParameterBoundVector(declarations: readonly TypeParameterDeclaration[] | undefined): readonly (TypeParameterBound | null)[] | null;
  typeParameterFrame(declarations: readonly TypeParameterDeclaration[] | undefined): ReadonlyMap<string, ValueType>;
  readonly typeParameterFrames: ReadonlyMap<string, ValueType>[];
  validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean;
  withTypeParameterFrame<T>(frame: ReadonlyMap<string, ValueType>, action: () => T): T;
}

export class ClassRegistry {
  private readonly host: ClassRegistryHost;

  constructor(host: ClassRegistryHost) {
    this.host = host;
  }

  registerClassNames(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ClassDeclaration") continue;
      // D55 rule 120 layer two: the declaration is recorded even when the name
      // is already taken, because the type parameters a member is resolved
      // under come from the declaration being read, not from whichever entry
      // won the name.
      this.host.classDeclarations.set(statement.name, statement);
      if (this.host.classes.has(statement.name)) continue;
      this.host.classes.set(statement.name, {
        ...this.classTypeParameterFacts(statement),
        parameters: [],
        requiredParameters: 0,
        base: statement.base?.name ?? null,
        abstract: statement.abstract,
        fields: new Map(),
        getters: new Set(),
        abstractGetters: new Set(),
        methods: new Map(),
        abstractMethods: new Set(),
        staticFields: new Map(),
        staticGetters: new Set(),
        staticMethods: new Map(),
      });
    }
  }

  /** D55 rule 120 layer two: the declared parameter list of a class, as the class entry carries it. */
  classTypeParameterFacts(statement: ClassDeclaration): {
    readonly typeParameterNames?: readonly string[];
    readonly typeParameterBounds?: readonly (TypeParameterBound | null)[];
  } {
    if (!statement.typeParameters?.length) return {};
    const frame = this.host.typeParameterFrame(statement.typeParameters);
    const bounds = this.host.typeParameterBoundVector(statement.typeParameters);
    return {
      typeParameterNames: [...frame.keys()],
      ...(bounds ? { typeParameterBounds: bounds } : {}),
    };
  }

  /** The class type parameters in scope for a member of `className`, or undefined outside a generic class. */
  classTypeParameterDeclarations(className: string | null): readonly TypeParameterDeclaration[] | undefined {
    if (!className) return undefined;
    const declared = this.host.classDeclarations.get(className)?.typeParameters;
    return declared?.length ? declared : undefined;
  }

  /**
   * D55 rule 120 layer two: the frame a class member is resolved under. The
   * member's own parameters take the low indexes and the class's take the ones
   * above them, so a method may declare `<U>` beside the class's `<T>` and the
   * two never share a De Bruijn index. The order matters and is this way round
   * for one reason: a callable's `typeParameterNames` must line up with index
   * 0 upward, and only the member's own parameters belong on that list — the
   * class's are fixed by the receiver, not solved at the call. Everything above
   * `typeParameterNames.length` is therefore a class parameter, in every
   * member, whatever its own arity, which is what lets one substitution rule
   * serve them all (`substituteClassMemberType`).
   */
  memberTypeParameterFrame(
    classParameters: readonly TypeParameterDeclaration[] | undefined,
    ownParameters: readonly TypeParameterDeclaration[] | undefined,
  ): ReadonlyMap<string, ValueType> {
    if (!classParameters?.length) return this.host.typeParameterFrame(ownParameters);
    return this.host.typeParameterFrame([...ownParameters ?? [], ...classParameters]);
  }

  registerClassShapes(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ClassDeclaration") {
        continue;
      }
      // D55 rule 120 layer two: every member of a generic class is read under
      // the class's own parameters, and every static member is read without
      // them — a static member belongs to the class, not to an instantiation.
      this.host.withTypeParameterFrame(this.host.typeParameterFrame(statement.typeParameters), () => {
        this.registerClassShape(statement);
      });
    }
    this.host.classShapesRegistered = true;
  }

  registerClassShape(statement: ClassDeclaration): void {
    {
      const classParameters = this.classTypeParameterDeclarations(statement.name);
      const staticNames = classParameters ? new Set(classParameters.map((parameter) => parameter.name)) : null;
      const withoutClassParameters = <T>(action: () => T): T => {
        if (!staticNames) return action();
        const outer = this.host.staticMemberTypeParameters;
        this.host.staticMemberTypeParameters = { className: statement.name, names: staticNames };
        try {
          return this.host.withTypeParameterFrame(new Map(), action);
        } finally {
          this.host.staticMemberTypeParameters = outer;
        }
      };
      const fields = new Map<string, ClassField>();
      const staticFields = new Map<string, ClassField>();
      const privateFields = new Map<string, ClassField>();
      const privateStaticFields = new Map<string, ClassField>();
      const getters = new Set<string>();
      const abstractGetters = new Set<string>();
      const staticGetters = new Set<string>();
      const privateGetters = new Set<string>();
      const privateStaticGetters = new Set<string>();
      for (const parameter of statement.parameters) {
        if (parameter.binding) {
          (parameter.private ? privateFields : fields).set(parameter.name, {
            mutable: parameter.binding === "let",
            type: this.host.resolveValidatedAnnotation(parameter.type),
          });
        }
      }
      for (const field of statement.fields) {
        const target = field.private
          ? field.static ? privateStaticFields : privateFields
          : field.static ? staticFields : fields;
        target.set(field.name, {
          mutable: field.binding === "let",
          type: field.static
            ? withoutClassParameters(() => this.host.resolveValidatedAnnotation(field.type))
            : this.host.resolveValidatedAnnotation(field.type),
        });
      }
      for (const getter of statement.getters) {
        const target = getter.private
          ? getter.static ? privateStaticFields : privateFields
          : getter.static ? staticFields : fields;
        target.set(getter.name, {
          mutable: false,
          type: getter.static
            ? withoutClassParameters(() => this.host.resolveValidatedResult(getter.returnType))
            : this.host.resolveValidatedResult(getter.returnType),
        });
        if (getter.private) (getter.static ? privateStaticGetters : privateGetters).add(getter.name);
        else if (getter.static) staticGetters.add(getter.name);
        else {
          getters.add(getter.name);
          if (getter.abstract) abstractGetters.add(getter.name);
        }
      }
      const methods = new Map<string, ValueType>();
      const abstractMethods = new Set<string>();
      const staticMethods = new Map<string, ValueType>();
      const privateMethods = new Map<string, ValueType>();
      const privateStaticMethods = new Map<string, ValueType>();
      for (const method of statement.methods) {
        const type = method.static
          ? withoutClassParameters(() => this.host.functionType(method))
          : this.classMethodType(statement, method);
        if (method.private) (method.static ? privateStaticMethods : privateMethods).set(method.name, type);
        else if (method.static) staticMethods.set(method.name, type);
        else {
          methods.set(method.name, type);
          if (method.abstract) abstractMethods.add(method.name);
        }
      }
      this.host.privateFields.set(statement.name, privateFields);
      this.host.privateGetters.set(statement.name, privateGetters);
      this.host.privateMethods.set(statement.name, privateMethods);
      this.host.privateStaticFields.set(statement.name, privateStaticFields);
      this.host.privateStaticGetters.set(statement.name, privateStaticGetters);
      this.host.privateStaticMethods.set(statement.name, privateStaticMethods);
      const baseApplication = this.resolvedClassBaseApplication(statement);
      this.host.classes.set(statement.name, {
        ...this.classTypeParameterFacts(statement),
        ...(baseApplication ? { baseApplication } : {}),
        base: baseApplication
          ? genericApplicationIdentity(baseApplication.declaration, baseApplication.arguments)
          : statement.base?.name ?? null,
        ...(statement.dispose
          ? {
            dispose: blockContainsDirectAwait(
              statement.dispose.body,
              (expression, contains) => this.host.extensionExpressionContainsDirectAwait(expression, contains),
              (owned, containsExpression, containsBlock) => this.host.extensionStatementContainsDirectAwait(owned, containsExpression, containsBlock),
            ) ? "async" : "sync",
          }
          : {}),
        // D68 rule 177: `@iterate:` carries no annotation, so its answer comes
        // from the body — the same shape as an omitted function result, and it
        // rides the same seeded convergence passes. The shape pre-pass seeds
        // what the previous pass learned so a use written above the class sees
        // the real collection instead of the placeholder. D90 R18: an optional
        // seed is the asynchronous pull form — a collection can never validate
        // to `T?` — so the seed's shape says which field it belongs in.
        ...(statement.iterate ? this.host.seededIterationInfo(statement.iterate) : {}),
        parameters: statement.parameters.map((parameter) => this.host.resolveValidatedAnnotation(parameter.type)),
        parameterNames: statement.parameters.map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.defaultValue).length,
        abstract: statement.abstract,
        fields,
        getters,
        abstractGetters,
        methods,
        abstractMethods,
        staticFields,
        staticGetters,
        staticMethods,
      });
    }
  }

  /**
   * D55 rule 120 layer two: the class entry behind a key, building the
   * instantiation the key names if that is what it is. Every question about a
   * class member goes through here rather than through `this.host.classes`, so a
   * generic class's members can never be read with their parameters still in
   * them.
   */
  classInfo(key: string): ClassInfo | undefined {
    return this.host.classes.get(key) ?? this.host.classInstantiations.get(key) ?? this.buildClassInstantiation(key);
  }

  /** Records an instantiation so `classInfo` can build its member table when asked. */
  noteClassApplication(identity: string, application: GenericApplication): void {
    if (!this.host.classApplications.has(identity)) this.host.classApplications.set(identity, application);
  }

  /**
   * D55 rule 121's mechanism on the class side: an instantiation's member table
   * is the declaration's with the arguments substituted, keyed by the
   * instantiation's own identity. Building it on demand rather than where the
   * application was written is what makes `class Node<T>: let next: Node<T>?`
   * terminate — the application is noted while the declaration is still being
   * read, and substituted only once someone asks.
   */
  buildClassInstantiation(identity: string): ClassInfo | undefined {
    const application = this.host.classApplications.get(identity);
    if (!application) return undefined;
    const template = this.host.classes.get(application.declaration) ?? this.host.classes.get(application.name);
    const names = template?.typeParameterNames;
    if (!template || !names?.length) return undefined;
    const bindings = names.map((_, index) => application.arguments[index] ?? unknownType);
    const map = (type: ValueType): ValueType => {
      const substituted = this.substituteClassMemberType(type, bindings);
      this.host.generics.noteGenericApplications(substituted);
      return substituted;
    };
    const baseApplication = template.baseApplication
      ? { ...template.baseApplication, arguments: template.baseApplication.arguments.map(map) }
      : undefined;
    const base = baseApplication
      ? genericApplicationIdentity(baseApplication.declaration, baseApplication.arguments)
      : template.base;
    const { typeParameterNames: _names, typeParameterBounds: _bounds, ...rest } = template;
    const info: ClassInfo = {
      ...rest,
      identity,
      application,
      base,
      ...(baseApplication ? { baseApplication } : {}),
      parameters: template.parameters.map(map),
      ...(template.constructorRest ? { constructorRest: map(template.constructorRest) } : {}),
      ...(template.iterate ? { iterate: map(template.iterate) } : {}),
      ...(template.iterateAsync ? { iterateAsync: map(template.iterateAsync) } : {}),
      fields: new Map([...template.fields].map(([name, field]) => [name, { ...field, type: map(field.type) }])),
      methods: new Map([...template.methods].map(([name, type]) => [name, map(type)])),
    };
    if (baseApplication && base) this.noteClassApplication(base, baseApplication);
    // The shape pass has to have finished before an instantiation is worth
    // keeping: one built from a placeholder entry would freeze an empty member
    // table under a real identity.
    if (this.host.classShapesRegistered) this.host.classInstantiations.set(identity, info);
    return info;
  }

  /**
   * Substitutes the class's own type arguments into one member type. A method
   * that declares its own `<U>` carries both lists — the class's first — so the
   * substitution replaces the class's indexes and renumbers the method's own
   * back down to zero, which is exactly what makes `Stack<number>.mapTo<U>`
   * a one-parameter generic method again.
   */
  substituteClassMemberType(type: ValueType, bindings: readonly ValueType[]): ValueType {
    if ((type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") && type.typeParameterNames?.length) {
      // The member's own parameters keep their indexes exactly — they are the
      // ones the call still solves — and the class's, which start where the
      // published list ends, take the arguments. Nothing is renumbered, so the
      // method stays the same generic method it was declared as.
      const own = type.typeParameterNames;
      const table: ValueType[] = [
        ...own.map((name, index): ValueType => ({ kind: "parameter", name, index })),
        ...bindings,
      ];
      return {
        ...type,
        parameters: type.parameters.map((parameter) => substituteTypeParameters(parameter, table)),
        ...(type.rest ? { rest: substituteTypeParameters(type.rest, table) } : {}),
        result: substituteTypeParameters(type.result, table),
      };
    }
    return substituteTypeParameters(type, bindings);
  }

  /**
   * D55 rule 120 layer two: `self` inside a generic class is that class at its
   * own parameters. The arguments are read out of the frame in force here,
   * because a class parameter's index depends on how many the member itself
   * declared — which is exactly what makes `self.push(value)` compare `T`
   * against the same `T` the annotation resolved to.
   */
  selfClassType(className: string): ValueType {
    const info = this.host.classes.get(className);
    const names = info?.typeParameterNames;
    if (!names?.length) return { kind: "class", name: className };
    const frame = this.host.typeParameterFrames.at(-1);
    const arguments_ = names.map((name, index): ValueType => frame?.get(name) ?? { kind: "parameter", name, index });
    const type = classApplicationType(info?.identity ?? className, className, arguments_);
    this.host.generics.noteGenericApplications(type);
    return type;
  }

  /** The method type of a class member, read under the class's type parameters as well as its own. */
  classMethodType(statement: ClassDeclaration, method: ClassDeclaration["methods"][number]): ValueType {
    return this.host.functionType(method, statement.typeParameters);
  }

  /**
   * D55 rule 120 layer two: `extends Stack<number>` resolved under this class's
   * own parameters, so `class MyStack<T> extends Stack<T>` passes them through
   * and instantiating `MyStack<number>` reaches `Stack<number>`.
   */
  resolvedClassBaseApplication(statement: ClassDeclaration): GenericApplication | undefined {
    const base = statement.base;
    if (!base?.typeArguments?.length) return undefined;
    const declaration = this.host.classes.get(base.name)?.identity ?? base.name;
    const arguments_ = base.typeArguments.map((syntax) => this.host.resolveAnnotation({ syntax, span: syntax.span }));
    const application: GenericApplication = { declaration, name: base.name, arguments: arguments_ };
    this.noteClassApplication(genericApplicationIdentity(declaration, arguments_), application);
    return application;
  }

  /** The arguments a receiver's chain applies to one declaration in it. */
  classApplicationFor(receiverKey: string, declarationKey: string): GenericApplication | null {
    let current: string | null = receiverKey;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const info = this.classInfo(current);
      if (!info) return null;
      const application = info.application;
      if (application && (application.declaration === declarationKey || application.name === declarationKey)) return application;
      current = info.base;
    }
    return null;
  }

  registerExternClassDeclarations(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration") continue;
      for (const declaration of statement.classes) {
        const sources = new Set(this.host.externClassDeclarations.get(declaration.name));
        sources.add(statement.source);
        this.host.externClassDeclarations.set(declaration.name, sources);
      }
    }
  }

  validateExternDeclarations(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration") continue;
      const classNames = new Set(statement.classes.map((declaration) => declaration.name));
      const validate = (reference: TypeReference | null): boolean => {
        if (!reference) return true;
        const valid = this.host.validateTypeReference(reference, (value) => this.host.resolveExternAnnotation(value, statement.source, classNames));
        if (!valid) this.host.invalidExternTypeReferences.add(reference);
        return valid;
      };
      for (const declaration of statement.classes) {
        for (const parameter of declaration.parameters) validate(parameter.type);
        for (const field of declaration.fields) validate(field.type);
        for (const getter of declaration.getters) validate(getter.type);
        for (const method of declaration.methods) {
          if (!method.returnType) {
            this.host.diagnostics.push(diagnostic(
              "VEL4023",
              `Extern method '${method.name}' requires an explicit result annotation; write '-> null' when it has no result`,
              method.signatureSpan,
            ));
          }
          this.host.withTypeParameterFrame(this.host.typeParameterFrame(method.typeParameters), () => {
            for (const parameter of method.parameters) validate(parameter.type);
            validate(method.returnType);
          });
        }
      }
      for (const declaration of statement.functions) {
        if (!declaration.returnType) {
          this.host.diagnostics.push(diagnostic(
            "VEL4023",
            `Extern function '${declaration.name}' requires an explicit result annotation; write '-> null' when it has no result`,
            declaration.signatureSpan,
          ));
        }
        this.host.withTypeParameterFrame(this.host.typeParameterFrame(declaration.typeParameters), () => {
          for (const parameter of declaration.parameters) validate(parameter.type);
          validate(declaration.returnType);
        });
      }
      for (const declaration of statement.constants) validate(declaration.type);
    }
  }
}
