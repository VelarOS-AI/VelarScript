/**
 * A class body, member by member: the analysis pass over fields, getters,
 * methods and the constructor, the private member tables, and the lookups that
 * answer "does this class publish this name".
 *
 * D114 R1d: the member half of the class cluster.
 */
import {
  type ClassDeclaration,
  type ClassDisposeBlock,
  type ClassIterateBlock,
  type Expression,
  type Statement,
  type TypeParameterDeclaration,
  type TypeReference,
} from "../../ast.ts";
import { type ClassField, type ClassInfo } from "../../contracts.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";
import {
  describeType,
  invalidType,
  nullType,
  sameType,
  sameTypeIgnoringCallableParameterNames,
  type ValueType,
} from "../../types.ts";
import { type GenericDeclarations } from "../declarations/generics.ts";
import { VELAR_HOST_ERROR_NAMES } from "../../error-runtime.ts";
import {
  type AnalyzableFunctionDeclaration,
  asyncResultAnnotationMessage,
  isExternClassIdentity,
  type ReturnContext,
} from "../functions.ts";
import { type Binding, type BuiltinTypeNamePosition, type MutableCellTarget } from "../scopes.ts";

/**
 * Everything this half of the class cluster asks of the analyzer that hosts
 * it. The four halves share one host object; the union of their interfaces is
 * what the analyzer builds.
 */
export interface ClassMembersHost {
  allowedSuperCall: string | null;
  analyzeClassDispose(statement: ClassDeclaration, block: ClassDisposeBlock): void;
  analyzeClassIterate(statement: ClassDeclaration, block: ClassIterateBlock, baseName: string | null): void;
  analyzeFunctionDeclaration(statement: AnalyzableFunctionDeclaration, className: string | null, method?: boolean, declareSelf?: boolean, forceAsynchronous?: boolean, declarationKind?: string): void;
  analyzeStatements(statements: readonly Statement[]): void;
  asyncResultContainsPromise(type: ValueType): boolean;
  readonly asynchronousFunctions: boolean[];
  builtin(name: string): Binding | null;
  checkDisposalChain(statement: ClassDeclaration, baseName: string | null): void;
  checkTypeParameterDeclarations(declarations: readonly TypeParameterDeclaration[] | undefined): void;
  classFieldInitializerDepth: number;
  classInfo(key: string): ClassInfo | undefined;
  classMethodType(statement: ClassDeclaration, method: ClassDeclaration["methods"][number]): ValueType;
  readonly classes: Map<string, ClassInfo>;
  constructorDepth: number;
  readonly constructorFieldInitializations: Set<number>;
  currentClass: string | null;
  declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span, internal?: boolean, declaredType?: ValueType, importSource?: string, typeNamePosition?: BuiltinTypeNamePosition): void;
  declareTypeNameBinding(name: string, type: ValueType, declarationSpan: Span, position: BuiltinTypeNamePosition): void;
  readonly diagnostics: Diagnostic[];
  enterScope(): void;
  exitScope(): void;
  finallyLoopDepths: number[];
  findField(className: string, name: string): ClassField | null;
  findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findStaticField(className: string, name: string): ClassField | null;
  findStaticGetter(className: string, name: string): ValueType | null;
  findStaticMethod(className: string, name: string): ValueType | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  flowFrameDepth: number;
  functionDepth: number;
  readonly generics: GenericDeclarations;
  readonly hoistedClassDeclarations: Map<Binding, number>;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferParameterDefault(expression: Expression, contextualType?: ValueType): ValueType;
  instanceFieldInitializerDepth: number;
  isSubclassOf(actual: string, expected: string): boolean;
  lookup(name: string): Binding | null;
  loopDepth: number;
  readonly predeclared: WeakSet<object>;
  reportImplicitSelfParameter(parameters: readonly { readonly name: string; readonly span: Span }[], index: number): void;
  reportPromiseCarrierHazard(type: ValueType, errorSpan: Span): void;
  reportPromiseResolutionHazard(type: ValueType, errorSpan: Span): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  resolveResult(reference: TypeReference | null): ValueType;
  readonly returnContexts: ReturnContext[];
  selfClassType(className: string): ValueType;
  staticFieldInitialization: {
    readonly className: string;
    readonly initialized: ReadonlySet<string>;
  } | null;
  superMemberContext: "instance" | "static" | null;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  typeParameterFrame(declarations: readonly TypeParameterDeclaration[] | undefined): ReadonlyMap<string, ValueType>;
  unimplementedAbstractMethods(className: string): string[];
  unreachableDiagnosticDepth: number;
  validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean;
  withTypeParameterFrame<T>(frame: ReadonlyMap<string, ValueType>, action: () => T): T;
}

export class ClassMembers {
  private readonly host: ClassMembersHost;

  constructor(host: ClassMembersHost) {
    this.host = host;
  }

  analyzeClassDeclaration(statement: ClassDeclaration): void {
    // D55 rule 120 layer two: the same list, the same procedure — duplicate
    // names, reserved bound words, and a name that shadows a declared type are
    // about the list, not about which declaration carries it.
    this.host.checkTypeParameterDeclarations(statement.typeParameters);
    this.host.withTypeParameterFrame(this.host.typeParameterFrame(statement.typeParameters), () => {
      this.analyzeClassBody(statement);
    });
  }

  analyzeClassBody(statement: ClassDeclaration): void {
    const outerConstructorDepth = this.host.constructorDepth;
    const outerClass = this.host.currentClass;
    const outerSuperMemberContext = this.host.superMemberContext;
    const outerAllowedSuperCall = this.host.allowedSuperCall;
    this.host.constructorDepth = 0;
    this.host.allowedSuperCall = null;
    this.host.currentClass = statement.name;
    this.host.superMemberContext = null;
    for (const member of [...statement.fields, ...statement.getters, ...statement.methods]) {
      this.validateClassMemberName(member.name, member.span);
    }
    if (!this.host.predeclared.has(statement)) this.host.declareTypeNameBinding(statement.name, { kind: "classConstructor", name: statement.name }, statement.span, "class");
    const baseName = statement.base?.name ?? null;
    // D55 rule 120 layer two: every inherited-member question is asked of the
    // base *instantiation*, so `override def push(value: number)` is compared
    // against `push(value: T)` with T already solved to `number`.
    const baseKey = this.host.classInfo(statement.name)?.base ?? baseName;
    if (statement.base) this.host.generics.checkGenericClassBase(statement, statement.base);
    if (baseName) this.checkBaseClass(statement, baseName, baseKey);

    this.analyzeInstanceScope(statement, baseKey);
    this.analyzeStaticFieldInitializers(statement);

    const ownFields = this.checkInstanceFieldContracts(statement, baseKey);

    const ownStaticFields = this.checkStaticFieldContracts(statement, baseKey);

    this.rejectDuplicatePrivateMembers(statement);

    this.analyzeGetters(statement, baseKey, ownFields, ownStaticFields);

    this.analyzeMethods(statement, baseKey, ownFields, ownStaticFields);

    this.checkAbstractCoverage(statement);
    this.host.constructorDepth = outerConstructorDepth;
    this.host.allowedSuperCall = outerAllowedSuperCall;
    this.host.currentClass = outerClass;
    this.host.superMemberContext = outerSuperMemberContext;
  }

  /**
   * D51 item NEW-D7: `name`, `code`, `message`, `stack`, and `cause` are the
   * Error contract's own members, not names a subclass may reuse. The generic
   * inherited-field check let a `const` through whenever it restated the same
   * type — and that spelling forged `code` (charter 2070 promises `code` and
   * `name` never disagree) or silently discarded the constructed message.
   */
  /** The five ways an `extends` clause can name something it may not extend. */
  private checkBaseClass(statement: ClassDeclaration, baseName: string, baseKey: string | null): void {
    const baseBinding = this.host.lookup(baseName) ?? this.host.builtin(baseName);
    if (baseName === "ValidationError" || baseName === "AssertionError" || baseName === "NarrowingError"
      || baseName === "IndexError"
      || (VELAR_HOST_ERROR_NAMES as readonly string[]).includes(baseName)) {
      // The compiler-raised error types are leaf contracts: user subclasses
      // would dilute what a caught ValidationError/AssertionError/
      // NarrowingError/IndexError proves. Extend Error for custom
      // hierarchies.
      this.host.typeError(`The builtin error type '${baseName}' cannot be extended; extend Error and declare your own fields`, statement.base!.span);
    } else if (baseBinding?.type.kind === "classConstructor" && !this.host.classes.has(baseName)
      && isExternClassIdentity(baseBinding.type.identity ?? null)) {
      // D45 rule 78 (CLS-I4): the name resolves perfectly well — it is an
      // extern class, and extending one would need a construction chain
      // across the JavaScript bridge. Section 19 lists the absence; the
      // author needs the shape that does work, not "Unknown base class",
      // which reads as a typo.
      this.host.typeError(
        `Extern class '${baseName}' cannot be extended; wrap the instance by composition — hold it in a field and expose the behavior as methods or functions`,
        statement.base!.span,
      );
    } else if (baseBinding?.type.kind !== "classConstructor" || !this.host.classes.has(baseName)) {
      this.host.typeError(`Unknown base class '${baseName}'`, statement.base!.span);
    } else if (baseName === statement.name || this.host.isSubclassOf(baseName, statement.name)) {
      this.host.typeError(`Class '${statement.name}' has a cyclic inheritance relationship`, statement.base!.span);
    } else {
      // `extends` evaluates the base when this class statement runs, so a
      // base declared later in the module would fail to load (CLS-D8).
      const baseDeclaredAt = this.host.hoistedClassDeclarations.get(baseBinding.storageBinding ?? baseBinding);
      if (baseDeclaredAt !== undefined && baseDeclaredAt > statement.span.start) {
        this.host.diagnostics.push(diagnostic(
          "VEL3001",
          `Class '${statement.name}' extends '${baseName}' before it is declared; move '${baseName}' above this class`,
          statement.base!.span,
        ));
      }
    }
  }

  /** The instance scope: constructor parameters, field initializers, `init`, `@dispose`, `@iterate`. */
  private analyzeInstanceScope(statement: ClassDeclaration, baseKey: string | null): void {
    this.host.enterScope();
    this.host.flowFrameDepth += 1;
    this.host.superMemberContext = "instance";
    for (const [index, parameter] of statement.parameters.entries()) {
      // D89 (message correction): `constructor(self, ...)` is the same Python
      // receiver reflex a method's `self` parameter is, and it used to land on
      // the bare reserved-binding refusal, which names no fix. A field-binding
      // spelling (`const self`) is excluded because its `const`/`private`
      // prefix sits outside the parameter span, so the deletion this report
      // carries would leave the prefix stranded — and D38 §48 admits only
      // rewrites that land on working source.
      if (parameter.name === "self" && !parameter.rest && parameter.binding === null && statement.initialization !== null) {
        this.host.reportImplicitSelfParameter(statement.parameters, index);
        continue;
      }
      const type = this.host.resolveAnnotation(parameter.type);
      const valid = parameter.type ? this.host.validateTypeReference(parameter.type) : true;
      if (parameter.defaultValue && valid) {
        this.host.requireAssignable(this.host.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      const declared = valid ? type : invalidType;
      this.host.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: declared } : declared, parameter.span);
    }
    if (statement.base?.arguments.length) {
      this.host.typeError("Base constructor arguments belong in 'super(...)' inside the constructor", statement.base.span);
    }
    for (const field of statement.fields) {
      if (field.static) continue;
      const declared = this.host.resolveAnnotation(field.type);
      const valid = this.host.validateTypeReference(field.type);
      if (field.initializer) {
        this.host.classFieldInitializerDepth += 1;
        // Instance field initializers run per construction, not while the
        // module evaluates, so they are not module-initialization positions.
        this.host.instanceFieldInitializerDepth += 1;
        const actual = this.host.inferExpression(field.initializer, valid ? declared : invalidType);
        this.host.instanceFieldInitializerDepth -= 1;
        this.host.classFieldInitializerDepth -= 1;
        if (valid) this.host.requireAssignable(actual, declared, field.initializer.span);
      }
    }
    this.validateConstructorShape(statement);
    if (statement.initialization) this.analyzeClassInitialization(statement);
    if (statement.dispose) {
      this.host.analyzeClassDispose(statement, statement.dispose);
      this.host.checkDisposalChain(statement, baseKey);
    }
    if (statement.iterate) this.host.analyzeClassIterate(statement, statement.iterate, baseKey);
    this.host.superMemberContext = null;
    this.host.flowFrameDepth -= 1;
    this.host.exitScope();
  }

  /** Static fields evaluate in declaration order, and each may read the ones above it. */
  private analyzeStaticFieldInitializers(statement: ClassDeclaration): void {
    const initializedStaticFields = new Set<string>();
    for (const field of statement.fields) {
      if (!field.static) continue;
      const declared = this.host.resolveAnnotation(field.type);
      const valid = this.host.validateTypeReference(field.type);
      if (!field.initializer) {
        this.host.typeError(`Static field '${field.name}' requires an initializer`, field.span);
        continue;
      }
      const outerStaticFieldInitialization = this.host.staticFieldInitialization;
      this.host.staticFieldInitialization = { className: statement.name, initialized: initializedStaticFields };
      this.host.superMemberContext = "static";
      this.host.classFieldInitializerDepth += 1;
      const actual = this.host.inferExpression(field.initializer, valid ? declared : invalidType);
      this.host.classFieldInitializerDepth -= 1;
      this.host.superMemberContext = null;
      this.host.staticFieldInitialization = outerStaticFieldInitialization;
      if (valid) this.host.requireAssignable(actual, declared, field.initializer.span);
      initializedStaticFields.add(field.name);
    }
  }

  /** Every instance field, against the base's fields, getters and methods. */
  private checkInstanceFieldContracts(statement: ClassDeclaration, baseKey: string | null): Set<string> {
    const ownFields = new Set<string>();
    const instanceFields = [
      ...statement.parameters.filter((parameter) => parameter.binding).map((parameter) => ({
        name: parameter.name,
        mutable: parameter.binding === "let",
        type: this.host.resolveAnnotation(parameter.type),
        span: parameter.span,
        private: parameter.private,
      })),
      ...statement.fields.filter((field) => !field.static).map((field) => ({
        name: field.name,
        mutable: field.binding === "let",
        type: this.host.resolveAnnotation(field.type),
        span: field.span,
        private: field.private,
      })),
    ];
    for (const field of instanceFields) {
      if (ownFields.has(field.name)) this.host.typeError(`Class '${statement.name}' declares field '${field.name}' more than once`, field.span);
      ownFields.add(field.name);
      const reserved = this.errorContractMemberRejection(baseKey, field.name);
      if (reserved) {
        this.host.typeError(reserved, field.span);
        continue;
      }
      const inheritedField = baseKey ? this.host.findField(baseKey, field.name) : null;
      const inheritedGetter = baseKey ? this.host.findGetter(baseKey, field.name) : null;
      const inheritedMethod = baseKey ? this.host.findMethod(baseKey, field.name) : null;
      if (field.private && (inheritedField || inheritedGetter || inheritedMethod)) {
        this.host.typeError(`Private field '${field.name}' conflicts with an inherited public member`, field.span);
        continue;
      }
      if (inheritedGetter || inheritedMethod) {
        this.host.typeError(`Field '${field.name}' conflicts with an inherited ${inheritedGetter ? "getter" : "method"}`, field.span);
      }
      if (inheritedField) {
        if (inheritedField.mutable !== field.mutable || !sameType(inheritedField.type, field.type)) {
          this.host.typeError(`Inherited field '${field.name}' must keep its ${inheritedField.mutable ? "let" : "const"} ${describeType(inheritedField.type)} contract`, field.span);
        }
      }
    }
    return ownFields;
  }

  /** Every static field: a static member is not overridable, so an inherited one always collides. */
  private checkStaticFieldContracts(statement: ClassDeclaration, baseKey: string | null): Set<string> {
    const ownStaticFields = new Set<string>();
    for (const field of statement.fields.filter((candidate) => candidate.static)) {
      if (ownStaticFields.has(field.name)) this.host.typeError(`Class '${statement.name}' declares static field '${field.name}' more than once`, field.span);
      ownStaticFields.add(field.name);
      const inheritedMethod = baseKey ? this.host.findStaticMethod(baseKey, field.name) : null;
      const inheritedGetter = baseKey ? this.host.findStaticGetter(baseKey, field.name) : null;
      const inheritedField = baseKey ? this.host.findStaticField(baseKey, field.name) : null;
      if (field.private && (inheritedField || inheritedGetter || inheritedMethod)) {
        this.host.typeError(`Private static field '${field.name}' conflicts with an inherited public static member`, field.span);
        continue;
      }
      if (inheritedGetter || inheritedMethod) this.host.typeError(`Static field '${field.name}' conflicts with an inherited static ${inheritedGetter ? "getter" : "method"}`, field.span);
      if (!field.private && inheritedField) this.host.typeError(`Static field '${field.name}' conflicts with an inherited static field; static fields cannot be overridden`, field.span);
    }
    return ownStaticFields;
  }

  /** One private name per class, whatever kind of member claims it. */
  private rejectDuplicatePrivateMembers(statement: ClassDeclaration): void {
    const privateNames = new Set<string>();
    for (const member of [
      ...statement.parameters.filter((parameter) => parameter.private),
      ...statement.fields.filter((field) => field.private),
      ...statement.getters.filter((getter) => getter.private),
      ...statement.methods.filter((method) => method.private),
    ]) {
      if (privateNames.has(member.name)) {
        this.host.typeError(`Class '${statement.name}' declares private member '${member.name}' more than once`, member.span);
      }
      privateNames.add(member.name);
    }
  }

  /** Every getter: the collisions it can have, the `override` contract, and its body. */
  private analyzeGetters(statement: ClassDeclaration, baseKey: string | null, ownFields: ReadonlySet<string>, ownStaticFields: ReadonlySet<string>): void {
    const ownGetterNames = new Set<string>();
    for (const getter of statement.getters) {
      const key = `${getter.static ? "static:" : "instance:"}${getter.name}`;
      if (ownGetterNames.has(key)) this.host.typeError(`Class '${statement.name}' declares getter '${getter.name}' more than once`, getter.span);
      ownGetterNames.add(key);
      if ((!getter.static && ownFields.has(getter.name)) || (getter.static && ownStaticFields.has(getter.name))) {
        this.host.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' conflicts with a field declared by class '${statement.name}'`, getter.span);
      }
      if (statement.methods.some((method) => method.name === getter.name && method.static === getter.static)) {
        this.host.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' conflicts with a method declared by class '${statement.name}'`, getter.span);
      }
      const inheritedField = baseKey ? (getter.static ? this.host.findStaticField(baseKey, getter.name) : this.host.findField(baseKey, getter.name)) : null;
      const inheritedMethod = baseKey ? (getter.static ? this.host.findStaticMethod(baseKey, getter.name) : this.host.findMethod(baseKey, getter.name)) : null;
      const inheritedGetter = baseKey ? (getter.static
        ? this.host.findStaticGetter(baseKey, getter.name)
        : this.host.findGetter(baseKey, getter.name)) : null;
      const inheritedGetterType = getter.static
        ? inheritedGetter as ValueType | null
        : (inheritedGetter as { readonly type: ValueType } | null)?.type ?? null;
      if (getter.private && (inheritedField || inheritedMethod || inheritedGetter)) {
        this.host.typeError(`Private${getter.static ? " static" : ""} getter '${getter.name}' conflicts with an inherited public member`, getter.span);
      }
      if (!getter.private && (inheritedField || inheritedMethod)) {
        this.host.typeError(`Getter '${getter.name}' conflicts with an inherited ${inheritedField ? "field" : "method"}`, getter.span);
      }
      if (getter.abstract && !statement.abstract) {
        this.host.typeError(`Concrete class '${statement.name}' cannot declare abstract getter '${getter.name}'`, getter.span);
      }
      if (getter.abstract && getter.static) this.host.typeError(`Abstract getter '${getter.name}' cannot be static`, getter.span);
      if (getter.abstract && getter.override) this.host.typeError(`Abstract getter '${getter.name}' cannot also be an override`, getter.span);
      if (getter.private && getter.abstract) this.host.typeError(`Private getter '${getter.name}' cannot be abstract`, getter.span);
      if (getter.private && getter.override) this.host.typeError(`Private getter '${getter.name}' cannot use 'override'`, getter.span);
      if (!getter.private) {
        if (getter.override && !inheritedGetter) {
          this.host.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' uses 'override' but no base getter exists`, getter.span);
        } else if (!getter.override && inheritedGetter && !getter.abstract) {
          this.host.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' overrides a base getter and must use 'override'`, getter.span);
        }
        if (getter.override && inheritedGetterType && !sameType(this.host.resolveResult(getter.returnType), inheritedGetterType)) {
          this.host.typeError(`Getter override '${getter.name}' must keep the base result ${describeType(inheritedGetterType)}`, getter.span);
        }
      }
      if (getter.abstract) this.validateMethodSignature(getter);
      else this.host.analyzeFunctionDeclaration(getter, statement.name, true, !getter.static, false, "Getter");
    }
  }

  /** Every method: the collisions it can have, the `override` contract, and its body. */
  private analyzeMethods(statement: ClassDeclaration, baseKey: string | null, ownFields: ReadonlySet<string>, ownStaticFields: ReadonlySet<string>): void {
    const ownMethods = new Set<string>();
    for (const method of statement.methods) {
      if (!method.static && ownFields.has(method.name)) {
        this.host.typeError(`Method '${method.name}' conflicts with a field declared by class '${statement.name}'`, method.span);
      }
      if (method.static && ownStaticFields.has(method.name)) {
        this.host.typeError(`Static method '${method.name}' conflicts with a static field declared by class '${statement.name}'`, method.span);
      }
      if (!method.private && baseKey && (method.static
        ? this.host.findStaticField(baseKey, method.name) || this.host.findStaticGetter(baseKey, method.name)
        : this.host.findField(baseKey, method.name) || this.host.findGetter(baseKey, method.name))) {
        this.host.typeError(`${method.static ? "Static m" : "M"}ethod '${method.name}' conflicts with an inherited ${method.static ? "static " : ""}field or getter`, method.span);
      }
      if (method.private && baseKey && (method.static
        ? this.host.findStaticField(baseKey, method.name) || this.host.findStaticGetter(baseKey, method.name) || this.host.findStaticMethod(baseKey, method.name)
        : this.host.findField(baseKey, method.name) || this.host.findGetter(baseKey, method.name) || this.host.findMethod(baseKey, method.name))) {
        this.host.typeError(`Private${method.static ? " static" : ""} method '${method.name}' conflicts with an inherited public member`, method.span);
      }
      if (ownMethods.has(`${method.static ? "static:" : "instance:"}${method.name}`)) {
        this.host.typeError(`Class '${statement.name}' declares method '${method.name}' more than once`, method.span);
      }
      ownMethods.add(`${method.static ? "static:" : "instance:"}${method.name}`);
      if (method.abstract && !statement.abstract) {
        this.host.typeError(`Concrete class '${statement.name}' cannot declare abstract method '${method.name}'`, method.span);
      }
      if (method.abstract && method.static) {
        this.host.typeError(`Abstract method '${method.name}' cannot be static`, method.span);
      }
      if (method.abstract && method.override) {
        this.host.typeError(`Abstract method '${method.name}' cannot also be an override`, method.span);
      }
      if (method.private && method.abstract) {
        this.host.typeError(`Private method '${method.name}' cannot be abstract`, method.span);
      }
      if (method.private && method.override) {
        this.host.typeError(`Private method '${method.name}' cannot use 'override'`, method.span);
      }
      const inherited = baseKey && !method.private
        ? method.static ? this.host.findStaticMethod(baseKey, method.name) : this.host.findMethod(baseKey, method.name)
        : null;
      const inheritedType = method.static
        ? inherited as ValueType | null
        : (inherited as { readonly type: ValueType } | null)?.type ?? null;
      if (method.override && !inherited) {
        this.host.typeError(`${method.static ? "Static m" : "M"}ethod '${method.name}' uses 'override' but no base method exists`, method.span);
      } else if (!method.override && inherited && !method.abstract) {
        this.host.typeError(`${method.static ? "Static m" : "M"}ethod '${method.name}' overrides a base method and must use 'override'`, method.span);
      }
      if (method.override && inheritedType && !sameTypeIgnoringCallableParameterNames(this.host.classMethodType(statement, method), inheritedType)) {
        this.host.typeError(`Override '${method.name}' must keep the base method signature ${describeType(inheritedType)}`, method.span);
      }
      if (method.abstract) this.validateMethodSignature(method);
      else this.host.analyzeFunctionDeclaration(method, statement.name, true, !method.static, false, "Method");
    }
  }

  /** A concrete class owes an implementation for every abstract member above it. */
  private checkAbstractCoverage(statement: ClassDeclaration): void {
    if (!statement.abstract) {
      const missing = this.host.unimplementedAbstractMethods(statement.name);
      if (missing.length > 0) {
        this.host.typeError(`Concrete class '${statement.name}' must implement abstract method${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`, statement.span);
      }
    }
  }

  errorContractMemberRejection(baseName: string | null, member: string): string | null {
    if (!baseName || !this.host.isSubclassOf(baseName, "Error")) return null;
    switch (member) {
      case "name":
      case "code":
        return `'${member}' is the Error contract's own member: both report the declared class name, so a subclass cannot redeclare either — rename this field, or rename the class`;
      case "message":
        return "'message' is the Error contract's own member; pass the text to 'super(...)' instead of redeclaring the field";
      case "stack":
      case "cause":
        return `'${member}' is the Error contract's own member, filled in where the failure happens; a subclass cannot redeclare it`;
      default:
        return null;
    }
  }

  validateClassMemberName(name: string, memberSpan: Span, external = false): void {
    const label = external ? "Extern class member" : "Class member";
    if (name === "constructor") {
      this.host.diagnostics.push(diagnostic("VEL4014", `${label} 'constructor' is reserved for the constructor(...) declaration`, memberSpan));
    } else if (name === "prototype" || name === "__proto__") {
      this.host.diagnostics.push(diagnostic("VEL4014", `${label} '${name}' is unavailable because VelarScript does not expose prototype manipulation`, memberSpan));
    }
  }

  analyzeClassInitialization(statement: ClassDeclaration): void {
    const initialization = statement.initialization;
    if (!initialization) return;
    this.host.enterScope();
    this.host.flowFrameDepth += 1;
    this.host.functionDepth += 1;
    const previousLoopDepth = this.host.loopDepth;
    this.host.loopDepth = 0;
    const previousFinallyLoopDepths = this.host.finallyLoopDepths;
    this.host.finallyLoopDepths = [];
    const previousUnreachableDiagnosticDepth = this.host.unreachableDiagnosticDepth;
    this.host.unreachableDiagnosticDepth = 0;
    const previousClass = this.host.currentClass;
    const previousSuperMemberContext = this.host.superMemberContext;
    this.host.currentClass = statement.name;
    this.host.superMemberContext = "instance";
    this.host.asynchronousFunctions.push(false);
    this.host.returnContexts.push({ expected: nullType, inferredReturns: null, observedReturns: null, declarationKind: "Function" });
    this.host.constructorDepth += 1;
    const outerAllowedSuperCall = this.host.allowedSuperCall;
    const first = initialization.body[0];
    this.host.allowedSuperCall = first?.kind === "ExpressionStatement"
      && first.expression.kind === "CallExpression"
      && first.expression.callee.kind === "SuperExpression"
      ? spanIdentity(first.expression.span)
      : null;
    this.host.declareBinding("self", false, this.host.selfClassType(statement.name), initialization.span, true);
    this.host.analyzeStatements(initialization.body);
    this.host.allowedSuperCall = outerAllowedSuperCall;
    this.host.constructorDepth -= 1;
    this.host.returnContexts.pop();
    this.host.asynchronousFunctions.pop();
    this.host.currentClass = previousClass;
    this.host.superMemberContext = previousSuperMemberContext;
    this.host.loopDepth = previousLoopDepth;
    this.host.finallyLoopDepths = previousFinallyLoopDepths;
    this.host.unreachableDiagnosticDepth = previousUnreachableDiagnosticDepth;
    this.host.functionDepth -= 1;
    this.host.flowFrameDepth -= 1;
    this.host.exitScope();
  }

  validateConstructorShape(statement: ClassDeclaration): void {
    const body = statement.initialization?.body ?? [];
    const isSuperCall = (item: Statement | undefined): boolean => item?.kind === "ExpressionStatement"
      && item.expression.kind === "CallExpression"
      && item.expression.callee.kind === "SuperExpression";
    if (statement.base && statement.initialization && !isSuperCall(body[0])) {
      this.host.typeError(`Derived constructor for '${statement.name}' must call 'super(...)' first`, statement.initialization.span);
    }
    if (statement.base && !statement.initialization) {
      const base = this.host.classInfo(statement.base.name);
      if ((base?.requiredParameters ?? 0) > 0) {
        this.host.typeError(`Class '${statement.name}' requires a constructor that calls 'super(...)'`, statement.span);
      }
    }
    if (!statement.base && isSuperCall(body[0])) {
      this.host.typeError(`Base class '${statement.name}' cannot call 'super(...)'`, body[0]!.span);
    }
    const ownFields = new Map(statement.fields
      .filter((field) => !field.static)
      .map((field) => [field.name, field] as const));
    const initialized = new Set([...ownFields]
      .filter(([, field]) => field.initializer !== null)
      .map(([name]) => name));
    for (const item of body.slice(statement.base ? 1 : 0)) {
      if (item.kind !== "AssignmentStatement" || item.operator !== "=" || item.target.kind !== "MemberExpression"
        || item.target.object.kind !== "IdentifierExpression" || item.target.object.name !== "self") continue;
      const field = ownFields.get(item.target.property);
      if (!field) continue;
      if (initialized.has(item.target.property)) {
        this.host.typeError(`Constructor initializes field '${item.target.property}' more than once`, item.target.span);
        this.host.constructorFieldInitializations.add(item.target.span.start);
        continue;
      }
      initialized.add(item.target.property);
      this.host.constructorFieldInitializations.add(item.target.span.start);
    }
    for (const field of statement.fields) {
      if (!field.static && !field.initializer && !initialized.has(field.name)) {
        this.host.typeError(`Field '${field.name}' requires an initializer or one direct 'self.${field.name} = ...' constructor assignment`, field.span);
      }
    }
  }

  validateMethodSignature(method: ClassDeclaration["methods"][number]): void {
    this.host.checkTypeParameterDeclarations(method.typeParameters);
    if (!method.returnType) {
      this.host.diagnostics.push(diagnostic(
        "VEL4023",
        `Abstract method '${method.name}' requires an explicit result annotation because it has no body to infer`,
        method.signatureSpan,
      ));
    }
    this.host.withTypeParameterFrame(this.host.typeParameterFrame(method.typeParameters), () => {
      for (const parameter of method.parameters) {
        const type = this.host.resolveAnnotation(parameter.type);
        const valid = parameter.type ? this.host.validateTypeReference(parameter.type) : true;
        if (parameter.defaultValue && valid) this.host.requireAssignable(this.host.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      if (method.returnType) {
        const result = this.host.resolveAnnotation(method.returnType);
        const valid = this.host.validateTypeReference(method.returnType);
        if (valid && method.asynchronous && this.host.asyncResultContainsPromise(result)) {
          this.host.diagnostics.push(diagnostic("VEL4018", asyncResultAnnotationMessage, method.returnType.span));
        } else if (valid) {
          if (method.asynchronous) this.host.reportPromiseResolutionHazard(result, method.returnType.span);
          else this.host.reportPromiseCarrierHazard(result, method.returnType.span);
        }
      }
    });
  }

  /**
   * D55 rule 120 layer two: a method may declare its own type parameters beside
   * the class's, and the two never collide — because a name that would collide
   * is refused here. Shadowing would leave one word meaning two types in one
   * signature, which is the refusal D51 rule 109 already gives a bound name.
   */
  rejectClassTypeParameterRedeclaration(
    classParameters: readonly TypeParameterDeclaration[] | undefined,
    ownParameters: readonly TypeParameterDeclaration[] | undefined,
    className: string | null,
  ): void {
    if (!classParameters?.length || !ownParameters?.length) return;
    const declared = new Set(classParameters.map((parameter) => parameter.name));
    for (const parameter of ownParameters) {
      if (!declared.has(parameter.name)) continue;
      this.host.diagnostics.push(diagnostic(
        "VEL4021",
        `Type parameter '${parameter.name}' is already declared by class '${className}' and is in scope here; rename this one`,
        parameter.span,
      ));
    }
  }

}
