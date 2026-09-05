/**
 * A written type reference, validated: every syntax form a `TypeReference` can
 * take, checked against the records, aliases, enums, classes and generic
 * templates the module knows.
 *
 * D114 R1d: `validateTypeReference` was 240 lines of one `switch` inside one
 * closure. It keeps its exact shape — a recursive `validate` the extension
 * hook is asked first, then the switch — but each arm is now its own method,
 * so a reader who needs the `readonly` rule reads twenty lines instead of two
 * hundred and forty. `validateTypeReference` itself stays `protected` on
 * `Analyzer` and forwards here.
 */
import { type Expression, type TypeReference, type TypeSyntax } from "../../ast.ts";
import { type ClassInfo } from "../../contracts.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";

import { type Span } from "../../source.ts";
import {
  describeType,
  isReadonlyView,
  mutableViewOf,
  optionalOf,
  formatTypeSyntax,
  type EnumInfo,
  type GenericTypeInfo,
  type ValueType,
} from "../../types.ts";
import { type Binding } from "../scopes.ts";

/**
 * Everything this half of the declaration cluster asks of the analyzer that
 * hosts it. The five halves share one host object, so the interface is the
 * same shape for each and the union of them is what the analyzer builds.
 */
export interface TypeReferencesHost {
  readonly bareGenericClassPositions: WeakSet<TypeSyntax>;
  boundaryValidationGuidance(expression: Expression | null, property: string | null): string;
  classInfo(key: string): ClassInfo | undefined;
  readonly classes: Map<string, ClassInfo>;
  readonly diagnostics: Diagnostic[];
  enclosingTypeParameterName(name: string): boolean;
  readonly enums: Map<string, EnumInfo>;
  readonly externClassDeclarations: Map<string, ReadonlySet<string>>;
  readonly externTypeImports: Map<string, ValueType>;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  findClassInReadonlyData(type: ValueType, seen?: Set<string>, sawCycle?: { cut: boolean }): { readonly suffix: string; readonly className: string } | null;
  readonly genericTypes: Map<string, GenericTypeInfo>;
  readonly importBindings: ReadonlyMap<string, ValueType>;
  readonly invalidDeclaredTypes: Set<string>;
  isPrimitiveType(name: string): boolean;
  lookup(name: string): Binding | null;
  readonly namedTypeIdentities: Map<string, string>;
  readonly namedTypes: Map<string, ReadonlyMap<string, ValueType>>;
  readonly namespaceImportLocals: Map<string, string>;
  readonly primitiveNames: Set<string>;
  rejectCollidingKeyDomain(keySource: ValueType, span: Span, position: string): void;
  reportPromiseCarrierHazard(type: ValueType, errorSpan: Span): void;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  resolveGenericApplication(type: Extract<ValueType, { kind: "named" }>, resolveArgument?: (argument: ValueType) => ValueType): ValueType | null;
  resolveGenericClassApplication(type: Extract<ValueType, { kind: "named" }>): ValueType | null;
  staticMemberTypeParameters: { readonly className: string; readonly names: ReadonlySet<string> } | null;
  readonly typeAliases: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  readonly typeParameterFrames: ReadonlyMap<string, ValueType>[];
  readonly typeReferenceValidity: WeakMap<TypeReference, boolean>;
  validateExtensionTypeSyntax(_syntax: TypeSyntax, _validate: (syntax: TypeSyntax) => boolean, _resolve: (reference: TypeReference) => ValueType): boolean | undefined;
  validateGenericApplication(info: GenericTypeInfo, syntax: Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>): boolean;
  validateGenericClassApplication(name: string, info: ClassInfo, syntax: Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>): boolean;
}

export class TypeReferences {
  private readonly host: TypeReferencesHost;

  constructor(host: TypeReferencesHost) {
    this.host = host;
  }

  validateTypeReference(
    reference: TypeReference,
    resolve?: (reference: TypeReference) => ValueType,
  ): boolean {
    if (!resolve) {
      const cached = this.host.typeReferenceValidity.get(reference);
      if (cached !== undefined) return cached;
    }
    const resolver = resolve ?? ((value: TypeReference) => this.host.resolveAnnotation(value));
    const validate = (syntax: TypeSyntax): boolean => {
      const extensionResult = this.host.validateExtensionTypeSyntax(syntax, validate, resolver);
      if (extensionResult !== undefined) return extensionResult;
      switch (syntax.kind) {
        case "NamedTypeSyntax": return this.validateNamedTypeSyntax(syntax, resolver);
        case "EnumMemberTypeSyntax": return this.validateEnumMemberTypeSyntax(syntax);
        case "GenericTypeSyntax": return this.validateGenericTypeSyntax(syntax, validate, resolver);
        case "ReadonlyTypeSyntax": return this.validateReadonlyTypeSyntax(syntax, validate, resolver);
        case "OptionalTypeSyntax":
          return validate(syntax.inner);
        case "UnionTypeSyntax":
          return syntax.members.map(validate).every(Boolean);
        case "FunctionTypeSyntax": {
          const parametersValid = syntax.parameters.map((parameter) => validate(parameter.type)).every(Boolean);
          const resultValid = validate(syntax.result);
          return parametersValid && resultValid;
        }
      }
    };
    const valid = validate(reference.syntax);
    if (!resolve) this.host.typeReferenceValidity.set(reference, valid);
    return valid;
  }

  /** A bare name: a primitive, a record, an alias, a class, an enum, a type parameter — or nothing. */
  private validateNamedTypeSyntax(
    syntax: Extract<TypeSyntax, { kind: "NamedTypeSyntax" }>,
    resolver: (reference: TypeReference) => ValueType,
  ): boolean {
      // D90 R17 removed the boundary that used to produce `any`, so the
      // old reason clause ("reserved for explicit unsafe JavaScript
      // boundaries") named a producer that no longer exists. The refusal
      // now teaches the same entrance every other unknown refusal teaches.
      if (syntax.name === "any") {
        this.host.typeError(
          `'any' is not a VelarScript type; a foreign value arrives as 'unknown', which is what you annotate${this.host.boundaryValidationGuidance(null, null)}`,
          syntax.span,
        );
        return false;
      }
      if (this.host.invalidDeclaredTypes.has(syntax.name)) return false;
      if (syntax.name === "Promise") return true;
      if (this.host.typeParameterFrames.at(-1)?.has(syntax.name)) return true;
      // D55 rule 126: a bare generic record has no identity, no field
      // table, and no validator — it is a type constructor. The refusal
      // teaches the arity rather than quietly reading it as
      // `Box<unknown>`, which would hand back a validator that accepts
      // everything the author forgot to describe.
      // D55 rule 120 layer two: a static member belongs to the class, not
      // to an instantiation, so the class's parameters are out of scope
      // there. Reported where it is written, because "Unknown type 'T'" is
      // true and useless — the name exists, it just has no value here.
      if (this.host.staticMemberTypeParameters?.names.has(syntax.name)) {
        this.host.diagnostics.push(diagnostic(
          "VEL4021",
          `Type parameter '${syntax.name}' belongs to class '${this.host.staticMemberTypeParameters.className}', and a static member belongs to the class rather than to an instantiation, so '${syntax.name}' has no value here; declare '<${syntax.name}>' on this member, or make it an instance member`,
          syntax.span,
        ));
        return false;
      }
      if (this.host.genericTypes.has(syntax.name)) {
        const info = this.host.genericTypes.get(syntax.name)!;
        this.host.typeError(
          `Generic type '${syntax.name}' needs ${info.parameterNames.length === 1 ? "a type argument" : `${info.parameterNames.length} type arguments`}; write '${syntax.name}<${info.parameterNames.join(", ")}>' with concrete types`,
          syntax.span,
        );
        return false;
      }
      // D55 rule 126 reaching layer two: a bare generic class name has no
      // identity, no member table, and no instantiation behind it — it is
      // a type constructor. The one position that reads it anyway is the
      // erased runtime check `is Stack`, which is why that position asks
      // for it by name.
      {
        const parameters = this.host.classes.get(syntax.name)?.typeParameterNames;
        if (parameters?.length && !this.host.bareGenericClassPositions.has(syntax)) {
          this.host.typeError(
            `Generic class '${syntax.name}' needs ${parameters.length === 1 ? "a type argument" : `${parameters.length} type arguments`}; write '${syntax.name}<${parameters.join(", ")}>' with concrete types`,
            syntax.span,
          );
          return false;
        }
      }
      if (this.host.primitiveNames.has(syntax.name)
        || this.host.namedTypes.has(syntax.name)
        || this.host.namedTypeIdentities.has(syntax.name)
        || this.host.typeAliases.has(syntax.name)
        || this.host.classes.has(syntax.name)
        || this.host.enums.has(syntax.name)
        || this.host.externTypeImports.has(syntax.name)) return true;
      const resolved = resolver({ syntax, span: syntax.span });
      if (resolved.kind !== "named"
        || (resolved.identity && this.host.namedTypes.has(resolved.identity))) return true;
      if (this.host.enclosingTypeParameterName(syntax.name)) {
        this.host.diagnostics.push(diagnostic("VEL4021", `Type parameter '${syntax.name}' belongs to the enclosing function; declare '<${syntax.name}>' on this def`, syntax.span));
        return false;
      }
      const externSources = this.host.externClassDeclarations.get(syntax.name);
      if (externSources && externSources.size > 1) {
        const sources = [...externSources].map((source) => `"${source}"`).join(", ");
        this.host.typeError(`Extern class '${syntax.name}' is declared by more than one extern module (${sources}); import the intended class with 'import js' to name it here`, syntax.span);
        return false;
      }
      this.host.typeError(`Unknown type '${syntax.name}'`, syntax.span);
      return false;
  }

  /** `Enum.member` in a type position, and the namespace-import spellings that are not one. */
  private validateEnumMemberTypeSyntax(
    syntax: Extract<TypeSyntax, { kind: "EnumMemberTypeSyntax" }>,
  ): boolean {
      if (syntax.qualifiers?.length) {
        // A path with a qualifier reaches its owner through something else.
        // One segment of qualification is the namespace import —
        // `library.Status.pending` — and it earns the refusal
        // `library.Status` earns, naming the enum the module exports.
        // Anything deeper names nothing the language has.
        const head = syntax.qualifiers[0]!;
        const namespaceSource = syntax.qualifiers.length === 1
          ? this.host.namespaceImportLocals.get(head.name)
          : undefined;
        this.host.typeError(
          namespaceSource !== undefined
            ? `Namespace members cannot be written in type positions; import '${syntax.enumName}' by name — import {${syntax.enumName}} from ${JSON.stringify(namespaceSource)} — and write '${syntax.enumName}.${syntax.member}'`
            : `A type is named by one name, or by an enum member written as 'Enum.member'; '${formatTypeSyntax(syntax)}' is neither`,
          syntax.span,
        );
        return false;
      }
      const info = this.host.enums.get(syntax.enumName);
      const imported = this.host.lookup(syntax.enumName)?.type ?? this.host.importBindings.get(syntax.enumName);
      const members = info?.members ?? (imported?.kind === "enumObject" ? imported.members : null);
      if (!members) {
        // ENM-I9 first half: a namespace import in a type position is the
        // common way here; the old "'m' is not an enum" text answered a
        // question nobody asked.
        const namespaceSource = this.host.namespaceImportLocals.get(syntax.enumName);
        if (namespaceSource !== undefined) {
          // The path is one mistake however it is spelled, so it earns one
          // sentence. A written argument list changes only the rewrite the
          // sentence names: the import carries the declaration, and the
          // arguments go on the imported name.
          const applied = syntax.arguments && syntax.arguments.length > 0
            ? `${syntax.member}<${syntax.arguments.map(formatTypeSyntax).join(", ")}>`
            : null;
          this.host.typeError(
            `Namespace members cannot be written in type positions; import '${syntax.member}' by name — import {${syntax.member}} from ${JSON.stringify(namespaceSource)} — `
            + (applied !== null
              ? `and write '${applied}'`
              : `or bind an enum object first with const ${syntax.member} = ${syntax.enumName}.${syntax.member}`),
            syntax.enumNameSpan,
          );
          return false;
        }
        this.host.typeError(`'${syntax.enumName}' is not an enum and cannot qualify a singleton type`, syntax.enumNameSpan);
        return false;
      }
      if (!members.has(syntax.member)) {
        this.host.typeError(`Enum '${syntax.enumName}' has no member '${syntax.member}'`, syntax.memberSpan);
        return false;
      }
      if (syntax.arguments) {
        // The path names one enum member, and a member is a single state
        // rather than a declaration arguments can be applied to.
        this.host.typeError(
          `Enum singleton type '${syntax.enumName}.${syntax.member}' takes no type arguments; it names one member of '${syntax.enumName}'`,
          syntax.span,
        );
        return false;
      }
      return true;
  }

  /** An application `Name<A, B>`: the template, its arguments, and the built-in constructors. */
  private validateGenericTypeSyntax(
    syntax: Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>,
    validate: (syntax: TypeSyntax) => boolean,
    resolver: (reference: TypeReference) => ValueType,
  ): boolean {
      let valid = true;
      const generic = this.host.genericTypes.get(syntax.name);
      if (generic) {
        const argumentsValid = syntax.arguments.map(validate).every(Boolean);
        return argumentsValid && this.host.validateGenericApplication(generic, syntax);
      }
      const genericClass = this.host.classes.get(syntax.name);
      if (genericClass?.typeParameterNames?.length) {
        const argumentsValid = syntax.arguments.map(validate).every(Boolean);
        return argumentsValid && this.host.validateGenericClassApplication(syntax.name, genericClass, syntax);
      }
      if (syntax.name !== "List" && syntax.name !== "Set" && syntax.name !== "Map" && syntax.name !== "Record" && syntax.name !== "Promise" && syntax.name !== "Type") {
        const resolved = resolver({ syntax, span: syntax.span });
        if (resolved.kind === "named") {
          this.host.typeError(`Unknown type '${syntax.name}'`, syntax.nameSpan);
          valid = false;
        }
      }
      const argumentsValid = syntax.arguments.map(validate).every(Boolean);
      if (valid && argumentsValid && syntax.name === "Promise") {
        this.host.reportPromiseCarrierHazard(resolver({ syntax, span: syntax.span }), syntax.span);
      }
      if (valid && argumentsValid && (syntax.name === "Set" || syntax.name === "Map") && syntax.arguments.length > 0) {
        const keySyntax = syntax.arguments[0]!;
        this.host.rejectCollidingKeyDomain(
          resolver({ syntax: keySyntax, span: keySyntax.span }),
          keySyntax.span,
          syntax.name === "Set" ? "Set element type" : "Map key type",
        );
      }
      return valid && argumentsValid;
  }

  /** D44 rule 72: `readonly` accepts pure data, at the surface and at every depth below it. */
  private validateReadonlyTypeSyntax(
    syntax: Extract<TypeSyntax, { kind: "ReadonlyTypeSyntax" }>,
    validate: (syntax: TypeSyntax) => boolean,
    resolver: (reference: TypeReference) => ValueType,
  ): boolean {
      const innerValid = validate(syntax.inner);
      if (!innerValid) return false;
      if (syntax.inner.kind === "ReadonlyTypeSyntax") {
        this.host.typeError("A readonly view is already read-only; remove the duplicate 'readonly'", syntax.span);
        return false;
      }
      const resolved = resolver({ syntax, span: syntax.span });
      const supported = (type: ValueType): boolean => {
        if (type.kind === "null") return true;
        if (type.kind === "optional") return supported(type.inner);
        if (type.kind === "union") return type.members.every(supported);
        if (type.kind === "named") {
          return !this.host.isPrimitiveType(type.name)
            && this.host.fieldsOf(type.identity ?? type.name) !== null
            && isReadonlyView(type);
        }
        return (type.kind === "list" || type.kind === "set" || type.kind === "map" || type.kind === "record"
          || type.kind === "object") && isReadonlyView(type);
      };
      const containsData = (type: ValueType): boolean => type.kind === "optional" ? containsData(type.inner)
        : type.kind === "union" ? type.members.some(containsData)
          : isReadonlyView(type);
      if (supported(resolved) && containsData(resolved)) {
        // D44 rule 72: the surface check above admits only data shapes;
        // this closes the same boundary at every reachable depth.
        const violation = this.host.findClassInReadonlyData(resolved);
        if (violation) {
          this.host.typeError(
            `'readonly' accepts only pure data at every depth; '${describeType(mutableViewOf(resolved))}${violation.suffix}' is class '${violation.className}' — model it as a data record, or drop 'readonly'`,
            syntax.span,
          );
          return false;
        }
        return true;
      }
      this.host.typeError(`'readonly' applies only to data records, structural objects, List, Set, Map, and Record values; ${describeType(resolved)} is outside that boundary`, syntax.span);
      return false;
  }

  resolveNamedClasses(type: ValueType): ValueType {
    // D55 rule 121: an application written in this module arrives carrying the
    // source name and unresolved arguments. Canonicalizing it here — the one
    // step that already turns names into identities — is what makes `Box<Id>`
    // and `Box<string>` one identity when `Id` is an alias, and what notes the
    // instantiation so its field table can be built when asked for.
    if (type.kind === "named" && type.application) {
      const resolved = this.host.resolveGenericApplication(type, (argument) => this.resolveNamedClasses(argument));
      if (resolved) return resolved;
      // D55 rule 120 layer two: the same canonicalization for a class
      // application, so `Stack<number>` written in two modules is one identity.
      const instantiated = this.host.resolveGenericClassApplication(type);
      if (instantiated) return instantiated;
    }
    if (type.kind === "named" && !type.identity) {
      const parameter = this.host.typeParameterFrames.at(-1)?.get(type.name);
      if (parameter) return parameter;
    }
    if (type.kind === "named" && this.host.enums.has(type.name)) {
      return { kind: "enum", name: type.name, identity: this.host.enums.get(type.name)!.identity };
    }
    if (type.kind === "enumMember") {
      const local = this.host.enums.get(type.name);
      if (local) return { ...type, identity: local.identity };
      const imported = this.host.lookup(type.name)?.type ?? this.host.importBindings.get(type.name);
      if (imported?.kind === "enumObject") return { ...type, identity: imported.identity };
    }
    if (type.kind === "named") {
      const imported = this.host.lookup(type.name)?.type ?? this.host.importBindings.get(type.name) ?? this.host.externTypeImports.get(type.name);
      if (imported?.kind === "classConstructor") {
        return {
          kind: "class",
          name: type.name,
          ...(imported.identity ? { identity: imported.identity } : {}),
        };
      }
      // CLS-I4, found while checking that the composition the diagnostic
      // recommends actually works: the extern type import records the class
      // type itself, not its constructor, so this branch used to fall through
      // and a class field or record field annotated with an extern class froze
      // into a structural named type. The declaration looked fine and the
      // member read failed with "has no field", which is the same silent
      // degradation the bridge is not allowed to have. Only the extern table
      // may answer with a `class` type — a local binding that merely holds an
      // instance must never become a type name.
      if (imported && imported === this.host.externTypeImports.get(type.name) && imported.kind === "class") return imported;
    }
    if (type.kind === "named" && this.host.classes.has(type.name)) {
      const info = this.host.classInfo(type.name);
      return {
        kind: "class",
        name: type.name,
        ...(info?.identity ? { identity: info.identity } : {}),
      };
    }
    if (type.kind === "named" && !type.identity && this.host.namedTypeIdentities.has(type.name)) {
      return { ...type, identity: this.host.namedTypeIdentities.get(type.name)! };
    }
    if (type.kind === "optional") {
      return optionalOf(this.resolveNamedClasses(type.inner));
    }
    if (type.kind === "list") {
      return { ...type, element: this.resolveNamedClasses(type.element) };
    }
    if (type.kind === "set") {
      return { ...type, element: this.resolveNamedClasses(type.element) };
    }
    if (type.kind === "map") {
      return { ...type, key: this.resolveNamedClasses(type.key), value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "record") {
      return { ...type, value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "promise") {
      return { kind: "promise", value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "runtimeType") {
      return { kind: "runtimeType", value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "typeObject" && type.value) {
      return { ...type, value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") {
      return {
        ...type,
        parameters: type.parameters.map((parameter) => this.resolveNamedClasses(parameter)),
        ...(type.rest ? { rest: this.resolveNamedClasses(type.rest) } : {}),
        result: this.resolveNamedClasses(type.result),
      };
    }
    if (type.kind === "extension") {
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, this.resolveNamedClasses(value)])),
        arguments: type.arguments.map((argument) => this.resolveNamedClasses(argument)),
      };
    }
    if (type.kind === "union") {
      return { kind: "union", members: type.members.map((member) => this.resolveNamedClasses(member)) };
    }
    return type;
  }
}
