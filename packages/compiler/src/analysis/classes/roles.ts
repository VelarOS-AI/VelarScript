/**
 * The two roles a class may declare with an annotation: `@dispose`, which makes
 * it a resource a `using` scope owns and releases, and `@iterate`, which makes
 * it a source a `for` loop can walk.
 *
 * D114 R1d: the role half of the class cluster. Both roles are the same shape —
 * an annotated member, a contract derived from it, an inherited answer, and a
 * guidance sentence for the refusals — so they are read together.
 */
import {
  type ClassDeclaration,
  type ClassDisposeBlock,
  type ClassIterateBlock,
  type Expression,
  type Statement,
  type UsingDeclaration,
} from "../../ast.ts";
import { type ClassField, type ClassInfo, type DisposalContract } from "../../contracts.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";
import {
  anyType,
  describeType,
  invalidType,
  isInvalidType,
  nullType,
  optionalOf,
  sameType,
  typeContainsAnyOutput,
  unknownType,
  type ValueType,
} from "../../types.ts";
import { type TypeReferences } from "../declarations/references.ts";
import { type LoweringRecorder } from "../lowering-recorder.ts";
import {
  containsInferredResultPlaceholder,
  inferredResultPlaceholderType,
  isExternClassIdentity,
  type ReturnContext,
} from "../functions.ts";
import { blockContainsDirectAwait } from "../../ast.ts";
import { disposeMemberKey } from "../../contracts.ts";
import { type Binding, type BuiltinTypeNamePosition } from "../scopes.ts";

/**
 * Everything this half of the class cluster asks of the analyzer that hosts
 * it. The four halves share one host object; the union of their interfaces is
 * what the analyzer builds.
 */
export interface ClassRolesHost {
  analyzeStatements(statements: readonly Statement[]): void;
  readonly arrowOwnedCaptures: Map<string, { readonly handle: string; readonly depth: number }>;
  readonly asynchronousFunctions: boolean[];
  blockAlwaysReturns(statements: readonly Statement[]): boolean;
  classInfo(key: string): ClassInfo | undefined;
  readonly classes: Map<string, ClassInfo>;
  currentClass: string | null;
  declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span, internal?: boolean, declaredType?: ValueType, importSource?: string, typeNamePosition?: BuiltinTypeNamePosition): void;
  readonly diagnostics: Diagnostic[];
  enterScope(): void;
  exitScope(): void;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  readonly exportPositionCandidates: {
    readonly className: string;
    readonly member: string;
    readonly span: Span;
  }[];
  extensionExpressionContainsDirectAwait(expression: Expression, contains: (expression: Expression) => boolean): boolean | undefined;
  extensionStatementContainsDirectAwait(statement: Statement, containsExpression: (expression: Expression) => boolean, containsBlock: (statements: readonly Statement[]) => boolean): boolean | undefined;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  finallyLoopDepths: number[];
  findField(className: string, name: string): ClassField | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  flowFrameDepth: number;
  functionDepth: number;
  inferAnnotationFreeHead(expression: Expression): ValueType;
  inferCollectedFunctionResult(returned: readonly ValueType[], fallsThrough: boolean): ValueType;
  readonly inferredFunctionResultSeeds: ReadonlyMap<string, ValueType>;
  readonly inferredFunctionResultTypes: Map<string, ValueType>;
  lookup(name: string): Binding | null;
  loopDepth: number;
  readonly lowering: LoweringRecorder;
  ownershipScopeRejection(): string | null;
  readonly returnContexts: ReturnContext[];
  readonly scopes: Map<string, Binding>[];
  selfClassType(className: string): ValueType;
  superMemberContext: "instance" | "static" | null;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  readonly typeReferences: TypeReferences;
}

export class ClassRoles {
  private readonly host: ClassRolesHost;

  constructor(host: ClassRolesHost) {
    this.host = host;
  }

  /**
   * D43 item 69: `using name = expression` claims ownership of a resource for
   * the enclosing scope. The value's type must declare the release contract,
   * the scope must be able to run it, and the module top level — which lives
   * until the process ends — has no scope exit to release at.
   */
  analyzeUsingDeclaration(statement: UsingDeclaration): void {
    const value = this.host.inferAnnotationFreeHead(statement.initializer);
    const rejection = this.host.ownershipScopeRejection();
    if (rejection !== null) this.host.diagnostics.push(diagnostic("VEL3018", rejection, statement.span));
    const contract = this.disposalContract(value);
    if (contract === null) {
      // D51 item NEW-D5: `any` used to be exempt here, so `using` over an
      // unsafe JavaScript value compiled to a plain `const` — no release, no
      // diagnostic. `any` is an escape hatch for *values*; it can never answer
      // "how does this release", which is the whole content of `using`.
      if (!isInvalidType(this.host.expandAliases(value))) {
        this.host.diagnostics.push(diagnostic(
          "VEL4032",
          `'using' releases a value whose type declares '@dispose'; ${describeType(value)} does not${this.disposalGuidance(value)}`,
          statement.initializer.span,
        ));
      }
    } else {
      if (contract.asynchronous && this.host.asynchronousFunctions.at(-1) !== true) {
        this.host.diagnostics.push(diagnostic(
          "VEL4033",
          `Releasing ${describeType(value)} awaits, so its 'using' needs an async scope; declare the enclosing function 'async def'`,
          statement.span,
        ));
      }
      this.host.lowering.usingDisposals.set(spanIdentity(statement.span), contract);
    }
    this.host.declareBinding(statement.name, false, value, statement.nameSpan);
    const binding = this.host.scopes.at(-1)?.get(statement.name);
    if (binding) binding.ownedResource = { handle: statement.name, depth: this.host.scopes.length };
  }

  /**
   * D51 rule 101: an owned resource may not leave the scope that releases it.
   * `using` means "this scope owns it and guarantees the release", so letting
   * the value out hands back a reference that is already known to be dead —
   * which is the construct's definition, not a restriction on top of it. The
   * judgement is *storage and return*, never use: passing the handle to a
   * function stays legal, because a callee borrows and must not assume
   * ownership. Returns the owned binding an expression carries, or null.
   */
  carriedOwnedResource(expression: Expression | null): { readonly handle: string; readonly depth: number } | null {
    if (!expression) return null;
    switch (expression.kind) {
      case "IdentifierExpression":
        return this.host.lookup(expression.name)?.ownedResource ?? null;
      case "ListExpression":
        for (const element of expression.elements) {
          const carried = this.carriedOwnedResource(element.kind === "SpreadExpression" ? element.value : element);
          if (carried) return carried;
        }
        return null;
      case "ObjectExpression":
        for (const property of expression.properties) {
          const carried = this.carriedOwnedResource(property.value);
          if (carried) return carried;
        }
        return null;
      case "ConditionalExpression":
        return this.carriedOwnedResource(expression.thenValue) ?? this.carriedOwnedResource(expression.elseValue);
      case "ArrowFunctionExpression":
        // A closure that captured the handle carries it wherever the closure
        // goes. The captures were recorded by the arrow's own analysis, so the
        // answer respects shadowing exactly as name resolution does.
        return this.host.arrowOwnedCaptures.get(spanIdentity(expression.span)) ?? null;
      default:
        // Member reads, index reads, and call results are data read *out of*
        // the handle — the diagnostic's own second exit — so they never carry.
        return null;
    }
  }

  /** The scope nesting level a name is declared at, or 0 when it is not a local. */
  bindingScopeDepth(name: string): number {
    for (let index = this.host.scopes.length - 1; index >= 0; index -= 1) {
      if (this.host.scopes[index]!.has(name)) return index + 1;
    }
    return 0;
  }

  rejectOwnedResourceEscape(expression: Expression | null, action: string, errorSpan: Span): boolean {
    const carried = this.carriedOwnedResource(expression);
    if (!carried) return false;
    this.host.diagnostics.push(diagnostic(
      "VEL4036",
      `'${carried.handle}' is owned by this scope, which releases it on the way out, so ${action} would hand on an already-released handle; move the 'using' up to the scope that really owns it, or ${action.startsWith("returning") ? "return" : "store"} the data you read from it instead`,
      errorSpan,
    ));
    return true;
  }

  /**
   * The release contract of a value's type: a class's own `@dispose:` block, or
   * a standard capability handle, which delegates to the verb it already
   * publishes (`close()` or `stop()`) rather than being renamed for `using`.
   */
  disposalContract(source: ValueType): DisposalContract | null {
    const type = this.host.typeReferences.resolveNamedClasses(this.host.expandAliases(source));
    if (type.kind === "class") {
      // D51 rule 102: every `@dispose:` in the chain runs, so the contract's
      // async-ness is the chain's, not the most-derived block's. Rule NEW-D4
      // keeps that answer sound through a supertype: a subclass may not add
      // awaiting where an ancestor's release does not await, so no subclass
      // below the static type can raise the answer computed here.
      const chain = this.disposalChain(type.identity ?? type.name);
      if (chain.length === 0) return null;
      return { member: disposeMemberKey, asynchronous: chain.includes("async"), owner: "class" };
    }
    // D51 (audit 12): charter section 16 promises the compiler supplies the
    // contract for *every* standard capability handle. Some targets declare a
    // handle structurally rather than as a named type — a socket, an event
    // stream, a terminal — and the named rule could never match those, so a
    // live WebSocket was reported as "a record, which is data". The extension
    // marks its own handles; nothing here detects a shape.
    const fields = type.kind === "object" && type.capabilityHandle === true
      ? type.fields
      : type.kind === "named" && (type.identity ?? type.name).startsWith("velar/")
        // A standard capability module owns its handle types
        // (`velar/fs#type:...`); a module's own `type` declaration is
        // identified as `velar:<path>#...`, so a plain record can never reach
        // the built-in contract.
        ? this.host.fieldsOf(type.identity ?? type.name)
        : null;
    if (!fields) return null;
    for (const verb of ["close", "stop"]) {
      const member = fields.get(verb);
      if (!member || (member.kind !== "function" && member.kind !== "action" && member.kind !== "intrinsic")) continue;
      if (member.requiredParameters > 0) continue;
      const result = this.host.expandAliases(member.result);
      if (result.kind === "null") return { member: verb, asynchronous: false, owner: "capability" };
      if (result.kind === "promise" && this.host.expandAliases(result.value).kind === "null") {
        return { member: verb, asynchronous: true, owner: "capability" };
      }
    }
    return null;
  }

  /**
   * D51 rule 102 + item NEW-D4. Rule 102 makes the compiler chain a derived
   * `@dispose:` into its base's, so the emitter is told which classes forward
   * and whether the forwarded release awaits. NEW-D4 is the soundness half:
   * `using` reads the release contract off the *static* type, so a subclass
   * that starts awaiting where its ancestors do not would be released without
   * an await through a base-typed binding — an unhandled rejection that kills
   * the process. Adding `await` downward is therefore rejected at the subclass;
   * an ancestor that already awaits carries every descendant with it.
   */
  checkDisposalChain(statement: ClassDeclaration, baseName: string | null): void {
    const inherited = baseName ? this.disposalChain(baseName) : [];
    if (inherited.length === 0) return;
    this.host.lowering.classDisposeChains.set(spanIdentity(statement.span), inherited.includes("async") ? "async" : "sync");
    const own = this.host.classInfo(statement.name)?.dispose ?? "sync";
    if (own === "async" && !inherited.includes("async")) {
      this.host.diagnostics.push(diagnostic(
        "VEL4035",
        `Class '${statement.name}' awaits in '@dispose', but '${baseName}' releases without awaiting; a 'using' that owns this value through '${baseName}' would not await the release — move the awaiting work into the base's '@dispose', or release it there`,
        statement.dispose!.span,
      ));
    }
  }

  /** Every `@dispose:` a class releases through, most derived first (D51 rule 102). */
  disposalChain(className: string): readonly ("sync" | "async")[] {
    const chain: ("sync" | "async")[] = [];
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info: ClassInfo | undefined = this.host.classInfo(current);
      if (info?.dispose) chain.push(info.dispose);
      current = info?.base ?? null;
    }
    return chain;
  }

  disposalGuidance(source: ValueType): string {
    const type = this.host.typeReferences.resolveNamedClasses(this.host.expandAliases(source));
    if (type.kind === "promise") {
      return this.disposalContract(type.value) === null
        ? ""
        : "; acquisition is ordinary async work — write 'using name = await ...' so the scope owns the handle, not the Promise";
    }
    // D51 item NEW-D5: the three JavaScript-boundary shapes get the spelling
    // that actually works. An extern class cannot grow an '@dispose:' block —
    // an extern body declares, it has no statements — so the old guidance named
    // a fix that is a parse error. Composition is the answer the bridge already
    // gives for every other extern-class need (D45 rule 78).
    const wrapperGuidance = "; hold it in a field of a VelarScript class whose '@dispose:' block releases it, then own that wrapper";
    if (type.kind === "any" || type.kind === "unknown") {
      return `; a JavaScript value carries no release contract${wrapperGuidance}`;
    }
    if ((type.kind === "class" || type.kind === "classConstructor") && isExternClassIdentity(type.identity ?? null)) {
      return `; an extern class declares the foreign shape and cannot declare '@dispose:'${wrapperGuidance}`;
    }
    if (type.kind === "class") return "; declare an '@dispose:' block on the class to say how it releases itself";
    if (type.kind === "named" || type.kind === "object" || type.kind === "record") {
      return "; a record is data, so it has nothing to release — own the handle it came from instead";
    }
    return "";
  }

  /**
   * D43 item 69: the `@dispose:` body is a release contract, not a method. It
   * runs with `self` in scope and may `await`; whether it actually does is what
   * decides that a `using` of this class needs an async scope.
   */
  analyzeClassDispose(statement: ClassDeclaration, block: ClassDisposeBlock): void {
    this.host.enterScope();
    this.host.flowFrameDepth += 1;
    this.host.functionDepth += 1;
    const previousLoopDepth = this.host.loopDepth;
    this.host.loopDepth = 0;
    const previousFinallyLoopDepths = this.host.finallyLoopDepths;
    this.host.finallyLoopDepths = [];
    const previousClass = this.host.currentClass;
    const previousSuperMemberContext = this.host.superMemberContext;
    this.host.currentClass = statement.name;
    this.host.superMemberContext = "instance";
    this.host.asynchronousFunctions.push(true);
    this.host.returnContexts.push({ expected: nullType, inferredReturns: null, observedReturns: null, declarationKind: "Function" });
    this.host.declareBinding("self", false, this.host.selfClassType(statement.name), block.span, true);
    this.host.analyzeStatements(block.body);
    this.host.returnContexts.pop();
    this.host.asynchronousFunctions.pop();
    this.host.currentClass = previousClass;
    this.host.superMemberContext = previousSuperMemberContext;
    this.host.loopDepth = previousLoopDepth;
    this.host.finallyLoopDepths = previousFinallyLoopDepths;
    this.host.functionDepth -= 1;
    this.host.flowFrameDepth -= 1;
    this.host.exitScope();
  }

  /** D68 rule 177: the convergence key of one `@iterate:` block. */
  iterationResultKey(block: ClassIterateBlock): string {
    return spanIdentity(block.keywordSpan);
  }

  /**
   * D68 rule 177: `@iterate:` carries no result annotation — the block *is* the
   * answer — so the class shape pre-pass reads what the previous convergence
   * pass learned. Without the seed, a use written above the class would see an
   * unresolved placeholder, which is the same problem an omitted function
   * result has and gets the same solution.
   */
  seededIterationSource(block: ClassIterateBlock): ValueType {
    return this.host.inferredFunctionResultSeeds.get(this.iterationResultKey(block)) ?? inferredResultPlaceholderType;
  }

  /**
   * D90 R18: the seed routed to the field its form owns. An optional seed can
   * only have come from the asynchronous pull form — the synchronous form
   * never validates to `T?` — so the shape pre-pass reads the form off the
   * seed the previous convergence pass learned.
   */
  seededIterationInfo(block: ClassIterateBlock): { readonly iterate: ValueType } | { readonly iterateAsync: ValueType } {
    const seed = this.seededIterationSource(block);
    const expanded = this.host.expandAliases(seed);
    return expanded.kind === "optional" ? { iterateAsync: expanded.inner } : { iterate: seed };
  }

  /**
   * `@iterate:` answers the compiler's question "what does
   * iterating you mean?". It shares `@dispose:`'s compiler-name path, then
   * supplies its own role: it is a contract, not a method, and it produces a
   * value. D90 R18 gives it two forms, told apart by the answer's shape the
   * same way `@dispose:`'s async-ness is read off its own body: the
   * synchronous form answers a collection the language already iterates and
   * the eight plain consumers read it once; the asynchronous pull form
   * answers `T?` — `async for` drives it once per element, it may await, and
   * null is exhaustion.
   */
  analyzeClassIterate(statement: ClassDeclaration, block: ClassIterateBlock, baseName: string | null): void {
    const awaits = blockContainsDirectAwait(
      block.body,
      (expression, contains) => this.host.extensionExpressionContainsDirectAwait(expression, contains),
      (owned, containsExpression, containsBlock) => this.host.extensionStatementContainsDirectAwait(owned, containsExpression, containsBlock),
    );
    this.host.enterScope();
    this.host.flowFrameDepth += 1;
    this.host.functionDepth += 1;
    const previousLoopDepth = this.host.loopDepth;
    this.host.loopDepth = 0;
    const previousFinallyLoopDepths = this.host.finallyLoopDepths;
    this.host.finallyLoopDepths = [];
    const previousClass = this.host.currentClass;
    const previousSuperMemberContext = this.host.superMemberContext;
    this.host.currentClass = statement.name;
    this.host.superMemberContext = "instance";
    // A block that awaits is the asynchronous form (the same reading
    // `@dispose:` gets), so its awaits are legal; a block without one has
    // nothing for the flag to allow.
    this.host.asynchronousFunctions.push(awaits);
    const inferredReturns: ValueType[] = [];
    this.host.returnContexts.push({ expected: unknownType, inferredReturns, observedReturns: null, declarationKind: "Iteration contract" });
    this.host.declareBinding("self", false, this.host.selfClassType(statement.name), block.span, true);
    this.host.analyzeStatements(block.body);
    this.host.returnContexts.pop();
    this.host.asynchronousFunctions.pop();
    this.host.currentClass = previousClass;
    this.host.superMemberContext = previousSuperMemberContext;
    this.host.loopDepth = previousLoopDepth;
    this.host.finallyLoopDepths = previousFinallyLoopDepths;
    this.host.functionDepth -= 1;
    this.host.flowFrameDepth -= 1;
    this.host.exitScope();
    const answered = this.host.inferCollectedFunctionResult(inferredReturns, !this.host.blockAlwaysReturns(block.body));
    const validated = this.validatedIterationSource(statement, block, answered, baseName, awaits);
    // D90 R12: `@iterate:` is the class's other inferred public contract. A
    // consumer writing `for item in box` reads the element straight out of
    // this block, so an element the compiler makes no promise about crosses
    // the boundary exactly as a method result does. The block has no
    // annotation to refuse and no `private` spelling, so the class's own
    // reachability is the whole question.
    if (typeContainsAnyOutput(validated.source)) {
      this.host.exportPositionCandidates.push({ className: statement.name, member: "@iterate", span: block.span });
    }
    // The stored result keeps the optional wrapper for the asynchronous form
    // so the convergence seed round-trips carrying the form (see
    // seededIterationInfo).
    this.host.inferredFunctionResultTypes.set(
      this.iterationResultKey(block),
      validated.form === "async" && !isInvalidType(validated.source) ? optionalOf(validated.source) : validated.source,
    );
    if (validated.form === "async") this.host.lowering.asyncIterateBlocks.add(spanIdentity(block.keywordSpan));
    const info = this.host.classInfo(statement.name);
    if (info) {
      // Drop the other form's field: an earlier pass may have seeded it before
      // this pass's answer settled which form the block is.
      const { iterate: _sync, iterateAsync: _async, ...rest } = info;
      this.host.classes.set(statement.name, validated.form === "async"
        ? { ...rest, iterateAsync: validated.source }
        : { ...rest, iterate: validated.source });
    }
  }

  /**
   * The answer space is the four collections plus `T?` (D90 R18): the
   * synchronous form says "iterating me is iterating this", and the language
   * already fixed what iterating a List, Set, Map, or Record means; the
   * asynchronous pull form answers one element per pull, null for exhaustion.
   * Anything else would be a second iteration semantics, which is the thing
   * charter section 19 keeps out.
   */
  validatedIterationSource(
    statement: ClassDeclaration,
    block: ClassIterateBlock,
    answered: ValueType,
    baseName: string | null,
    awaits: boolean,
  ): { readonly form: "sync" | "async"; readonly source: ValueType } {
    if (isInvalidType(answered) || containsInferredResultPlaceholder(answered)) return { form: "sync", source: invalidType };
    const expanded = this.host.expandAliases(answered);
    // The override rule every other member already carries (a getter or method
    // override keeps the base result). `@iterate:` replaces rather than chains,
    // but the answer still has to be the one a base-typed binding was promised:
    // `for item in bag` inside a function taking the base would otherwise walk
    // a different element type — or a different form — at runtime.
    const inherited = baseName ? this.inheritedIterationSource(baseName) : null;
    const inheritedAsync = baseName ? this.inheritedAsyncIterationSource(baseName) : null;
    if (expanded.kind === "optional") {
      const element = expanded.inner;
      if (inherited && !isInvalidType(inherited)) {
        this.host.diagnostics.push(diagnostic(
          "VEL4038",
          `'@iterate' override in '${statement.name}' must keep the base form; '${baseName}' answers ${describeType(inherited)} to the plain 'for', and this block answers ${describeType(answered)} — the asynchronous pull form — so a base-typed binding would stream where it was promised a collection`,
          block.keywordSpan,
        ));
        return { form: "sync", source: inherited };
      }
      if (inheritedAsync && !isInvalidType(inheritedAsync) && !sameType(this.host.expandAliases(element), this.host.expandAliases(inheritedAsync))) {
        this.host.diagnostics.push(diagnostic(
          "VEL4038",
          `'@iterate' override in '${statement.name}' must keep the base answer ${describeType(inheritedAsync)}?; '${baseName}' already promised every caller that pulling one of these yields ${describeType(inheritedAsync)}, and a derived value is still one of those`,
          block.keywordSpan,
        ));
        return { form: "async", source: inheritedAsync };
      }
      return { form: "async", source: element };
    }
    if (expanded.kind !== "list" && expanded.kind !== "set" && expanded.kind !== "map" && expanded.kind !== "record") {
      this.host.diagnostics.push(diagnostic(
        "VEL4038",
        `'@iterate' says what iterating '${statement.name}' means: the synchronous form returns a List, Set, Map, or Record — the shapes the language already knows how to iterate — and the asynchronous pull form answers 'T?', one element per pull with null as exhaustion; this block returns ${describeType(answered)}`,
        block.keywordSpan,
      ));
      return { form: "sync", source: invalidType };
    }
    if (awaits) {
      this.host.diagnostics.push(diagnostic(
        "VEL4038",
        `'@iterate' in '${statement.name}' awaits but answers ${describeType(answered)}; the synchronous form is read whole by the plain consumers, so await the work before construction and hold the finished collection — or answer 'T?' to be the asynchronous pull form 'async for' drives once per element`,
        block.keywordSpan,
      ));
      return { form: "sync", source: invalidType };
    }
    if (inheritedAsync && !isInvalidType(inheritedAsync)) {
      this.host.diagnostics.push(diagnostic(
        "VEL4038",
        `'@iterate' override in '${statement.name}' must keep the base form; '${baseName}' answers ${describeType(inheritedAsync)}? — the asynchronous pull form — and this block answers ${describeType(answered)}, so a base-typed binding would read a collection where it was promised a stream`,
        block.keywordSpan,
      ));
      return { form: "async", source: inheritedAsync };
    }
    if (inherited && !isInvalidType(inherited) && !sameType(expanded, this.host.expandAliases(inherited))) {
      this.host.diagnostics.push(diagnostic(
        "VEL4038",
        `'@iterate' override in '${statement.name}' must keep the base answer ${describeType(inherited)}; '${baseName}' already promised every caller that iterating one of these walks ${describeType(inherited)}, and a derived value is still one of those`,
        block.keywordSpan,
      ));
      return { form: "sync", source: inherited };
    }
    return { form: "sync", source: expanded };
  }

  /** The `@iterate:` answer a class inherits, most derived ancestor first. */
  inheritedIterationSource(className: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info: ClassInfo | undefined = this.host.classInfo(current);
      if (info?.iterate) return info.iterate;
      current = info?.base ?? null;
    }
    return null;
  }

  /** D90 R18: the asynchronous `@iterate:` element a class inherits, most derived ancestor first. */
  inheritedAsyncIterationSource(className: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info: ClassInfo | undefined = this.host.classInfo(current);
      if (info?.iterateAsync) return info.iterateAsync;
      current = info?.base ?? null;
    }
    return null;
  }

  /**
   * D90 R18: what pulling this value under `async for` means. A class answers
   * through the asynchronous `@iterate:` form — its own, or the one it
   * inherits, mirroring the synchronous contract exactly.
   */
  asyncIterationContract(type: ValueType): ValueType | null {
    const resolved = this.host.typeReferences.resolveNamedClasses(this.host.expandAliases(type));
    if (resolved.kind !== "class") return null;
    return this.inheritedAsyncIterationSource(resolved.identity ?? resolved.name);
  }

  /**
   * D68 rule 177: what iterating this value means. A class answers through
   * `@iterate:` — its own, or the one it inherits, because overriding replaces
   * a single answer instead of composing a chain the way `@dispose:` does.
   */
  iterationContract(type: ValueType): ValueType | null {
    const resolved = this.host.typeReferences.resolveNamedClasses(this.host.expandAliases(type));
    if (resolved.kind !== "class") return null;
    return this.inheritedIterationSource(resolved.identity ?? resolved.name);
  }

  /**
   * Projects one consumer's operand through `@iterate:` and records the span so
   * the emitter projects it too. Every consumer of an iterable calls this, so
   * `for item in bag` and `item in bag` can never disagree about whether a
   * class participates — D68 names that split as the trap this design exists to
   * avoid.
   */
  iterationSource(expression: Expression, type: ValueType): ValueType {
    const contract = this.iterationContract(type);
    if (contract === null || isInvalidType(contract)) return type;
    this.host.lowering.iterationContracts.add(spanIdentity(expression.span));
    return contract;
  }

  /**
   * The one sentence that teaches the contract, appended wherever a consumer
   * refuses a class. A class that already declares `@iterate:` gets nothing:
   * its own block carries the precise diagnostic.
   */
  iterationGuidance(type: ValueType): string {
    const resolved = this.host.typeReferences.resolveNamedClasses(this.host.expandAliases(type));
    if (resolved.kind !== "class") return "";
    if (isExternClassIdentity(resolved.identity ?? null)) {
      return "; an extern class declares the foreign shape and cannot declare '@iterate:' — read the collection out of it and iterate that";
    }
    if (this.iterationContract(resolved) !== null) return "";
    // D90 R18: the refusal is symmetric with `async for` refusing the
    // synchronous form — each names the other, so the author is one message
    // away from the loop that fits the declaration.
    if (this.asyncIterationContract(resolved) !== null) {
      return "; '@iterate' on this class is the asynchronous pull form, which 'async for' drives — use 'async for', or answer a List, Set, Map, or Record to iterate here";
    }
    return "; declare an '@iterate:' block on the class to say which List, Set, Map, or Record iterating it means";
  }

  asyncPullElementType(source: ValueType, sourceSpan: Span, statementStart: number): ValueType {
    const expanded = this.host.typeReferences.resolveNamedClasses(this.host.expandAliases(source));
    if (expanded.kind === "any") return anyType;
    if (isInvalidType(expanded)) return invalidType;

    // D90 R18: a VelarScript class declares itself an asynchronous stream
    // through the asynchronous `@iterate:` form, exactly as it declares the
    // synchronous one — `async for` reads the declaration, never a structural
    // resemblance. The structural `next() -> Promise<T?>` pull below stays the
    // contract of the declared foreign shapes: capability handles (a reply
    // stream, a child process, a watcher) and extern classes whose own
    // contract declares the pull as a function-valued field.
    if (expanded.kind === "class" && !isExternClassIdentity(expanded.identity ?? null)) {
      const declared = this.asyncIterationContract(expanded);
      if (declared !== null) {
        if (isInvalidType(declared)) return invalidType;
        this.host.lowering.asyncIterationStatements.add(statementStart);
        return declared;
      }
      const identity = expanded.identity ?? expanded.name;
      const synchronous = this.iterationContract(expanded);
      if (synchronous !== null) {
        this.host.typeError(
          `async for pulls a declared asynchronous '@iterate:'; '@iterate' on ${describeType(source)} ${isInvalidType(synchronous) ? "answers the plain 'for'" : `answers ${describeType(synchronous)} to the plain 'for'`} — declare the asynchronous form instead: a block that answers 'T?', one element per pull, null as exhaustion`,
          sourceSpan,
        );
        return unknownType;
      }
      const structuralNext = this.host.findMethod(identity, "next")?.type ?? this.host.findMethod(expanded.name, "next")?.type ?? null;
      this.host.typeError(
        `async for pulls a declared asynchronous '@iterate:'; ${describeType(source)} does not declare one — a block that answers 'T?' (it may await; one element per pull, null is exhaustion)${structuralNext ? "; 'next()' is a method of the author's namespace, not the contract — move its body into the '@iterate:' block" : ""}`,
        sourceSpan,
      );
      return unknownType;
    }

    let next: ValueType | null = null;
    if (expanded.kind === "object") {
      next = expanded.optionalFields?.has("next") ? null : expanded.fields.get("next") ?? null;
    } else if (expanded.kind === "named") {
      const identity = expanded.identity ?? expanded.name;
      next = this.host.findMethod(identity, "next")?.type
        ?? this.host.fieldsOf(identity)?.get("next")
        ?? null;
    } else if (expanded.kind === "class") {
      // An extern class: its own contract may declare the pull as a
      // function-valued field; an extern method is never captured (charter
      // section 12 trusts a checked declaration's member kinds, and only a
      // field promises a function standing on the value).
      next = this.host.findField(expanded.identity ?? expanded.name, "next")?.type
        ?? this.host.findField(expanded.name, "next")?.type
        ?? null;
    }

    const callable = next ? this.host.expandAliases(next) : null;
    if (!callable || callable.kind !== "function" || callable.requiredParameters > 0 || (callable.typeParameterNames?.length ?? 0) > 0) {
      this.host.typeError(
        `async for requires next() -> Promise<T?>; ${describeType(source)} does not expose that pull contract`,
        sourceSpan,
      );
      return unknownType;
    }
    const result = this.host.expandAliases(callable.result);
    if (result.kind !== "promise") {
      this.host.typeError(
        `async for requires next() -> Promise<T?>; next() returns ${describeType(callable.result)}`,
        sourceSpan,
      );
      return unknownType;
    }
    const resolved = this.host.expandAliases(result.value);
    if (resolved.kind !== "optional") {
      this.host.typeError(
        `async for requires next() -> Promise<T?>; next() resolves to ${describeType(result.value)} without an exhaustion value`,
        sourceSpan,
      );
      return unknownType;
    }
    return resolved.inner;
  }
}
