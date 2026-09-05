/**
 * What a scope holds: the record one name resolves to, and the facts flow
 * analysis writes onto it.
 *
 * D114 R1d: `Binding`, `MemberNarrowing`, `PendingScopeDeclaration` and
 * `MutableCellTarget` were declared inside `analyzer.ts` and read by nothing
 * else, because nothing else existed. The flow cluster under `./flow/` is the
 * heaviest reader of all four — a narrowing writes a `Binding`, a member fact
 * is a `MemberNarrowing` — so they move to the module that names the concept
 * rather than to the one that happened to hold it. `analyzer.ts` imports them
 * back, and the `protected` signatures that mention `Binding` are unchanged.
 */
import {
  type BindingPattern,
  type Expression,
  type FunctionDeclaration,
  type Statement,
  type TypeParameterDeclaration,
} from "../ast.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../diagnostic.ts";
import { type PermanentNamespaceImports } from "./retired-imports.ts";
import { type LoweringRecorder } from "./lowering-recorder.ts";
import { NearestNameRoster } from "./nearest-names.ts";
import { spanIdentity, type Span } from "../source.ts";
import { bindingNameRestriction } from "../source-names.ts";
import { VELAR_HOST_ERROR_NAMES } from "../error-runtime.ts";
import { coreVocabularyType, coreVocabularyTypes } from "./vocabulary.ts";
import {
  anyType,
  isReadonlyView,
  describeType,
  isInvalidType,
  optionalOf,
  unknownType,
  type ValueType,
} from "../types.ts";

/**
 * The mutable binding an assignment writes into, for the one refusal whose fix
 * lives on the declaration line rather than the assignment line. See
 * `enumSingletonCellGuidance`.
 */
export interface MutableCellTarget {
  readonly name: string;
  readonly keyword: "let" | "state";
}

export interface Binding {
  readonly mutable: boolean;
  /** 由普通 `const` 变量声明拥有的一次性值副本；参数、导入和响应式绑定不具备。 */
  stableOptionalCopy?: boolean;
  type: ValueType;
  declaredType: ValueType;
  storageType: ValueType;
  readonly storageBinding?: Binding;
  readonly span: Span;
  narrowingFrame: number | null;
  /**
   * The scope depth this binding was created at. A flow snapshot only visits
   * bindings whose facts have actually moved, and this is how the set of those
   * is emptied again when the scope holding them exits.
   */
  readonly flowScope?: number;
  /**
   * D44 rule 71: true while the active narrowing was established by an
   * assignment (or a declaration initializer) rather than a check. Only
   * meaningful when narrowingFrame is not null. Assigned facts refine reads;
   * equality tests still judge the declared domain (storageType).
   */
  assignedFact?: boolean;
  // Exact reactive identity belongs to the resolved lexical binding, not to
  // its spelling. Lowering records each resolved read/write span so local
  // state can shadow (and be shadowed by) ordinary bindings safely.
  reactiveKind?: "state" | "prop";
  /**
   * D51 rule 101: the binding holds — or carries — a resource this scope owns
   * and releases at its exit. `handle` is the `using` name to blame, and
   * `depth` is the scope nesting level that releases it, so a store into any
   * shallower binding is a store into something that outlives the release.
   */
  ownedResource?: { readonly handle: string; readonly depth: number };
}

export interface MemberNarrowing {
  readonly type: ValueType;
  readonly frame: number;
  /**
   * D44 rule 71: true when the fact was established by an assignment rather
   * than a check. Assigned facts refine reads, but an equality test still
   * asks about the declared domain, so `x == null` after `x = "a"` stays a
   * real question instead of a rejected constant.
   */
  readonly assigned?: boolean;
  /** The declared type of the location an assigned fact refines (its test-domain). */
  readonly domain?: ValueType;
}

export interface PendingScopeDeclaration {
  readonly span: Span;
  readonly loopHead: boolean;
}

/**
 * The scope chain as it stood at one point, read back on demand. Flattening
 * every live scope into a fresh Map made each block, loop and match cost
 * O(names in the module), which is most of what made whole-module analysis
 * quadratic in module size. The depth is enough: scopes are a stack, so the
 * scopes below a construct's own are exactly the ones that were there, and
 * nothing adds a name to them while the construct is being analyzed.
 */
export type VisibleScopeDepth = number;

/**
 * A narrowing roster is keyed by binding name, and a member fact's key is a
 * dotted access path. This prefix keeps the two key spaces apart in one map;
 * it is a NUL byte, which no source identifier can contain.
 */
export const memberNarrowingPrefix = "\u0000member:";

/**
 * The declaration positions that also introduce a *type* name, named for the
 * one sentence that refuses a built-in spelling in any of them.
 */
export type BuiltinTypeNamePosition = "type" | "class" | "enum" | "imported name" | "import alias" | "type parameter";

// D114 ③ retired `Function` as a type *spelling*, but it stays a recognized
// reserved type name: the parser has to know it to report the retirement, and
// this roster is what tells a wrong type-parameter bound apart from an unknown
// one, so `<T: Function>` still says which kind of mistake it is.
export const builtinTypeNames = new Set(["string", "number", "bool", "null", "unknown", "any", "List", "Set", "Map", "Record", "Promise", "Function", "Type", "Duration"]);
/**
 * D72 rule 186 over the Core roster, and charter §5 and §7: the built-in type
 * names are reserved. A user declaration spelled with one used to be accepted
 * where it was written and then lose at every use — `type Duration:` compiled,
 * and `const d: Duration = {label: "a"}` was told it could not assign to a type
 * the author had just declared. Half the roster lost the other way and shadowed
 * the built-in for bare uses only, so `type List:` left `List` meaning the user
 * record and `List<string>` on the next line still meaning the built-in. D51
 * rule 109 puts the refusal at the declaration, the only place a rename is
 * cheap.
 *
 * Two refusals already say this sentence about smaller rosters:
 * `rejectReservedTypeNames` for the three type-parameter bounds (D51 rule 109,
 * VEL4021) and `rejectWebOwnedTypeNames` in packages/web/src/analyzer.ts for
 * the Web type names (VEL5065). This is the same sentence over Core's own
 * roster, so all three read alike. Before it, only `number`, `Set`, `Map` and
 * `Promise` were refused, and only incidentally — they are *also* reserved Core
 * bindings — so one rule reached four of fourteen names by accident.
 *
 * Unlike its two siblings this is asked from `declareBinding` rather than from
 * a pass over `program.body`, because those four names carry both answers and
 * only the declaration site can decide which sentence the author earns: the
 * reserved-binding report and this one are the two arms of one `if`, so a name
 * that is a built-in type and a reserved Core binding is still one mistake with
 * one report. The roster is `builtinTypeNames`, which `isDeclaredTypeName`
 * already reads, so a built-in added there is covered here without a new
 * branch.
 */
export function builtinTypeNameDeclarationMessage(name: string, position: BuiltinTypeNamePosition): string {
  const article = /^[aeiou]/iu.test(position) ? "an" : "a";
  return `'${name}' is a Core type name, so it cannot also name ${article} ${position}`
    + "; every use of it resolves to the built-in. Rename this declaration";
}
/**
 * D90 (coherence): the foreign builtins — Python's and the host's — that a
 * model writes from prior knowledge. A "did you mean" is an edit-distance
 * guess over names this module can actually see, and on a foreign builtin it
 * is confidently wrong: `sum` earned `str`, `max` and `map` earned `Map`,
 * `dir` earned `str`. docs/ai-skill.md tells the model to do exactly what the
 * diagnostic says, so a wrong successor is worse than none.
 *
 * Every name that has a Vel answer is in `coreGlobalGuidance` above, which is
 * consulted first and short-circuits the guess on its own. This roster is the
 * floor under the rest: a foreign builtin with no successor reads as a bare
 * unknown name and stops there. It is deliberately a suppression rather than a
 * change to `uniqueNearestName`, whose threshold and roster serve the field-
 * name hints too.
 */
const foreignBuiltinNames: ReadonlySet<string> = new Set([
  // Python
  "sum", "min", "max", "sorted", "reversed", "any", "all", "isinstance", "input", "open",
  "filter", "map", "repr", "dir", "type", "id", "next", "iter", "format", "divmod", "pow",
  "bytes", "tuple", "frozenset", "globals", "locals", "vars", "hasattr", "getattr", "setattr",
  "callable", "issubclass", "abs", "round", "ord", "chr", "hex", "oct", "bin", "hash",
  // Node and browser hosts
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "structuredClone", "queueMicrotask",
  "URL", "URLSearchParams", "RegExp", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal",
  "Symbol", "Proxy", "Reflect", "WeakMap", "WeakSet", "BigInt", "Intl", "globalThis",
  "process", "Buffer", "require", "__dirname", "__filename", "module", "exports", "global",
  "localStorage", "sessionStorage", "fetch", "document", "window", "navigator", "alert",
]);

/**
 * Everything the scope stack asks of the analyzer that hosts it.
 */
export interface ScopeStackHost {
  readonly diagnostics: Diagnostic[];
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  readonly extensionGlobals: Map<string, ValueType>;
  readonly extensionReservedBindings: Set<string>;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonly flowFrameDepth: number;
  functionResultKey(statement: Pick<FunctionDeclaration, "signatureSpan">): string;
  readonly functionResultKeys: Map<Binding, string>;
  functionType(statement: FunctionDeclaration, classParameters?: readonly TypeParameterDeclaration[]): ValueType;
  readonly globalGuidance: Map<string, string>;
  readonly importBindings: ReadonlyMap<string, ValueType>;
  readonly importedBindingOrigins: Map<Binding, string>;
  readonly lowering: LoweringRecorder;
  readonly modulePath: string | null;
  readonly namespaceImports: PermanentNamespaceImports;
  readonly predeclared: WeakSet<object>;
  prescanExtensionScopeDeclaration(_statement: Statement): { readonly name: string; readonly span: Span } | null;
  readonlyDataViewOf(type: ValueType): ValueType;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  recordSemanticBinding(key: string, type: ValueType): void;
  readonly scopedGlobalGuidance: Map<string, Map<string, string>>;
  readonly semanticBindingEntryOwners: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

/**
 * The scope stack itself: the chain of name-to-binding maps a lookup walks, the
 * declarations a scope has promised but not yet made, the "did you mean" roster,
 * and the rules a declaration has to pass to enter a scope.
 *
 * D114 R1d: `declareBinding`, `declarePattern`, `lookup` and
 * `prescanScopeDeclarations` stay `protected` on `Analyzer` and forward here;
 * `enterScope` and `exitScope` do the same, pushing this stack and the flow
 * cluster's own in the order they were pushed before.
 */
export class ScopeStack {
  private readonly host: ScopeStackHost;

  readonly scopes: Map<string, Binding>[] = [new Map()];
  readonly pendingScopeDeclarations: Map<string, PendingScopeDeclaration>[] = [new Map()];
  /** The "did you mean" roster, and the names each scope depth contributed to it. */
  readonly nearestNames = new NearestNameRoster();
  readonly scopedNames: string[][] = [[]];
  nearestNamesSeeded = false;
  /** Every name this module declares anywhere, so a rewrite can prove it collides with nothing. */
  readonly declaredNames = new Set<string>();
  /**
   * The type names a more specific refusal has already answered for in this
   * module. The reserved-name rule is stated over three rosters — Core's
   * built-in type names here, the three type-parameter bounds in
   * `rejectReservedTypeNames`, and the Web extension's own names in
   * `rejectWebOwnedTypeNames` — and two of them overlap this one. `class Text:`
   * earned the bound's sentence *and* "reserved Core binding"; `type Duration:`
   * in a Web module earned the Web sentence *and* Core's. One mistake earns one
   * report, and the sentence that survives is the one that says why the name is
   * taken.
   */
  readonly refusedTypeNames = new Set<string>();
  readonly reportedShadowedReads = new Set<string>();

  constructor(host: ScopeStackHost) {
    this.host = host;
  }

  enterScope(): void {
    this.scopes.push(new Map());
    this.pendingScopeDeclarations.push(new Map());
    this.scopedNames.push([]);
  }

  exitScope(): void {
    this.scopes.pop();
    this.pendingScopeDeclarations.pop();
    for (const name of this.scopedNames.pop() ?? []) this.nearestNames.remove(name);
  }

  declareBinding(
    name: string,
    mutable: boolean,
    type: ValueType,
    declarationSpan: Span,
    internal = false,
    declaredType = type,
    importSource?: string,
    /**
     * Set when this binding also introduces a *type* name, which is the one
     * question `builtinTypeNameDeclarationMessage` answers. A `const` or a
     * parameter leaves it unset: naming a local `List` shadows the built-in
     * value, but `List` in a type position still means the built-in there, so
     * the reserved-type-name rule has nothing to say about it.
     */
    typeNamePosition?: BuiltinTypeNamePosition,
  ): void {
    this.pendingScopeDeclarations.at(-1)?.delete(name);
    if (!internal) {
      // One mistake, one report: `type Promise:` is a reserved Core binding and
      // a built-in type name both, and the built-in type name is what the
      // author wrote it as, so that sentence is the one it earns.
      if (typeNamePosition !== undefined && this.refusedTypeNames.has(name)) {
        // A more specific refusal already named this declaration and said why
        // the name is taken — the bound vocabulary, or the extension's own
        // roster. Saying it again over a wider roster adds no information.
      } else if (typeNamePosition !== undefined && builtinTypeNames.has(name)) {
        this.host.diagnostics.push(diagnostic("VEL3007", builtinTypeNameDeclarationMessage(name, typeNamePosition), declarationSpan));
      } else if (!this.host.namespaceImports.refusedSpecifiers.has(spanIdentity(declarationSpan))) {
        const restriction = bindingNameRestriction(name, this.host.extensionReservedBindings);
        if (restriction && restriction !== "invalid" && restriction !== "keyword" && restriction !== "source") {
          const message = restriction === "javascript"
            ? name === "arguments"
              ? "Use named parameters; VelarScript does not expose the JavaScript 'arguments' binding"
              : `'${name}' is reserved by JavaScript and cannot be used as a VelarScript binding`
            : restriction === "compiler"
              ? `'${name}' uses a reserved compiler prefix '__velar'`
              : restriction === "core"
                ? `'${name}' is a reserved Core binding`
                : restriction === "extension"
                  ? `'${name}' is a reserved extension binding`
                  : `'${name}' is not available as a VelarScript binding`;
          // The name is still declared after the report: a rejected parameter or
          // loop binding whose body reads it would otherwise add an "Unknown
          // name" for every use of the one mistake. No code is emitted from a
          // module that reported a diagnostic, so the invalid spelling never
          // reaches generated JavaScript.
          this.host.diagnostics.push(diagnostic("VEL3007", message, declarationSpan));
        }
      }
    }
    // D52 rules 114/116: every name the module binds anywhere. A migration
    // rewrite that would introduce an import only claims to be equivalent when
    // the name it introduces collides with nothing in the module.
    this.declaredNames.add(name);
    const scope = this.scopes.at(-1)!;
    if (scope.has(name)) {
      // MOD-I4: an import/local collision blames the declaration that comes
      // later in the source and names the earlier one's origin. Imports are
      // predeclared before locals analyze, so the earlier-vs-later question
      // is answered from the spans, not from the call order.
      const existing = scope.get(name)!;
      const existingImport = this.host.importedBindingOrigins.get(existing);
      if (existingImport !== undefined && existing.span.start > declarationSpan.start) {
        this.host.diagnostics.push(diagnostic(
          "VEL3004",
          `Import '${name}' collides with the earlier declaration in this module; alias it — import {${name} as other} from ${JSON.stringify(existingImport)}`,
          existing.span,
        ));
      } else if (existingImport !== undefined) {
        this.host.diagnostics.push(diagnostic(
          "VEL3004",
          importSource !== undefined
            ? `Name '${name}' is already imported from ${JSON.stringify(existingImport)}; alias one of the imports — import {${name} as other}`
            : `Name '${name}' is already imported from ${JSON.stringify(existingImport)}; rename this declaration, or alias the import — import {${name} as other}`,
          declarationSpan,
        ));
      } else if (importSource !== undefined && existing.span.start < declarationSpan.start) {
        this.host.diagnostics.push(diagnostic(
          "VEL3004",
          `Import '${name}' collides with the earlier declaration in this module; alias it — import {${name} as other} from ${JSON.stringify(importSource)}`,
          declarationSpan,
        ));
      } else {
        const laterSpan = existing.span.start > declarationSpan.start ? existing.span : declarationSpan;
        this.host.diagnostics.push(diagnostic("VEL3004", `Name '${name}' is already declared in this scope`, laterSpan));
      }
      return;
    }
    const binding: Binding = {
      mutable,
      type,
      declaredType,
      storageType: type,
      span: declarationSpan,
      narrowingFrame: null,
      flowScope: this.scopes.length - 1,
    };
    this.recordScopedName(name);
    scope.set(name, binding);
    if (this.scopes.length === 1 && type.kind === "typeObject") this.host.lowering.runtimeTypeObjectNames.add(name);
    this.host.recordSemanticBinding(`${declarationSpan.start}:${name}`, type);
  }

  /**
   * A `type`, `class` or `enum` name. Every one of them declares a binding and
   * a type name at once, so they ask `declareBinding` the reserved-type-name
   * question here rather than each repeating the argument list that carries it.
   */
  declareTypeNameBinding(name: string, type: ValueType, declarationSpan: Span, position: BuiltinTypeNamePosition): void {
    this.declareBinding(name, false, type, declarationSpan, false, undefined, undefined, position);
  }

  declarePattern(pattern: BindingPattern, mutable: boolean, type: ValueType, declaredType = type): void {
    if (pattern.kind === "NameBindingPattern") {
      this.declareBinding(pattern.name, mutable, type, pattern.span, false, declaredType);
      return;
    }
    if (pattern.kind === "ListBindingPattern") {
      const element = type.kind === "list" ? type.readonlyView ? this.host.readonlyDataViewOf(type.element) : type.element
        : type.kind === "any" ? anyType : unknownType;
      const declaredElement = declaredType.kind === "list" ? declaredType.readonlyView ? this.host.readonlyDataViewOf(declaredType.element) : declaredType.element
        : declaredType.kind === "any" ? anyType : unknownType;
      // An invalid source has already been reported where it went wrong —
      // D85 rule 209's "one mistake, one report" — and `describeType` would
      // render it as the bare `unknown` nobody wrote.
      if (type.kind !== "list" && type.kind !== "any" && !isInvalidType(type)) {
        this.host.typeError(`Cannot list-destructure ${describeType(type)}`, pattern.span);
      }
      for (const child of pattern.elements) if (child) this.declarePattern(child, mutable, element, declaredElement);
      if (pattern.rest) this.declareBinding(
        pattern.rest.name,
        mutable,
        { kind: "list", element },
        pattern.rest.span,
        false,
        { kind: "list", element: declaredElement },
      );
      return;
    }

    const fields = type.kind === "object" ? type.fields : type.kind === "named" ? this.host.fieldsOf(type.identity ?? type.name) : null;
    const declaredFields = declaredType.kind === "object" ? declaredType.fields
      : declaredType.kind === "named" ? this.host.fieldsOf(declaredType.identity ?? declaredType.name) : null;
    if (!fields && type.kind !== "any" && !isInvalidType(type)) {
      this.host.typeError(`Cannot object-destructure ${describeType(type)}`, pattern.span);
    }
    const selected = new Set<string>();
    for (const entry of pattern.entries) {
      if (selected.has(entry.property)) {
        this.host.diagnostics.push(diagnostic("VEL4019", `Object binding field '${entry.property}' is declared more than once`, entry.span));
      }
      selected.add(entry.property);
      if (type.kind === "named" && fields?.has(entry.property)) {
        this.host.semanticBindingEntryOwners.set(`${entry.span.start}:${entry.property}`, type);
      }
      const rawFieldValue = fields?.get(entry.property) ?? (type.kind === "any" ? anyType : unknownType);
      const readonlyField = isReadonlyView(type)
        || type.kind === "object" && type.readonlyFields?.has(entry.property) === true
        || type.kind === "named" && this.host.readonlyFieldsOf(type.identity ?? type.name)?.has(entry.property) === true;
      const fieldValue = readonlyField ? this.host.readonlyDataViewOf(rawFieldValue) : rawFieldValue;
      const structurallyOptional = type.kind === "object" && type.optionalFields?.has(entry.property);
      const field = structurallyOptional ? optionalOf(fieldValue) : fieldValue;
      if (structurallyOptional || this.host.expandAliases(fieldValue).kind === "optional") {
        this.host.lowering.optionalBindingEntries.add(entry.span.start);
      }
      if (fields && !fields.has(entry.property)) this.host.typeError(`Object has no field '${entry.property}'`, entry.span);
      const rawDeclaredFieldValue = declaredFields?.get(entry.property) ?? (declaredType.kind === "any" ? anyType : unknownType);
      const declaredReadonlyField = isReadonlyView(declaredType)
        || declaredType.kind === "object" && declaredType.readonlyFields?.has(entry.property) === true
        || declaredType.kind === "named" && this.host.readonlyFieldsOf(declaredType.identity ?? declaredType.name)?.has(entry.property) === true;
      const declaredFieldValue = declaredReadonlyField ? this.host.readonlyDataViewOf(rawDeclaredFieldValue) : rawDeclaredFieldValue;
      const declaredStructurallyOptional = declaredType.kind === "object" && declaredType.optionalFields?.has(entry.property);
      this.declarePattern(
        entry.pattern,
        mutable,
        field,
        declaredStructurallyOptional ? optionalOf(declaredFieldValue) : declaredFieldValue,
      );
    }
    if (pattern.rest) {
      const remaining = new Map<string, ValueType>();
      for (const [name, field] of fields ?? []) {
        if (selected.has(name)) continue;
        const readonlyField = isReadonlyView(type)
          || type.kind === "object" && type.readonlyFields?.has(name) === true
          || type.kind === "named" && this.host.readonlyFieldsOf(type.identity ?? type.name)?.has(name) === true;
        remaining.set(name, readonlyField ? this.host.readonlyDataViewOf(field) : field);
      }
      const remainingOptional = type.kind === "object"
        ? new Set([...type.optionalFields ?? []].filter((name) => !selected.has(name)))
        : new Set<string>();
      const declaredRemaining = new Map<string, ValueType>();
      for (const [name, field] of declaredFields ?? []) {
        if (selected.has(name)) continue;
        const readonlyField = isReadonlyView(declaredType)
          || declaredType.kind === "object" && declaredType.readonlyFields?.has(name) === true
          || declaredType.kind === "named" && this.host.readonlyFieldsOf(declaredType.identity ?? declaredType.name)?.has(name) === true;
        declaredRemaining.set(name, readonlyField ? this.host.readonlyDataViewOf(field) : field);
      }
      const declaredRemainingOptional = declaredType.kind === "object"
        ? new Set([...declaredType.optionalFields ?? []].filter((name) => !selected.has(name)))
        : new Set<string>();
      this.declareBinding(pattern.rest.name, mutable, type.kind === "any" ? anyType : {
        kind: "object",
        fields: remaining,
        ...(remainingOptional.size > 0 ? { optionalFields: remainingOptional } : {}),
      }, pattern.rest.span, false, declaredType.kind === "any" ? anyType : {
        kind: "object",
        fields: declaredRemaining,
        ...(declaredRemainingOptional.size > 0 ? { optionalFields: declaredRemainingOptional } : {}),
      });
    }
  }

  collectPatternNames(pattern: BindingPattern, add: (name: string) => void): void {
    if (pattern.kind === "NameBindingPattern") {
      add(pattern.name);
      return;
    }
    if (pattern.kind === "ListBindingPattern") {
      for (const element of pattern.elements) if (element) this.collectPatternNames(element, add);
      if (pattern.rest) add(pattern.rest.name);
      return;
    }
    for (const entry of pattern.entries) this.collectPatternNames(entry.pattern, add);
    if (pattern.rest) add(pattern.rest.name);
  }

  checkShadowedRead(name: string, span: Span): void {
    let resolvedIndex = -1;
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      if (this.scopes[index]?.has(name)) {
        resolvedIndex = index;
        break;
      }
    }
    // A Core or extension global resolves by its own emission rules, not by a
    // lexical name the shadow could capture.
    if (resolvedIndex === -1) return;
    for (let index = this.scopes.length - 1; index >= resolvedIndex; index -= 1) {
      const declaration = this.pendingScopeDeclarations[index]?.get(name);
      // A pending loop binding lives in the loop's own scope, so it also
      // captures a read that resolves to the scope holding the loop
      // statement; a pending declaration in the resolution scope itself is
      // a same-scope redeclaration, reported on its own.
      if (!declaration || (index === resolvedIndex && !declaration.loopHead)) continue;
      const identity = spanIdentity(span);
      if (!this.reportedShadowedReads.has(identity)) {
        this.reportedShadowedReads.add(identity);
        const insideDeclaration = span.start >= declaration.span.start && span.end <= declaration.span.end;
        this.host.diagnostics.push(diagnostic(
          "VEL3017",
          declaration.loopHead
            ? `The iterable of this for-loop cannot reference the outer '${name}' its loop binding shadows; rename the loop binding, or read the iterable into a differently named binding first`
            : insideDeclaration
              ? `The initializer of shadowing declaration '${name}' cannot reference the outer '${name}' it shadows; rename the new binding to keep the outer '${name}' readable`
              : `'${name}' is shadowed by a declaration later in this scope, so this reference cannot reach the outer '${name}'; rename the shadowing declaration to keep the outer '${name}' readable`,
          span,
        ));
      }
      return;
    }
  }

  validateKnownBindingShape(pattern: BindingPattern, value: Expression): void {
    if (pattern.kind === "NameBindingPattern") return;
    if (pattern.kind === "ListBindingPattern") {
      if (value.kind !== "ListExpression" || value.elements.some((element) => element.kind === "SpreadExpression")) return;
      const valid = pattern.rest ? value.elements.length >= pattern.elements.length : value.elements.length === pattern.elements.length;
      if (!valid) {
        const expected = `${pattern.rest ? "at least " : "exactly "}${pattern.elements.length} ${pattern.elements.length === 1 ? "item" : "items"}`;
        this.host.diagnostics.push(diagnostic(
          "VEL4020",
          `List binding requires ${expected}, but this literal contains ${value.elements.length}`,
          pattern.span,
        ));
        return;
      }
      pattern.elements.forEach((element, index) => {
        if (element) this.validateKnownBindingShape(element, value.elements[index]!);
      });
      return;
    }
    if (value.kind !== "ObjectExpression") return;
    for (const entry of pattern.entries) {
      const property = [...value.properties].reverse().find((candidate) => candidate.kind === "ObjectProperty" && candidate.name === entry.property);
      if (property?.kind === "ObjectProperty") this.validateKnownBindingShape(entry.pattern, property.value);
    }
  }

  /**
   * D90 (coherence): the one report an unresolved name earns, wherever it was
   * written. A reserved global names the module that replaced it, a foreign
   * builtin with no successor stops at the bare message rather than guessing,
   * and everything else may carry the nearest visible name. Both unresolved-
   * name sites reach this, because `exports = {run: run}` is the same mistake
   * as `const value = exports` and used to earn a strictly worse answer for
   * standing on the left of the `=`.
   */
  reportUnresolvedName(name: string, span: Span): void {
    const guidance = this.guidanceForGlobal(name);
    const nearest = guidance || foreignBuiltinNames.has(name) ? null : this.nearestVisibleBindingName(name);
    this.host.diagnostics.push(diagnostic(
      guidance ? "VEL3008" : "VEL3001",
      guidance ?? `Unknown name '${name}'${nearest ? `; did you mean '${nearest}'?` : ""}`,
      span,
    ));
  }

  nearestVisibleBindingName(name: string): string | null {
    if (!this.nearestNamesSeeded) {
      this.nearestNamesSeeded = true;
      for (const candidate of [
        ...Object.keys(coreVocabularyTypes),
        ...this.host.extensionGlobals.keys(),
        ...this.host.importBindings.keys(),
        "Map", "Set", "Error", "ValidationError", "AssertionError", "NarrowingError", "IndexError",
        ...VELAR_HOST_ERROR_NAMES,
      ]) this.nearestNames.add(candidate);
    }
    return this.nearestNames.nearest(name);
  }

  /** Files a scope's name in the "did you mean" roster and takes it back out when the scope exits. */
  recordScopedName(name: string): void {
    this.nearestNames.add(name);
    this.scopedNames.at(-1)!.push(name);
  }

  builtin(name: string): Binding | null {
    const type = this.host.extensionGlobals.get(name) ?? coreVocabularyType(name)
      ?? (name === "Error" || name === "ValidationError" || name === "AssertionError"
        || name === "NarrowingError" || name === "IndexError"
        || (VELAR_HOST_ERROR_NAMES as readonly string[]).includes(name)
        ? { kind: "classConstructor", name } satisfies ValueType
        : null)
      // D90 R17: `Map`/`Set` as bare values are collection constructors the
      // call path special-cases; the bare binding itself carries no members,
      // so it is unknown, never a silent `any`.
      ?? (name === "Map" || name === "Set" ? unknownType : null);
    return type ? {
      mutable: false,
      type,
      declaredType: type,
      storageType: type,
      span: { start: 0, end: 0 },
      narrowingFrame: null,
    } : null;
  }

  // Emitted JavaScript preserves binding names, so a const or let shadow owns
  // its name for its whole emitted block: any reference in that block that the
  // analyzer resolves to the outer binding — an earlier statement or the
  // shadow's own initializer — lands in the shadow's temporal dead zone (or,
  // inside an arrow, captures the shadow instead of the outer binding). Each
  // scope therefore pre-registers the names its statements will declare, and a
  // reference that resolves past a scope still pending the same name is
  // reported as the ambiguity it is.
  prescanScopeDeclarations(statements: readonly Statement[]): void {
    const pending = this.pendingScopeDeclarations.at(-1)!;
    // JavaScript block functions are available throughout their lexical
    // block, and module-level VelarScript defs already follow that rule. Make
    // every lexical block coherent: only defs are predeclared; const/let and
    // owned bindings retain declaration order and TDZ diagnostics.
    for (const statement of statements) {
      if (statement.kind !== "FunctionDeclaration") continue;
      this.declareBinding(statement.name, false, this.host.functionType(statement), statement.span);
      const binding = this.scopes.at(-1)!.get(statement.name);
      if (binding?.span.start === statement.span.start && binding.span.end === statement.span.end) {
        this.host.functionResultKeys.set(binding, this.host.functionResultKey(statement));
      }
      this.host.predeclared.add(statement);
    }
    for (const statement of statements) {
      if (statement.kind === "VariableDeclaration") {
        this.collectPatternNames(statement.pattern, (name) => {
          if (!pending.has(name)) pending.set(name, { span: statement.span, loopHead: false });
        });
      } else if (statement.kind === "UsingDeclaration") {
        // An owned binding declares a name in this scope exactly as `const`
        // does, so a read above it is the same shadow hazard.
        if (!pending.has(statement.name)) pending.set(statement.name, { span: statement.span, loopHead: false });
      } else {
        const extension = this.host.prescanExtensionScopeDeclaration(statement);
        if (extension && !pending.has(extension.name)) pending.set(extension.name, { span: extension.span, loopHead: false });
      }
    }
  }

  /**
   * Marks a declared type name as already refused by a rule whose sentence says
   * why the name is taken, so `declareBinding` leaves the general one unsaid.
   * The extension calls it from its own roster refusal, which is what lets the
   * Web analyzer take precedence here without either side learning the other's
   * roster.
   */
  markTypeNameRefused(name: string): void {
    this.refusedTypeNames.add(name);
  }

  lookup(name: string): Binding | null {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index]?.get(name);
      if (binding) {
        return binding.narrowingFrame !== null && binding.narrowingFrame < this.host.flowFrameDepth
          ? { ...binding, type: binding.storageType, narrowingFrame: null }
          : binding;
      }
    }
    return null;
  }

  isTopLevelScope(): boolean {
    return this.scopes.length === 1;
  }

  /**
   * The guidance a reserved global earns where it was written. A module path
   * suffix selects the door that is actually open there before the module-wide
   * answer applies.
   */
  guidanceForGlobal(name: string): string | undefined {
    if (this.host.modulePath !== null) {
      for (const [suffix, guidance] of this.host.scopedGlobalGuidance) {
        if (!this.host.modulePath.endsWith(suffix)) continue;
        const message = guidance.get(name);
        if (message !== undefined) return message;
      }
    }
    return this.host.globalGuidance.get(name);
  }
}
