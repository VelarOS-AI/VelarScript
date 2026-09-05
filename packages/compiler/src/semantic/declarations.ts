/**
 * Declaring a name: the symbol one declaration publishes, the scope it is
 * declared in, and the two module-boundary forms — an `import` and a
 * `re-export` — whose declarations name another module.
 *
 * D115 §三 / D114 R1f: the declaration half of `semantic.ts`, joined by the two
 * display functions that were `semantic-declarations.ts`.
 */
import type { ContextMarker, ImportDeclaration, ReExportDeclaration, TypeParameterDeclaration } from "../ast.ts";
import { type SourceText, type Span } from "../source.ts";
import { describeType, type ValueType } from "../types.ts";
import { documentationBefore } from "./documentation.ts";
import { wordSpans } from "./references.ts";
import {
  semanticBindingKey,
  type Scope,
  type SemanticImport,
  type SemanticModuleReference,
  type SemanticSymbol,
  type SemanticMember,
  type SemanticSymbolKind,
  type DeclareOptions,
} from "./symbols.ts";

/** What the declaration half asks of the index that hosts it, and nothing more. */
export interface SemanticDeclarationsHost {
  readonly allScopes: Scope[];
  readonly bindingMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  readonly bindingTypes: ReadonlyMap<string, ValueType>;
  callable(type: ValueType | undefined): boolean;
  readonly contextMarkersBySpecificity: readonly ContextMarker[];
  readonly declarations: WeakMap<object, SemanticSymbol>;
  describeMembers(memberTypes: ReadonlyMap<string, ValueType>): readonly SemanticMember[];
  readonly imports: SemanticImport[];
  readonly moduleReferences: SemanticModuleReference[];
  moduleSourceSpan(valueSpan: Span): Span;
  nextScopeId: number;
  readonly scopes: Scope[];
  semanticIdentity(type: ValueType | undefined): string | null;
  readonly source: SourceText;
  readonly symbols: SemanticSymbol[];
}

export class SemanticDeclarations {
  private readonly host: SemanticDeclarationsHost;

  constructor(host: SemanticDeclarationsHost) {
    this.host = host;
  }

  contextMarkerFor(declarationSpan: Span) {
    return this.host.contextMarkersBySpecificity.find((marker) =>
      marker.targetSpan.start <= declarationSpan.start && marker.targetSpan.end >= declarationSpan.end);
  }

  currentScope(): Scope {
    return this.host.scopes.at(-1)!;
  }

  enterScope(scopeSpan: Span): void {
    const scope = { id: this.host.nextScopeId++, parentId: this.currentScope().id, span: scopeSpan, bindings: new Map<string, SemanticSymbol>() };
    this.host.scopes.push(scope);
    this.host.allScopes.push(scope);
  }

  exitScope(): void { this.host.scopes.pop(); }

  declare(
    owner: object,
    name: string,
    kind: SemanticSymbolKind,
    declarationSpan: Span,
    selectionSpan: Span,
    exported = false,
    mutable = false,
    lexical = true,
    container?: string,
    explicitType?: string,
    staticMember = false,
    options: DeclareOptions = {},
  ): SemanticSymbol {
    const existing = this.host.declarations.get(owner);
    if (existing) return existing;
    const key = semanticBindingKey(declarationSpan, name);
    const type = this.host.bindingTypes.get(key);
    const memberTypes = this.host.bindingMembers.get(key) ?? new Map<string, ValueType>();
    const members = this.host.describeMembers(memberTypes);
    const contextMarker = this.contextMarkerFor(declarationSpan);
    const context = contextMarker?.name;
    const typeIdentity = this.host.semanticIdentity(type);
    const documentationStart = options.documentationStart
      ?? (contextMarker?.targetSpan.start === declarationSpan.start
        && contextMarker.targetSpan.end === declarationSpan.end
        ? contextMarker.markerSpan.start
        : declarationSpan.start);
    const symbol: SemanticSymbol = {
      id: `${this.host.source.path}#${selectionSpan.start}:${name}`,
      name,
      kind,
      path: this.host.source.path,
      span: declarationSpan,
      selectionSpan,
      scopeId: this.currentScope().id,
      exported,
      mutable,
      private: options.private ?? false,
      type: explicitType ?? (type ? declarationTypeDisplay(type, options.boundedTypeParameters === true) : null),
      ...(type ? { typeKind: type.kind } : {}),
      ...(typeIdentity ? { typeIdentity } : {}),
      documentation: documentationBefore(this.host.source, documentationStart),
      ...(context ? { context } : {}),
      members,
      ...(this.host.callable(type) ? { callable: true as const } : {}),
      ...(options.typeTarget ? { typeTarget: options.typeTarget } : {}),
      ...(container ? { container } : {}),
      ...(kind === "method" || kind === "field" ? { static: staticMember } : {}),
      ...(options.sourceTypeHint ?? kind === "variable" ? { sourceTypeHint: true as const } : {}),
      ...(options.presentationKind ? { presentationKind: options.presentationKind } : {}),
    };
    this.host.symbols.push(symbol);
    if (lexical) this.currentScope().bindings.set(name, symbol);
    this.host.declarations.set(owner, symbol);
    return symbol;
  }

  declareImport(statement: ImportDeclaration): void {
    this.host.moduleReferences.push({ source: statement.source, span: this.host.moduleSourceSpan(statement.sourceSpan), dynamic: false });
    for (const specifier of statement.specifiers) {
      const words = wordSpans(this.host.source.text, specifier.span);
      const importedSpan = specifier.namespace
        ? words[0] ?? specifier.span
        : words.find((word) => this.host.source.text.slice(word.start, word.end) === specifier.imported) ?? words[0] ?? specifier.span;
      const localSpan = [...words].reverse().find((word) => this.host.source.text.slice(word.start, word.end) === specifier.local) ?? importedSpan;
      const symbol = this.declare(specifier, specifier.local, "import", specifier.span, localSpan);
      this.host.imports.push({
        source: statement.source,
        imported: specifier.imported,
        importedSpan,
        local: specifier.local,
        localSpan,
        localSymbolId: symbol.id,
        namespace: specifier.namespace,
      });
    }
  }

  declareReExport(statement: ReExportDeclaration): void {
    this.host.moduleReferences.push({ source: statement.source, span: this.host.moduleSourceSpan(statement.sourceSpan), dynamic: false });
    for (const specifier of statement.specifiers) {
      const words = wordSpans(this.host.source.text, specifier.span);
      const importedSpan = words.find((word) => this.host.source.text.slice(word.start, word.end) === specifier.imported) ?? words[0] ?? specifier.span;
      const exportedSpan = [...words].reverse().find((word) => this.host.source.text.slice(word.start, word.end) === specifier.exported) ?? importedSpan;
      // A re-export is not a lexical binding: the exported alias is visible to
      // importers only, so the symbol stays out of the module scope chain.
      const symbol = this.declare(specifier, specifier.exported, "import", specifier.span, exportedSpan, true, false, false);
      this.host.imports.push({
        source: statement.source,
        imported: specifier.imported,
        importedSpan,
        local: specifier.exported,
        localSpan: exportedSpan,
        localSymbolId: symbol.id,
        namespace: false,
      });
    }
  }
}

/**
 * The display text a generic record or class declaration publishes for itself.
 * A `def` carries its parameters into a hover through the function type it
 * describes; a class and a record have no such type — their symbols read back
 * the bare name, so `class Stack<T: Comparable>` hovered as `class Stack: Stack`
 * and `type Box<T>` as `type Box: Box`, and the reader was never told the
 * declaration takes a parameter at all, let alone what it must satisfy. A
 * declaration with no parameters answers `undefined` and keeps the type its
 * binding already describes.
 */
export function declaredTypeParameters(
  name: string,
  parameters: readonly TypeParameterDeclaration[] | undefined,
): string | undefined {
  if (!parameters?.length) return undefined;
  const rendered = parameters.map((parameter) => parameter.bound ? `${parameter.name}: ${parameter.bound}` : parameter.name);
  return `${name}<${rendered.join(", ")}>`;
}

/**
 * How a symbol's own type is written. Ordinary symbols use `describeType`,
 * which erases type-parameter bounds: `def top<T: Comparable>` hovered as
 * `<T>(…)` while the class beside it showed `Stack<T: Comparable>` — one
 * declaration, two answers about the same list. A *declaration* asks for the
 * bounded form, and gets it by naming each parameter the way the declaration
 * spells it and letting `describeType` render the rest, so the two displays
 * cannot drift apart.
 */
export function declarationTypeDisplay(type: ValueType, bounded: boolean): string {
  if (!bounded || (type.kind !== "function" && type.kind !== "action" && type.kind !== "intrinsic")) return describeType(type);
  const names = type.typeParameterNames;
  const bounds = type.typeParameterBounds;
  if (!names?.length || !bounds?.some((bound) => bound !== null)) return describeType(type);
  return describeType({ ...type, typeParameterNames: names.map((name, index) => bounds[index] ? `${name}: ${bounds[index]}` : name) });
}
