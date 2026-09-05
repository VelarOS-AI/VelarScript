/**
 * Code that is not Vel, declared to Vel: an `extern module` with its extern
 * classes and functions, and an inline JavaScript block with its captures.
 *
 * D114 R1f: both statement heads leave `analyzer.ts` together because both
 * answer the same question — what a foreign declaration is allowed to promise,
 * and which of those promises Core can still check. The resolution of an extern
 * annotation stays in `modules/imports.ts`, which owns the module the names
 * come from; this module owns only the statement that declares them.
 */
import { type Expression, type ExternFunctionDeclaration, type Statement, type TypeParameterDeclaration, type TypeReference } from "../../ast.ts";
import { type ClassField } from "../../contracts.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import {
  describeType,
  sameType,
  sameTypeIgnoringCallableParameterNames,
  type ValueType,
} from "../../types.ts";
import { asyncResultAnnotationMessage } from "../functions.ts";
import { type Binding, type MutableCellTarget } from "../scopes.ts";

/**
 * Everything the foreign-declaration statements ask of the analyzer that hosts
 * them, and nothing more.
 */
export interface ExternStatementsHost {
  asyncResultContainsPromise(type: ValueType): boolean;
  checkTypeParameterDeclarations(declarations: readonly TypeParameterDeclaration[] | undefined): void;
  readonly diagnostics: Diagnostic[];
  externClassIdentity(source: string, name: string): string;
  externFunctionType(statement: ExternFunctionDeclaration, resolve?: (reference: TypeReference | null) => ValueType): ValueType;
  findField(className: string, name: string): ClassField | null;
  findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferParameterDefault(expression: Expression, contextualType?: ValueType): ValueType;
  readonly invalidExternTypeReferences: WeakSet<TypeReference>;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  reportPromiseCarrierHazard(type: ValueType, errorSpan: Span): void;
  reportPromiseResolutionHazard(type: ValueType, errorSpan: Span): void;
  resolveValidatedAnnotation(reference: TypeReference | null): ValueType;
  resolveValidatedExternAnnotation(reference: TypeReference | null, source: string, classNames: ReadonlySet<string>): ValueType;
  readonly scopes: Map<string, Binding>[];
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  typeParameterFrame(declarations: readonly TypeParameterDeclaration[] | undefined): ReadonlyMap<string, ValueType>;
  validateClassMemberName(name: string, memberSpan: Span, external?: boolean): void;
  validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean;
  withTypeParameterFrame<T>(frame: ReadonlyMap<string, ValueType>, action: () => T): T;
}

export class ExternStatements {
  private readonly host: ExternStatementsHost;

  constructor(host: ExternStatementsHost) {
    this.host = host;
  }

  analyzeExternModuleDeclaration(statement: Extract<Statement, { kind: "ExternModuleDeclaration" }>): void {
    if (this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic("VEL3011", "Extern modules can only be declared at module scope", statement.span));
    }
    this.checkExternModuleClasses(statement);
    for (const declaration of statement.functions) {
      this.host.checkTypeParameterDeclarations(declaration.typeParameters);
      this.host.withTypeParameterFrame(this.host.typeParameterFrame(declaration.typeParameters), () => {
        for (const parameter of declaration.parameters) {
          const classNames = new Set(statement.classes.map((item) => item.name));
          const type = this.host.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
          const valid = !parameter.type || !this.host.invalidExternTypeReferences.has(parameter.type);
          if (parameter.defaultValue && valid) this.host.requireAssignable(this.host.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
        }
        const classNames = new Set(statement.classes.map((item) => item.name));
        const result = this.host.resolveValidatedExternAnnotation(declaration.returnType, statement.source, classNames);
        if (declaration.returnType) {
          const valid = !this.host.invalidExternTypeReferences.has(declaration.returnType);
          if (valid && declaration.asynchronous && this.host.asyncResultContainsPromise(result)) {
            this.host.diagnostics.push(diagnostic("VEL4018", asyncResultAnnotationMessage, declaration.returnType.span));
          } else if (valid) {
            if (declaration.asynchronous) this.host.reportPromiseResolutionHazard(result, declaration.returnType.span);
            else this.host.reportPromiseCarrierHazard(result, declaration.returnType.span);
          }
        }
      });
    }
  }

  /** Every `extern class` in one `extern module`: its base, its members, and its duplicates. */
  private checkExternModuleClasses(statement: Extract<Statement, { kind: "ExternModuleDeclaration" }>): void {
    const classNames = new Set(statement.classes.map((declaration) => declaration.name));
    const bases = new Map(statement.classes.map((declaration) => [declaration.name, declaration.base]));
    for (const declaration of statement.classes) {
      const members = new Set<string>();
      if (declaration.base && !classNames.has(declaration.base)) {
        this.host.typeError(`Unknown extern base class '${declaration.base}'`, declaration.span);
      } else if (declaration.base) {
        const visited = new Set([declaration.name]);
        let current: string | null = declaration.base;
        while (current) {
          if (visited.has(current)) {
            this.host.typeError(`Extern class '${declaration.name}' has a cyclic inheritance relationship`, declaration.span);
            break;
          }
          visited.add(current);
          current = bases.get(current) ?? null;
        }
      }
      for (const parameter of declaration.parameters) {
        const type = this.host.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
        const valid = !parameter.type || !this.host.invalidExternTypeReferences.has(parameter.type);
        if (parameter.defaultValue && valid) this.host.requireAssignable(this.host.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
        if (parameter.binding) members.add(`instance:${parameter.name}`);
      }
      for (const field of declaration.fields) {
        this.host.validateClassMemberName(field.name, field.span, true);
        const key = `${field.static ? "static" : "instance"}:${field.name}`;
        if (members.has(key)) this.host.typeError(`Extern class '${declaration.name}' declares member '${field.name}' more than once`, field.span);
        members.add(key);
      }
      for (const getter of declaration.getters) {
        this.host.validateClassMemberName(getter.name, getter.span, true);
        const key = `${getter.static ? "static" : "instance"}:${getter.name}`;
        if (members.has(key)) this.host.typeError(`Extern class '${declaration.name}' declares member '${getter.name}' more than once`, getter.span);
        members.add(key);
      }
      for (const method of declaration.methods) {
        this.host.validateClassMemberName(method.name, method.span, true);
        const key = `${method.static ? "static" : "instance"}:${method.name}`;
        if (members.has(key)) this.host.typeError(`Extern class '${declaration.name}' declares member '${method.name}' more than once`, method.span);
        members.add(key);
        this.host.checkTypeParameterDeclarations(method.typeParameters);
        this.host.withTypeParameterFrame(this.host.typeParameterFrame(method.typeParameters), () => {
          for (const parameter of method.parameters) {
            const type = this.host.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
            const valid = !parameter.type || !this.host.invalidExternTypeReferences.has(parameter.type);
            if (parameter.defaultValue && valid) this.host.requireAssignable(this.host.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
          }
          if (method.returnType) {
            const result = this.host.resolveValidatedExternAnnotation(method.returnType, statement.source, classNames);
            if (!this.host.invalidExternTypeReferences.has(method.returnType) && method.asynchronous && this.host.asyncResultContainsPromise(result)) {
              this.host.diagnostics.push(diagnostic("VEL4018", asyncResultAnnotationMessage, method.returnType.span));
            } else if (!this.host.invalidExternTypeReferences.has(method.returnType)) {
              if (method.asynchronous) this.host.reportPromiseResolutionHazard(result, method.returnType.span);
              else this.host.reportPromiseCarrierHazard(result, method.returnType.span);
            }
          }
        });
      }
      if (declaration.base && classNames.has(declaration.base)) {
        const base = this.host.externClassIdentity(statement.source, declaration.base);
        const ownFields = [
          ...declaration.parameters.filter((parameter) => parameter.binding).map((parameter) => ({
            name: parameter.name,
            mutable: parameter.binding === "let",
            type: this.host.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames),
            span: parameter.span,
          })),
          ...declaration.fields.filter((field) => !field.static).map((field) => ({
            name: field.name,
            mutable: field.mutable,
            type: this.host.resolveValidatedExternAnnotation(field.type, statement.source, classNames),
            span: field.span,
          })),
        ];
        for (const field of ownFields) {
          if (this.host.findMethod(base, field.name) || this.host.findGetter(base, field.name)) {
            this.host.typeError(`Extern field '${field.name}' conflicts with an inherited executable member`, field.span);
          }
          const inherited = this.host.findField(base, field.name);
          if (inherited && (inherited.mutable !== field.mutable || !sameType(inherited.type, field.type))) {
            this.host.typeError(`Inherited extern field '${field.name}' must keep its ${inherited.mutable ? "let" : "const"} ${describeType(inherited.type)} contract`, field.span);
          }
        }
        for (const getter of declaration.getters.filter((item) => !item.static)) {
          if (this.host.findField(base, getter.name) || this.host.findMethod(base, getter.name)) {
            this.host.typeError(`Extern getter '${getter.name}' conflicts with an inherited field or method`, getter.span);
          }
          const inherited = this.host.findGetter(base, getter.name);
          const own = this.host.resolveValidatedExternAnnotation(getter.type, statement.source, classNames);
          if (inherited && !sameType(inherited.type, own)) {
            this.host.typeError(`Extern getter override '${getter.name}' must keep the base result ${describeType(inherited.type)}`, getter.span);
          }
        }
        for (const method of declaration.methods.filter((item) => !item.static)) {
          if (this.host.findField(base, method.name) || this.host.findGetter(base, method.name)) {
            this.host.typeError(`Extern method '${method.name}' conflicts with an inherited field or getter`, method.span);
          }
          const inherited = this.host.findMethod(base, method.name);
          const own = this.host.externFunctionType(method, (reference) => this.host.resolveValidatedExternAnnotation(reference, statement.source, classNames));
          if (inherited && !sameTypeIgnoringCallableParameterNames(inherited.type, own)) {
            this.host.typeError(`Extern override '${method.name}' must keep the base method signature ${describeType(inherited.type)}`, method.span);
          }
        }
      }
    }
  }

  analyzeEmbeddedJavaScriptDeclaration(statement: Extract<Statement, { kind: "EmbeddedJavaScriptDeclaration" }>): void {
    if (this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic(
        "VEL3011",
        "Inline JavaScript blocks can only be declared at module scope",
        statement.span,
      ));
    }
    for (const capture of statement.captures) {
      const annotationValid = this.host.validateTypeReference(capture.type);
      const declared = this.host.resolveValidatedAnnotation(capture.type);
      const value: Expression = {
        kind: "IdentifierExpression",
        name: capture.name,
        span: capture.nameSpan,
      };
      const actual = this.host.inferExpression(value, declared);
      if (annotationValid) this.host.requireAssignable(actual, declared, capture.nameSpan);
    }
  }
}
