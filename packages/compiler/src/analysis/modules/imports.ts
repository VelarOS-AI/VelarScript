/**
 * What a module brings in: `import` bindings and their sources, `extern module`
 * declarations and the JavaScript types they carry, namespace imports, and the
 * migration report for the namespaces the language retired.
 *
 * D114 R1d: the import half of the module cluster.
 */
import {
  type ExternConstantDeclaration,
  type ExternFunctionDeclaration,
  type ImportDeclaration,
  type Program,
  type Statement,
  type TypeParameterDeclaration,
  type TypeReference,
} from "../../ast.ts";
import { type ClassField, type ClassInfo, type RetiredNamespace } from "../../contracts.ts";
import { type PermanentNamespaceName } from "../../core-vocabulary.ts";
import { diagnostic, mechanicalEdits, mechanicalFix, type Diagnostic, type DiagnosticEdit, type DiagnosticFix } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";
import {
  anyType,
  boundaryUnknownType,
  invalidType,
  optionalOf,
  resolveTypeReference,
  semanticTypeIdentity,
  unknownType,
  type EnumInfo,
  type GenericTypeInfo,
  type TypeParameterBound,
  type ValueType,
} from "../../types.ts";
import { coreVocabularyType, permanentNamespaceImportRoster, permanentNamespaceImportRosters } from "../vocabulary.ts";
import { retiredCollectionExport } from "../collections/retired.ts";
import { type ClassRegistry } from "../classes/registry.ts";
import { type TypeReferences } from "../declarations/references.ts";
import { type Binding, type BuiltinTypeNamePosition } from "../scopes.ts";

function externClassContract(info: ClassInfo): string {
  const fieldEntries = (fields: ReadonlyMap<string, ClassField>): readonly string[] =>
    [...fields].map(([name, field]) => `${name}\0${field.mutable ? "let" : "const"}\0${semanticTypeIdentity(field.type)}`).sort();
  const methodEntries = (methods: ReadonlyMap<string, ValueType>): readonly string[] =>
    [...methods].map(([name, type]) => `${name}\0${semanticTypeIdentity(type)}`).sort();
  return JSON.stringify([
    info.parameters.map((parameter) => semanticTypeIdentity(parameter)),
    info.requiredParameters,
    info.constructorRest ? semanticTypeIdentity(info.constructorRest) : null,
    info.base,
    fieldEntries(info.fields),
    [...info.getters].sort(),
    methodEntries(info.methods),
    fieldEntries(info.staticFields),
    [...info.staticGetters].sort(),
    methodEntries(info.staticMethods),
  ]);
}

/**
 * Everything this half of the module cluster asks of the analyzer that hosts
 * it. The three halves share one host object.
 */
export interface ModuleImportsHost {
  builtin(name: string): Binding | null;
  declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span, internal?: boolean, declaredType?: ValueType, importSource?: string, typeNamePosition?: BuiltinTypeNamePosition): void;
  readonly classDisplayNames: Map<string, string>;
  readonly classRegistry: ClassRegistry;
  readonly classes: Map<string, ClassInfo>;
  readonly declaredNames: Set<string>;
  readonly diagnostics: Diagnostic[];
  readonly enums: Map<string, EnumInfo>;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  readonly externClassDeclarations: Map<string, ReadonlySet<string>>;
  readonly externModules: Map<string, ReadonlyMap<string, ValueType>>;
  readonly externTypeImports: Map<string, ValueType>;
  readonly genericTypes: Map<string, GenericTypeInfo>;
  guidanceForGlobal(name: string): string | undefined;
  readonly importBindings: ReadonlyMap<string, ValueType>;
  readonly importedBindingOrigins: Map<Binding, string>;
  readonly importedBindingSources: Map<Binding, { readonly source: string; readonly imported: string | null }>;
  markDeclaredBindingReactive(name: string, kind?: "state" | "prop"): void;
  readonly invalidExternTypeReferences: WeakSet<TypeReference>;
  readonly namedTypeIdentities: Map<string, string>;
  readonly namedTypes: Map<string, ReadonlyMap<string, ValueType>>;
  readonly predeclared: WeakSet<object>;
  readonly reactiveBindings: ReadonlyMap<string, "state" | "prop">;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  resolvedAsyncResult(type: ValueType): ValueType;
  readonly retiredNamespaceUses: { readonly namespace: string; readonly member: string | null; readonly span: Span; readonly memberEnd: number; readonly bare: boolean }[];
  readonly retiredNamespaces: Map<string, RetiredNamespace>;
  readonly scopes: Map<string, Binding>[];
  readonly typeAliases: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  typeParameterBoundVector(declarations: readonly TypeParameterDeclaration[] | undefined): readonly (TypeParameterBound | null)[] | null;
  typeParameterFrame(declarations: readonly TypeParameterDeclaration[] | undefined): ReadonlyMap<string, ValueType>;
  readonly typeParameterFrames: ReadonlyMap<string, ValueType>[];
  readonly typeReferences: TypeReferences;
  withTypeParameterFrame<T>(frame: ReadonlyMap<string, ValueType>, action: () => T): T;
}

// D114 R1f: `importTypeNamePosition` and the `import` statement head moved
// here from `analyzer.ts`. Every call the head makes is into this module, so
// what it declares about an imported name is decided where the name resolves.
/**
 * Which reserved-type-name question an import specifier asks. A standard-module
 * import of the name under itself *is* the built-in surface — `velar/look`
 * republishes `Duration`, and the tour imports it that way — so only a binding
 * that would make the name mean something else is refused. That is the carve-out
 * D72 rule 186 already makes for `import {Color} from "velar/look"`; a module
 * scope import and a block-scoped one ask it here rather than each deciding it.
 */
export function importTypeNamePosition(
  statement: Extract<Statement, { kind: "ImportDeclaration" }>,
  specifier: { readonly imported: string; readonly local: string },
): BuiltinTypeNamePosition | undefined {
  if (specifier.local !== specifier.imported) return "import alias";
  return statement.source.startsWith("velar/") ? undefined : "imported name";
}

export class ModuleImports {

  analyzeImportDeclaration(statement: Extract<Statement, { kind: "ImportDeclaration" }>): void {
    // MOD-D1: the whole module-boundary family is module-top-level only.
    // A block-level import emitted invalid JavaScript, and a
    // function-body import silently bound `unknown` (the dependency walk
    // reads program.body only).
    if (this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic("VEL3011", "Imports can only be declared at module scope", statement.span));
    }
    if (!this.host.predeclared.has(statement)) {
      for (const specifier of statement.specifiers) {
        this.host.declareBinding(
          specifier.local,
          false,
          this.importType(statement, specifier.local, specifier.imported, specifier.namespace, specifier.span),
          specifier.span,
          false,
          undefined,
          statement.source,
          importTypeNamePosition(statement, specifier),
        );
        this.recordImportedBindingSource(statement.javascript, statement.source, specifier.local, specifier.namespace ? null : specifier.imported);
        this.recordImportedBindingOrigin(specifier.local, statement.source, specifier.span);
        const reactive = this.host.reactiveBindings.get(specifier.local);
        if (reactive) this.host.markDeclaredBindingReactive(specifier.local, reactive);
      }
    }
  }
  private readonly host: ModuleImportsHost;

  constructor(host: ModuleImportsHost) {
    this.host = host;
  }

  registerExternTypeImports(program: Program): void {
    const classesBySource = new Map<string, ReadonlySet<string>>();
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration" || classesBySource.has(statement.source)) continue;
      classesBySource.set(statement.source, new Set(statement.classes.map((declaration) => declaration.name)));
    }
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" || !statement.javascript || statement.unsafe) continue;
      const classNames = classesBySource.get(statement.source);
      if (!classNames) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.namespace || !classNames.has(specifier.imported)) continue;
        this.host.externTypeImports.set(specifier.local, {
          kind: "class",
          name: specifier.local,
          identity: this.externClassIdentity(statement.source, specifier.imported),
        });
      }
    }
  }

  registerExternModules(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration") continue;
      if (this.host.externModules.has(statement.source)) {
        this.host.diagnostics.push(diagnostic("VEL4005", `Extern module '${statement.source}' is declared more than once`, statement.span));
        continue;
      }
      const exports = new Map<string, ValueType>();
      const classNames = new Set(statement.classes.map((declaration) => declaration.name));
      for (const declaration of statement.classes) {
        if (exports.has(declaration.name)) {
          this.host.diagnostics.push(diagnostic("VEL4005", `Extern export '${declaration.name}' is declared more than once`, declaration.span));
          continue;
        }
        const identity = this.externClassIdentity(statement.source, declaration.name);
        const fields = new Map<string, ClassField>();
        const staticFields = new Map<string, ClassField>();
        for (const parameter of declaration.parameters) {
          if (parameter.binding) fields.set(parameter.name, {
            mutable: parameter.binding === "let",
            type: this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames),
          });
        }
        for (const field of declaration.fields) {
          (field.static ? staticFields : fields).set(field.name, {
            mutable: field.mutable,
            type: this.resolveValidatedExternAnnotation(field.type, statement.source, classNames),
          });
        }
        const getters = new Set<string>();
        const staticGetters = new Set<string>();
        for (const getter of declaration.getters) {
          (getter.static ? staticFields : fields).set(getter.name, {
            mutable: false,
            type: this.resolveValidatedExternAnnotation(getter.type, statement.source, classNames),
          });
          (getter.static ? staticGetters : getters).add(getter.name);
        }
        const methods = new Map<string, ValueType>();
        const staticMethods = new Map<string, ValueType>();
        for (const method of declaration.methods) {
          (method.static ? staticMethods : methods).set(method.name, this.externFunctionType(
            method,
            (reference) => this.resolveValidatedExternAnnotation(reference, statement.source, classNames),
          ));
        }
        const rest = declaration.parameters.find((parameter) => parameter.rest);
        const info: ClassInfo = {
          identity,
          parameters: declaration.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames)),
          requiredParameters: declaration.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
          ...(rest ? { constructorRest: this.resolveValidatedExternAnnotation(rest.type, statement.source, classNames) } : {}),
          base: declaration.base ? this.externClassIdentity(statement.source, declaration.base) : null,
          abstract: false,
          fields,
          getters,
          abstractGetters: new Set(),
          methods,
          abstractMethods: new Set(),
          staticFields,
          staticGetters,
          staticMethods,
        };
        // A class already registered under the same identity is the same
        // nominal class declared by another module (or bridged declaration).
        // Matching shapes share the one contract silently; a disagreement is
        // reported here, at the later declaration, instead of forking the
        // identity into two contracts that can never assign to each other.
        const existing = this.host.classRegistry.classInfo(identity);
        if (existing && externClassContract(existing) !== externClassContract(info)) {
          this.host.diagnostics.push(diagnostic(
            "VEL4005",
            `Extern class '${declaration.name}' from '${statement.source}' is already declared with a different shape; every declaration of an extern class shares one contract`,
            declaration.span,
          ));
        }
        this.host.classes.set(identity, info);
        exports.set(declaration.name, { kind: "classConstructor", name: declaration.name, identity });
      }
      for (const declaration of [...statement.functions, ...statement.constants]) {
        if (exports.has(declaration.name)) {
          this.host.diagnostics.push(diagnostic("VEL4005", `Extern export '${declaration.name}' is declared more than once`, declaration.span));
        }
        exports.set(declaration.name, "parameters" in declaration
          ? this.externFunctionType(declaration, (reference) => this.resolveValidatedExternAnnotation(reference, statement.source, classNames))
          : this.resolveValidatedExternAnnotation(declaration.type, statement.source, classNames));
      }
      this.host.externModules.set(statement.source, exports);
    }
  }

  importType(statement: Extract<Statement, { kind: "ImportDeclaration" }>, local: string, imported: string, namespace: boolean, importSpan: Span): ValueType {
    if (statement.resource === "json") return unknownType;
    if (!statement.javascript) {
      // D114 S3: a retired velar/collections name reports once at its
      // specifier and then recovers as its own declared shape with unchecked
      // values, so one retirement does not also produce an arity or
      // named-argument error at every site it left behind. Core no longer owns
      // what these functions mean, so only their parameter names survive.
      // D114 0.28.0 D-I1: a Core prelude name imported from a module that
      // retired it recovers as the prelude value it names, so the one report at
      // the specifier is not joined by an "unknown JavaScript value" at every
      // call it left behind. Only a roster with no namespace reaches a prelude
      // name, so `import {stringify} from "velar/json"` is unaffected.
      const prelude = namespace || !permanentNamespaceImportRoster(statement.source)?.members.has(imported)
        ? null
        : coreVocabularyType(imported);
      if (prelude !== null) return prelude;
      const retiredCollection = namespace ? null : retiredCollectionExport(statement.source, imported);
      if (retiredCollection !== null) {
        return {
          kind: "function",
          parameterNames: retiredCollection.parameters,
          parameters: retiredCollection.parameters.map(() => anyType),
          requiredParameters: 0,
          result: anyType,
        };
      }
      const type = this.host.importBindings.get(local) ?? unknownType;
      if (type.kind === "classConstructor" && type.identity) this.host.classDisplayNames.set(type.identity, local);
      return type;
    }
    // D90 R17: an undeclared foreign value arrives as unknown — R12 refused
    // `any` at export positions, and this closes the entry. The value must be
    // validated into a concrete type (`Type.parse`) before members, calls, or
    // operators touch it; `unsafe` names the missing declaration, not a
    // license to chain through the boundary. A host-injected binding is a
    // declaration — the host answered for the name — so it still wins. The
    // boundary marker matters: a bare `unknown` is the inference seed a merge
    // absorbs, while this value is *known to be unchecked*, so `[mystery, 5]`
    // must stay `List<unknown | number>` instead of laundering into
    // `List<number>`.
    if (statement.unsafe) return this.host.importBindings.get(local) ?? boundaryUnknownType;
    const declarations = this.host.externModules.get(statement.source);
    if (namespace) return declarations
      ? { kind: "object", fields: declarations, readonlyFields: new Set(declarations.keys()) }
      : this.host.importBindings.get(local) ?? unknownType;
    // BRG-N1: a manual extern block owns the whole source contract, so an
    // imported name it does not declare is a check-time error — the same
    // stance a .vel module already takes — instead of silently binding
    // unknown (which is how a typo used to disappear).
    if (declarations && !declarations.has(imported)) {
      this.host.typeError(
        `Extern module '${statement.source}' does not declare '${imported}'; add it to the extern block, or fix the imported name`,
        importSpan,
      );
      return unknownType;
    }
    const type = declarations?.get(imported) ?? this.host.importBindings.get(local) ?? unknownType;
    if (type.kind === "classConstructor" && type.identity) {
      this.host.classDisplayNames.set(type.identity, local);
      return { ...type, name: local };
    }
    return type;
  }

  externFunctionType(
    statement: ExternFunctionDeclaration,
    resolve: (reference: TypeReference | null) => ValueType = (reference) => this.host.resolveAnnotation(reference),
  ): ValueType {
    const frame = this.host.typeParameterFrame(statement.typeParameters);
    const bounds = this.host.typeParameterBoundVector(statement.typeParameters);
    return this.host.withTypeParameterFrame(frame, () => {
      const result = statement.returnType ? resolve(statement.returnType) : invalidType;
      const rest = statement.parameters.find((parameter) => parameter.rest);
      const parameters = statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolve(parameter.type));
      return {
        kind: "function",
        ...(frame.size > 0 ? { typeParameterNames: [...frame.keys()] } : {}),
        ...(frame.size > 0 && bounds ? { typeParameterBounds: bounds } : {}),
        parameters,
        parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
        ...(rest ? { rest: resolve(rest.type) } : {}),
        result: statement.asynchronous ? { kind: "promise", value: this.host.resolvedAsyncResult(result) } : result,
      };
    });
  }

  externConstantType(statement: ExternConstantDeclaration): ValueType {
    return this.host.resolveAnnotation(statement.type);
  }

  externClassIdentity(source: string, name: string): string {
    return `js:${source}#${name}`;
  }

  resolveExternAnnotation(reference: TypeReference | null, source: string, classNames: ReadonlySet<string>): ValueType {
    const resolve = (type: ValueType): ValueType => {
      if (type.kind === "named" && classNames.has(type.name)) {
        return { kind: "class", name: type.name, identity: this.externClassIdentity(source, type.name) };
      }
      if (type.kind === "named" && !type.identity) {
        const crossBlock = this.crossBlockExternClassType(type.name);
        if (crossBlock) return crossBlock;
      }
      if (type.kind === "optional") return optionalOf(resolve(type.inner));
      if (type.kind === "list") return { ...type, element: resolve(type.element) };
      if (type.kind === "set") return { ...type, element: resolve(type.element) };
      if (type.kind === "map") return { ...type, key: resolve(type.key), value: resolve(type.value) };
      if (type.kind === "record") return { ...type, value: resolve(type.value) };
      if (type.kind === "promise") return { kind: "promise", value: resolve(type.value) };
      if (type.kind === "runtimeType") return { kind: "runtimeType", value: resolve(type.value) };
      if (type.kind === "typeObject") return type.value ? { ...type, value: resolve(type.value) } : type;
      if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, resolve(value)])) };
      if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
        ...type,
        parameters: type.parameters.map(resolve),
        ...(type.rest ? { rest: resolve(type.rest) } : {}),
        result: resolve(type.result),
      };
      if (type.kind === "union") return { kind: "union", members: type.members.map(resolve) };
      return this.host.typeReferences.resolveNamedClasses(type);
    };
    return reference ? resolve(this.host.expandAliases(resolveTypeReference(reference))) : unknownType;
  }

  // An extern class carries one nominal identity per JavaScript source and
  // class name, so a reference from another extern block (or through an
  // 'import js' alias) resolves to the declaring source's class instead of
  // freezing into a structural named type that can never match it.
  crossBlockExternClassType(name: string): ValueType | null {
    if (this.host.typeParameterFrames.at(-1)?.has(name)) return null;
    if (this.host.namedTypes.has(name)
      || this.host.genericTypes.has(name)
      || this.host.namedTypeIdentities.has(name)
      || this.host.typeAliases.has(name)
      || this.host.classes.has(name)
      || this.host.enums.has(name)) return null;
    const imported = this.host.externTypeImports.get(name);
    if (imported?.kind === "class") return imported;
    const sources = this.host.externClassDeclarations.get(name);
    if (sources?.size !== 1) return null;
    const [declaringSource] = sources;
    return { kind: "class", name, identity: this.externClassIdentity(declaringSource!, name) };
  }

  resolveValidatedExternAnnotation(reference: TypeReference | null, source: string, classNames: ReadonlySet<string>): ValueType {
    if (!reference) return unknownType;
    return this.host.invalidExternTypeReferences.has(reference)
      ? invalidType
      : this.resolveExternAnnotation(reference, source, classNames);
  }

  // Imported bindings remember their module specifier so identifier reads can
  // be classified against the project module graph (D31 item 23). JavaScript
  // imports never participate: only .vel modules join initialization cycles.
  recordImportedBindingSource(javascript: boolean, source: string, local: string, imported: string | null): void {
    if (javascript) return;
    const binding = this.host.scopes.at(-1)?.get(local);
    if (binding) this.host.importedBindingSources.set(binding, { source, imported });
  }

  recordImportedBindingOrigin(local: string, source: string, specifierSpan: Span): void {
    const binding = this.host.scopes.at(-1)?.get(local);
    // A failed declaration (collision) leaves the earlier binding in the
    // scope; tagging that one would misattribute the origin.
    if (binding && binding.span.start === specifierSpan.start && binding.span.end === specifierSpan.end) {
      this.host.importedBindingOrigins.set(binding, source);
    }
  }

  displayExternalClasses(type: ValueType): ValueType {
    if ((type.kind === "class" || type.kind === "classConstructor") && type.identity) {
      return { ...type, name: this.host.classDisplayNames.get(type.identity) ?? type.name };
    }
    if (type.kind === "optional") return optionalOf(this.displayExternalClasses(type.inner));
    if (type.kind === "list") return { ...type, element: this.displayExternalClasses(type.element) };
    if (type.kind === "set") return { ...type, element: this.displayExternalClasses(type.element) };
    if (type.kind === "map") return { ...type, key: this.displayExternalClasses(type.key), value: this.displayExternalClasses(type.value) };
    if (type.kind === "record") return { ...type, value: this.displayExternalClasses(type.value) };
    if (type.kind === "promise") return { kind: "promise", value: this.displayExternalClasses(type.value) };
    if (type.kind === "runtimeType") return { kind: "runtimeType", value: this.displayExternalClasses(type.value) };
    if (type.kind === "typeObject") return type.value ? { ...type, value: this.displayExternalClasses(type.value) } : type;
    if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, this.displayExternalClasses(value)])) };
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => this.displayExternalClasses(parameter)),
      ...(type.rest ? { rest: this.displayExternalClasses(type.rest) } : {}),
      result: this.displayExternalClasses(type.result),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => this.displayExternalClasses(member)) };
    return type;
  }

  /**
   * The retired namespace whose module exports this bare name, when exactly one
   * does and no permanent namespace claims the same spelling. `min`, `max`, and
   * `clamp` are claimed by `Math.` as well, so those keep the guidance and lose
   * only the automatic rewrite — a fix has to be provably the author's meaning,
   * and there the meaning is genuinely ambiguous.
   */
  retiredNamespaceOwning(name: string): string | null {
    let owner: string | null = null;
    for (const [namespace, retired] of this.host.retiredNamespaces) {
      if (!retired.members.has(name)) continue;
      if (owner) return null;
      owner = namespace;
    }
    if (!owner) return null;
    for (const roster of permanentNamespaceImportRosters.values()) if (roster.members.has(name)) return null;
    return owner;
  }

  /** The import line a migration writes, in the sorted shape every module here already uses. */
  renderNamedImport(source: string, specifiers: readonly { readonly imported: string; readonly local: string }[]): string {
    const rendered = [...specifiers]
      .sort((left, right) => (left.imported < right.imported ? -1 : left.imported > right.imported ? 1 : 0))
      .map((specifier) => (specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`));
    return `import {${rendered.join(", ")}} from ${JSON.stringify(source)}`;
  }

  /** Where a module that has no import of `source` yet should grow one. */
  importInsertion(program: Program, line: string): DiagnosticEdit {
    let lastImport: Span | null = null;
    for (const statement of program.body) if (statement.kind === "ImportDeclaration") lastImport = statement.span;
    if (lastImport) return { span: { start: lastImport.end, end: lastImport.end }, text: `\n${line}` };
    const offset = program.body[0]?.span.start ?? 0;
    return { span: { start: offset, end: offset }, text: `${line}\n\n` };
  }

  /**
   * D52 rule 114: the migration off a namespace prefix the language withdrew.
   * It is the mirror of the one below — that one takes an import away and puts
   * a prefix on, this one takes the prefix off and puts an import back — and
   * both answer in one step, because a migration that needs a second compile to
   * find the working spelling has taught a loop rather than a spelling.
   */
  reportRetiredNamespaceUses(program: Program): void {
    if (this.host.retiredNamespaceUses.length === 0) return;
    const grouped = new Map<string, typeof this.host.retiredNamespaceUses>();
    for (const use of this.host.retiredNamespaceUses) {
      const collected = grouped.get(use.namespace) ?? [];
      collected.push(use);
      grouped.set(use.namespace, collected);
    }
    for (const [namespace, uses] of grouped) this.reportRetiredNamespace(program, namespace, uses);
  }

  /** A member name to show in the rule 106 guidance, so the fix is concrete. */
  /** Every use of one retired namespace, reported together so one import line serves them all. */
  private reportRetiredNamespace(
    program: Program,
    namespace: string,
    uses: readonly { readonly span: Span; readonly member: string | null; readonly memberEnd: number; readonly bare?: boolean }[],
  ): void {
    const retired = this.host.retiredNamespaces.get(namespace);
    if (!retired) return;
    const quoted = JSON.stringify(retired.module);
    const example = [...retired.members][0] ?? "member";
    const existing = program.body.find((statement) =>
      statement.kind === "ImportDeclaration" && statement.source === retired.module
      && !statement.javascript && statement.specifiers.every((specifier) => !specifier.namespace)) as
      Extract<Statement, { kind: "ImportDeclaration" }> | undefined;
    const bound = new Map<string, string>();
    const taken = new Set<string>();
    for (const specifier of existing?.specifiers ?? []) {
      bound.set(specifier.imported, specifier.local);
      taken.add(specifier.local);
    }
    const seen = new Set<string>();
    const ordered = [...uses]
      .sort((left, right) => left.span.start - right.span.start)
      .filter((use) => {
        const key = spanIdentity(use.span);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const added: string[] = [];
    const entries = this.retiredNamespaceFixEntries(namespace, retired, quoted, example, ordered, bound, taken, added);
    let importEdit: DiagnosticEdit | null = null;
    if (added.length > 0) {
      const specifiers = [
        ...(existing?.specifiers ?? []).map((specifier) => ({ imported: specifier.imported, local: specifier.local })),
        ...added.map((member) => ({ imported: member, local: member })),
      ];
      const line = this.renderNamedImport(retired.module, specifiers);
      importEdit = existing ? { span: existing.span, text: line } : this.importInsertion(program, line);
    }
    let importAttached = importEdit === null;
    for (const entry of entries) {
      if (!importAttached && entry.contributes) {
        importAttached = true;
        this.host.diagnostics.push(diagnostic("VEL3008", entry.message, entry.span, mechanicalEdits(
          entry.edit ? [importEdit!, entry.edit] : [importEdit!],
          `Import ${added.join(", ")} from ${retired.module}`,
        )));
        continue;
      }
      if (!entry.edit) {
        this.host.diagnostics.push(diagnostic("VEL3008", entry.message, entry.span));
        continue;
      }
      this.host.diagnostics.push(diagnostic("VEL3008", entry.message, entry.span, mechanicalFix(
        entry.edit.span,
        entry.edit.text,
        `Drop the retired '${namespace}.' prefix`,
      )));
    }
  }

  /**
   * One diagnostic plan per use of a retired namespace prefix: the message, the
   * mechanical edit when there is one, and whether it needs the import line.
   */
  private retiredNamespaceFixEntries(
    namespace: string,
    retired: RetiredNamespace,
    quoted: string,
    example: string,
    ordered: readonly { readonly span: Span; readonly member: string | null; readonly memberEnd: number; readonly bare?: boolean }[],
    bound: ReadonlyMap<string, string>,
    taken: ReadonlySet<string>,
    added: string[],
  ): { readonly span: Span; readonly message: string; readonly edit: DiagnosticEdit | null; readonly contributes: boolean }[] {
    const entries: { readonly span: Span; readonly message: string; readonly edit: DiagnosticEdit | null; readonly contributes: boolean }[] = [];
      for (const use of ordered) {
      const member = use.member;
      if (member === null) {
        entries.push({
          span: use.span,
          message: this.host.guidanceForGlobal(namespace)
            ?? `'${namespace}' is not a value; import the names you need from ${quoted} and call them without a prefix`,
          edit: null,
          contributes: false,
        });
        continue;
      }
      if (!retired.members.has(member)) {
        entries.push({
          span: use.span,
          message: `'${namespace}' is not a namespace; ${quoted} exports its names directly — import {${example}} from ${quoted}`,
          edit: null,
          contributes: false,
        });
        continue;
      }
      if (use.bare) {
        // The prefix is already gone here; only the import is missing.
        const free = !this.host.declaredNames.has(member) && !taken.has(member);
        if (free && !added.includes(member)) added.push(member);
        entries.push({
          span: use.span,
          message: this.host.guidanceForGlobal(member)
            ?? `Import the builder — import {${member}} from ${quoted} — then call ${member}(...)`,
          edit: null,
          contributes: free,
        });
        continue;
      }
      const local = bound.get(member);
      if (local !== undefined) {
        entries.push({
          span: use.span,
          message: `Use ${local}(...); the '${namespace}.' prefix is retired, and this module already imports ${member} from ${quoted}`,
          edit: { span: { start: use.span.start, end: use.memberEnd }, text: local },
          contributes: false,
        });
        continue;
      }
      if (this.host.declaredNames.has(member) || taken.has(member)) {
        entries.push({
          span: use.span,
          message: `The '${namespace}.' prefix is retired, and this module already binds '${member}' — import the builder under another name, 'import {${member} as other} from ${quoted}', and call other(...)`,
          edit: null,
          contributes: false,
        });
        continue;
      }
      if (!added.includes(member)) added.push(member);
      entries.push({
        span: use.span,
        message: `Use ${member}(...); the '${namespace}.' prefix is retired — import {${member}} from ${quoted}`,
        edit: { span: { start: use.span.start, end: use.memberEnd }, text: member },
        contributes: true,
      });
      }
    return entries;
  }

  firstNamespaceMember(namespace: PermanentNamespaceName): string {
    const binding = this.host.builtin(namespace);
    const type = binding ? this.host.expandAliases(binding.type) : null;
    if (type?.kind === "object") {
      for (const name of type.fields.keys()) return name;
    }
    return "member";
  }
}
