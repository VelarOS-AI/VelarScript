# D114 R0 — the refactor baseline (2026-09-05)

The D114 refactor plan (R1–R6) is a structural split with zero semantic change.
Its acceptance criterion is *byte-identical emitted output*, not merely green
tests. This is the measurement R1–R6 compare against: what the toolchain emits
today, how large each file is, which cycles exist, which `protected` members the
target subclasses depend on, what `@velarscript/compiler` exports, and what the
test suite holds.

No recommendations here. The plan is
[D114](../D114-STANDARD-AUDIT-AND-REFACTOR-PLAN.md); this file is its zero mark.

## What was measured

| | |
| --- | --- |
| Commit | `8bea026` — `release: VelarScript 0.28.0` |
| Toolchain | `velar 0.28.0` — `core@0.6 web@0.12 node@0.16 server@0.15 desktop@0.10` |
| Machine | Darwin 25.3.0, arm64, Node v24.15.0, npm 12.0.2 |
| Date | 2026-09-05 |

## 1. Emitted-output fingerprint

`scripts/output-fingerprint.mjs` builds every gated project — the five under
`examples/` that `scripts/velar-projects.mjs` discovers, plus the three fixture
projects under `tests/fixtures/` that carry a `velar.json` — in both build modes,
hashes every emitted file with SHA-256, and prints one sorted line per file.

```bash
npm run fingerprint -- --write docs/decisions/archive/REFACTOR-BASELINE-2026-09-05.fingerprint.txt
# later, from a checkout at the same absolute path:
npm run fingerprint -- --compare docs/decisions/archive/REFACTOR-BASELINE-2026-09-05.fingerprint.txt
```

| | |
| --- | --- |
| Files hashed | **828** |
| Digest of the listing | `9aca6f257dd34a19f349944184050319b2a4d6b3d6140fa91974af9e8fee6506` |
| Listing | [`REFACTOR-BASELINE-2026-09-05.fingerprint.txt`](REFACTOR-BASELINE-2026-09-05.fingerprint.txt) |
| Wall time | 5.1 s for both modes over all eight projects; 7.7 s including `build-packages` |

Per project and mode:

| Project | production | readable |
| --- | ---: | ---: |
| `examples/app` | 14 | 14 |
| `examples/tour/core` | 80 | 80 |
| `examples/tour/desktop` | 7 | 7 |
| `examples/tour/node` | 278 | 278 |
| `examples/tour/web` | 9 | 9 |
| `tests/fixtures/modules` | 2 | 2 |
| `tests/fixtures/web-capabilities` | 16 | 16 |
| `tests/fixtures/web-error-paths` | 8 | 8 |

`velar check` produces no output and `velar run` compiles into a temporary
launcher it deletes, so `build` is the only emitted artifact a fingerprint can
hold. The two modes — `--mode production` (what ships) and `--mode readable`
(the separate un-minified emission path) — are that whole surface.

### Determinism, proven three ways

1. **Two runs, same checkout.** Byte-identical: 828/828 files, same digest.
   No timestamp, no build counter, no random identifier reaches an emitted
   file, and every `buildId` reproduced exactly.
2. **A one-character comment edit.** In `examples/tour/core/09-control-flow.vel`
   (a project with source maps off) it changes nothing — comments do not reach
   emitted bytes. In `examples/app/src/app.vel` (source maps on) it moves 14
   entries, because `sourcesContent` carries the verbatim `.vel` text.
3. **A one-character literal edit.** `result = "A"` → `result = "a"` in
   `examples/tour/core/09-control-flow.vel` changes exactly two files —
   `09-control-flow.js` in each mode — and nothing else.

Experiments 2 and 3 were run on a copy of the checkout under
`/private/tmp/velar-d114/scratch-r0/copy`; no repository example was edited.

### Finding — the fingerprint is checkout-path-sensitive for two projects

**待用户裁决. Field: `sources` in every emitted `*.js.map`.**

`examples/app` and `tests/fixtures/web-capabilities` declare
`"build": {"sourceMaps": true}`. Their emitted source maps record the path from
the *output directory* to each `.vel` source. When `--out-dir` points outside
the checkout — which `scripts/check-project-builds.mjs` and this fingerprint
both require, so a gate leaves the tree as it found it — that path climbs out
and spells the checkout's absolute location:

```text
"../../../../../../../private/tmp/velar-d114/r0-baseline/examples/app/src/main.vel"
```

Because an asset's file name is its content hash, a changed map renames the
`.js` that references it, which renames it in `index.html`, `404.html` and the
`velar-build.json` inventory, and changes `buildId`. Building the same commit
from `/private/tmp/velar-d114/scratch-r0/copy` disturbs 34 of the 828 baseline
lines — 20 renamed away and 14 rewritten, with 20 renamed-in replacements — and
every one of them belongs to those two projects.

The `--out-dir` name itself does not matter, only the checkout's path: the map
records `../` segments for the output directory's depth and then the source
tree's absolute path, so two runs into different `mkdtemp` directories at the
same depth agree, and two checkouts at different paths do not.

Three facts bound it:

- Built into the project's own `outDir` the same map says
  `"../../src/model/release.vel"`: checkout-independent. The shipped artifact is
  not affected; the out-of-tree gate build is.
- Nothing is time- or machine-random. Two runs from one checkout agree
  byte for byte, `buildId` included.
- `buildId` is content-derived as the charter says. `examples/tour/web` (source
  maps off) produced `19b354659567eee2…` from two different scratch output
  directories at two different depths.

The script strips nothing, per its brief. Until this is ruled on, an R1–R6
comparison must be taken from a checkout at **the same absolute path** as this
baseline, or the 34 lines belonging to those two projects excluded by hand.

## 2. Size

### Every `packages/*/src`

```bash
for d in packages/*/src; do
  echo "$d $(find "$d" -name '*.ts' | wc -l) $(find "$d" -name '*.ts' -exec cat {} + | wc -l)"
done
```

| Package | `.ts` files | lines |
| --- | ---: | ---: |
| `packages/cli/src` | 65 | 22,604 |
| `packages/compiler/src` | 44 | 42,799 |
| `packages/core/src` | 3 | 3,732 |
| `packages/create/src` | 5 | 853 |
| `packages/desktop/src` | 13 | 6,526 |
| `packages/node/src` | 26 | 13,260 |
| `packages/server/src` | 6 | 1,005 |
| `packages/web/src` | 27 | 21,569 |
| **total** | **189** | **112,348** |

### The 25 largest source files

```bash
find packages/*/src -name '*.ts' -exec wc -l {} + | sort -rn | sed -n '2,26p'
```

| lines | file |
| ---: | --- |
| 17,485 | `packages/compiler/src/analyzer.ts` |
| 5,252 | `packages/web/src/analyzer.ts` |
| 4,548 | `packages/compiler/src/parser.ts` |
| 4,325 | `packages/compiler/src/emitter.ts` |
| 4,228 | `packages/node/src/serve-runtime.ts` |
| 3,779 | `packages/web/src/runtime.ts` |
| 3,425 | `packages/web/src/emitter.ts` |
| 3,239 | `packages/core/src/index.ts` |
| 2,938 | `packages/cli/src/project.ts` |
| 2,867 | `packages/desktop/src/compiler.ts` |
| 1,957 | `packages/compiler/src/lexer.ts` |
| 1,780 | `packages/cli/src/cli.ts` |
| 1,759 | `packages/cli/src/typescript-declarations.ts` |
| 1,748 | `packages/compiler/src/formatter.ts` |
| 1,736 | `packages/cli/src/language-server.ts` |
| 1,685 | `packages/web/src/runtime-foundation.ts` |
| 1,662 | `packages/compiler/src/types.ts` |
| 1,573 | `packages/node/src/node-host-worker-runtime.ts` |
| 1,497 | `packages/compiler/src/collection-lowering-runtime.ts` |
| 1,490 | `packages/node/src/compiler.ts` |
| 1,384 | `packages/compiler/src/ast.ts` |
| 1,363 | `packages/compiler/src/index.ts` |
| 1,333 | `packages/cli/src/project-semantic.ts` |
| 1,272 | `packages/node/src/server-analyzer.ts` |
| 1,219 | `packages/cli/src/browser-test-runner.ts` |

### `packages/compiler/src/analyzer.ts`

| | |
| --- | ---: |
| File | 17,485 lines |
| `class Analyzer` | lines 1,709–17,485 (15,777 lines) |
| Members declared on it | 660 |
| Methods | 470 (2 of them `static`; no getters or setters) |
| Instance fields | 190 |
| `protected` members | 64 (see §4) |
| `LoweringHints` fields | 59 (`export interface LoweringHints`, line 530) |

The 15 largest methods, by brace-exact span:

| lines | span | method |
| ---: | --- | --- |
| 1,009 | 4115–5123 | `Analyzer.analyzeStatement` |
| 721 | 11037–11757 | `Analyzer.inferCollectionCall` |
| 597 | 8158–8754 | `Analyzer.inferExpressionType` |
| 394 | 9800–10193 | `Analyzer.inferCall` |
| 376 | 12202–12577 | `Analyzer.inferMember` |
| 312 | 6085–6396 | `Analyzer.analyzeClassBody` |
| 303 | 10551–10853 | `Analyzer.inferIntrinsicCall` |
| 208 | 7829–8036 | `Analyzer.analyzeAssignment` |
| 203 | 14529–14731 | `Analyzer.validateTypeReference` |
| 163 | 7571–7733 | `Analyzer.analyzeFunctionDeclaration` |
| 147 | 11770–11916 | `Analyzer.inferRecordFromCall` |
| 145 | 11930–12074 | `Analyzer.inferRecordMapFromCall` |
| 141 | 10213–10353 | `Analyzer.inferGenericCall` |
| 135 | 12615–12749 | `Analyzer.listMember` |
| 129 | 2015–2143 | `Analyzer.constructor` |

D114's table quoted these at 0.27.3 (`0d8b7dc`): 15,892 lines, 427 methods, 145
fields. The S1–S7 waves and W landed between then and `8bea026`, so the file is
1,593 lines larger. Two entries in that table do not reproduce here: the
constructor is 129 lines rather than 307, and `file` at 634 lines does not exist
on `Analyzer` — the only `file(` in the module is `NearestNameRoster.file`, 8
lines at 882. `LoweringHints` at 59 reproduces exactly.

### The other files R2–R4 name

Four of them are mostly *emitted runtime JavaScript held in a template
literal*, not TypeScript. Both views are recorded, because a split moves both.

| File | lines | of which template text | TypeScript declarations | embedded `function` blocks |
| --- | ---: | ---: | ---: | ---: |
| `packages/web/src/analyzer.ts` | 5,252 | 244 | 186 | — |
| `packages/web/src/runtime.ts` | 3,779 | 3,591 | 1 | 272 |
| `packages/web/src/runtime-foundation.ts` | 1,685 | 1,643 | 1 | 123 |
| `packages/node/src/serve-runtime.ts` | 4,228 | 4,024 | 0 | 215 |
| `packages/core/src/index.ts` | 3,239 | 2,464 | 30 | 282 |
| `packages/cli/src/project.ts` | 2,938 | 103 | 56 | — |

The five largest of each:

**`packages/web/src/analyzer.ts`** — 183 `inferWebIntrinsic` (237–419);
152 `VelarWebAnalyzer.analyzeNativeJsxAttribute` (4631–4782);
126 `VelarWebAnalyzer.analyzeComponent` (3273–3398);
125 `renderWatchSubject` (1508–1632);
110 `VelarWebAnalyzer.analyzeExtensionStatement` (2219–2328).

**`packages/web/src/runtime.ts`** — one TypeScript declaration, 10-line
`webModuleSource` (3770–3779). Embedded: 152 `database` (2933–3084);
93 `createStore` (2836–2928); 88 `lazy` (918–1005); 60 `Router` (1315–1374);
56 `read` (1948–2003).

**`packages/web/src/runtime-foundation.ts`** — one TypeScript declaration,
1,110-line `webRuntimeFoundation` (573–1682), which is the template. Embedded:
591 `__velarCreateRuntime` (1028–1618); 56 `__velarFlushSettle` (971–1026);
43 `__velarRequireRuntime` (1620–1662); 37 `__velarFlushOverflow` (890–926);
28 `__velarFlushRunaway` (840–867).

**`packages/node/src/serve-runtime.ts`** — no TypeScript declaration at all;
the module is exported string constants. Embedded: 173 `openapi` (3117–3289);
87 `serve` (4132–4218); 86 `__velarCreateServeRoute` (1239–1324);
81 `__velarCreateServePattern` (1157–1237); 77 `__velarCreateServeApp`
(1561–1637).

**`packages/core/src/index.ts`** — TypeScript: 35 `binaryBufferFields`
(153–187); 28 `binaryBuilderFields` (160–187); 17 `combinedExtensionModules`
(3215–3231); 12 `moduleInterface` (548–559); 10 `validationRuleOf` (196–205).
Embedded: 67 `display` (2974–3040); 66 `expect` (3041–3106); 46 `zonedParts`
(2430–2475); 40 `build` (2500–2539); 38 `parse` (2542–2579).

**`packages/cli/src/project.ts`** — 558 `compileProjectEntries` (245–802);
218 `appendInitializationCycleDiagnostics` (1157–1374); 171
`createAnalysisContext` (1563–1733); 148 `resolvedModuleInterface` (1735–1882);
141 `moduleInterfaceIdentity` (1421–1561).

## 3. Import cycles inside each package's `src`

Tarjan over every relative `import`/`export … from "./…"`. An edge is `type`
when the whole clause is `import type` / `export type`, or when every named
specifier carries its own `type`; anything else is a `value` edge.

| Package | modules | cycles |
| --- | ---: | ---: |
| `packages/cli/src` | 65 | 1 |
| `packages/compiler/src` | 44 | 1 |
| `packages/core/src` | 3 | 0 |
| `packages/create/src` | 5 | 0 |
| `packages/desktop/src` | 13 | 1 |
| `packages/node/src` | 26 | 0 |
| `packages/server/src` | 6 | 0 |
| `packages/web/src` | 27 | 0 |

**`packages/compiler/src` — 5 modules, 14 edges, 5 of them values.** This is the
cycle R1's `contracts.ts` is meant to break.

| kind | edge |
| --- | --- |
| type | `analyzer.ts -> extension.ts` |
| **value** | `emitter.ts -> analyzer.ts` |
| type | `emitter.ts -> extension.ts` |
| type | `extension.ts -> analyzer.ts` (×3 clauses) |
| **value** | `extension.ts -> analyzer.ts` |
| **value** | `extension.ts -> emitter.ts` |
| type | `extension.ts -> parser.ts` (×2 clauses) |
| **value** | `extension.ts -> parser.ts` |
| type | `lexer.ts -> extension.ts` |
| type | `parser.ts -> extension.ts` |
| **value** | `parser.ts -> lexer.ts` |

**`packages/cli/src` — 2 modules, 2 edges, 0 values.** `production-build.ts ↔
static-deployment.ts`, both `import type`. Type-only: it disappears at emit.

**`packages/desktop/src` — 2 modules, 2 edges, both values.** `config.ts ↔
manifest-migration.ts`.

## 4. The `protected` seam

The contract R1 must not break: 64 + 44 + 32 = 140 `protected` members across
the three Core classes, carrying 47 overrides from the two target packages —
some members are overridden by both, so the distinct overridden set is smaller.

| Core class | `protected` members | Web overrides | Node overrides |
| --- | ---: | ---: | ---: |
| `Analyzer` (`packages/compiler/src/analyzer.ts:1709`) | 64 | `VelarWebAnalyzer` 14 | `VelarNodeAnalyzer` 4 |
| `Parser` (`packages/compiler/src/parser.ts:221`) | 44 | `VelarWebParser` 8 | `VelarNodeParser` 3 |
| `JavaScriptEmitter` (`packages/compiler/src/emitter.ts:95`) | 32 | `WebJavaScriptEmitter` 12 | `NodeJavaScriptEmitter` 6 |

### `Analyzer` — 64 members

Fields: `diagnostics: Diagnostic[]`, `advisories: Advisory[]`,
`reactiveBindings: Map<string, "state">`, `enumValueBindings: Map<number, string>`,
`extensionLiterals: Map<string, string>`, `extensionCalls: Map<string, string>`,
`semanticJsxAttributeOwners: Map<string, ValueType>`,
`deferredExecutionDepth: number`, `constructorDepth: number`,
`flowFrameDepth: number`.

Methods (`W` = overridden by `VelarWebAnalyzer`, `N` = by `VelarNodeAnalyzer`):

| | signature |
| --- | --- |
| | `genericTypeInfo(name: string): GenericTypeInfo \| null` |
| | `readonlyDataViewOf(type: ValueType): ValueType` |
| | `findClassInReadonlyData(type: ValueType, seen: Set<string>, sawCycle: { cut: boolean }): { readonly suffix: string; readonly className: string } \| null` |
| W N | `predeclareExtensionStatement(_statement: Statement): boolean` |
| W N | `analyzeExtensionStatement(_statement: Statement): boolean` |
| | `extensionExpressionContainsDirectAwait(expression: Expression, contains: (expression: Expression) => boolean): boolean \| undefined` |
| | `extensionStatementContainsDirectAwait(statement: Statement, containsExpression: (expression: Expression) => boolean, containsBlock: (statements: readonly Statement[]) => boolean): boolean \| undefined` |
| W | `prescanExtensionScopeDeclaration(_statement: Statement): { readonly name: string; readonly span: Span } \| null` |
| W N | `inferExtensionExpression(_expression: Expression, _contextualType: ValueType): ValueType \| undefined` |
| W | `inferExtensionCall(_callee: ExtensionValueType, _arguments: readonly Expression[], _argumentNames: readonly (string \| null)[] \| undefined, _callSpan: Span): ValueType \| undefined` |
| W | `validateExtensionTypeSyntax(_syntax: TypeSyntax, _validate: (syntax: TypeSyntax) => boolean, _resolve: (reference: TypeReference) => ValueType): boolean \| undefined` |
| W | `extensionFieldsOf(_name: string): ReadonlyMap<string, ValueType> \| null` |
| W | `invalidExtensionAwaitContext(): boolean` |
| W | `invalidExtensionAwaitMessage(): string \| null` |
| | `isTopLevelScope(): boolean` |
| | `isPredeclared(statement: object): boolean` |
| | `expandAliases(type: ValueType, seen: ReadonlySet<string>): ValueType` |
| W | `analyzeStatement(statement: Statement): void` |
| W | `ownershipScopeRejection(): string \| null` |
| | `analyzeFunctionDeclaration(statement: AnalyzableFunctionDeclaration, className: string \| null, method, declareSelf, forceAsynchronous, declarationKind): void` |
| N | `contextualFunctionParameterDefault(_statement: AnalyzableFunctionDeclaration, _parameter: AnalyzableFunctionDeclaration["parameters"][number]): ValueType \| null` |
| | `analyzeBlock(statements: readonly Statement[], narrowed: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType>` |
| | `analyzeStatements(statements: readonly Statement[]): void` |
| W | `inferExpression(expression: Expression, contextualType: ValueType): ValueType` |
| | `inferParameterDefault(expression: Expression, contextualType: ValueType): ValueType` |
| | `resolvedAsyncResult(type: ValueType): ValueType` |
| | `inferredExpressionType(expression: Expression): ValueType` |
| | `inferredFunctionResult(statement: Pick<FunctionDeclaration, "returnType" \| "signatureSpan"> & { readonly abstract?: boolean }): ValueType` |
| | `narrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>` |
| | `negativeNarrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>` |
| | `requireCondition(type: ValueType, condition: Expression): void` |
| | `requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell: MutableCellTarget \| null): void` |
| W | `resolveAnnotation(reference: TypeReference \| null): ValueType` |
| | `resolveRawTypeReference(reference: TypeReference): ValueType` |
| | `resolveValidatedAnnotation(reference: TypeReference \| null): ValueType` |
| | `resolveResult(reference: TypeReference \| null): ValueType` |
| | `resolveValidatedResult(reference: TypeReference \| null): ValueType` |
| | `validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean` |
| | `typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void` |
| | `recoveredTypeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void` |
| | `advise(code: string, message: string, adviceSpan: Span, fix?: DiagnosticFix): void` |
| | `requireSettledCollectionElement(initializer: Expression, declared: ValueType, annotated: boolean): boolean` |
| | `declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span, internal, declaredType, importSource?: string, typeNamePosition?: BuiltinTypeNamePosition): void` |
| | `inComponentSetupPosition(): boolean` |
| | `inModuleInitializationPosition(): boolean` |
| W | `markDeclaredBindingReactive(name: string, kind: "state" \| "prop"): void` |
| | `reactiveBindingKind(name: string): "state" \| "prop" \| null` |
| | `semanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType>` |
| | `prescanScopeDeclarations(statements: readonly Statement[]): void` |
| | `lookup(name: string): Binding \| null` |
| | `isBuiltinValueReference(expression: Expression, name: PermanentNamespaceName \| "range"): boolean` |
| | `applyNarrowings(narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span): void` |
| | `enterScope(): void` |
| | `exitScope(): void` |

### `Parser` — 44 members

Fields: `lexicalExtensions: readonly CompilerLexicalExtension[]`,
`diagnostics: Diagnostic[]`, `advisories: Advisory[]`,
`suppressions: AdvisorySuppression[]`, `contextualKeywords: ReadonlySet<string>`.

| | signature |
| --- | --- |
| | `parseStatement(): Statement \| null` |
| W N | `parseExtensionStatement(_start: number, _modifiers: { readonly exported: boolean; readonly abstract: boolean; readonly asynchronous: boolean }): Statement \| null \| undefined` |
| W | `parseUnsafeExtensionStatement(_start: number): Statement \| null \| undefined` |
| W | `parseExtensionImport(_start: number): Statement \| null \| undefined` |
| | `parseTypeParameters(): readonly TypeParameterDeclaration[] \| null` |
| | `parseTypeArgumentList(): readonly TypeSyntax[]` |
| W | `parseParameters(): readonly Parameter[]` |
| | `parseBlock(): readonly Statement[]` |
| | `parseTypeReference(allowTrailingOptional): TypeReference` |
| W | `validateExtensionTypeArguments(_name: string, _arguments: readonly TypeSyntax[], _nameSpan: Span): boolean` |
| | `parseExpression(minimumPrecedence): Expression` |
| W N | `parseExtensionExpression(_token: Token): Expression \| undefined` |
| W | `parseExtensionNumericLiteral(token: Token, value: number, unit: string): Expression \| undefined` |
| | `parseNestedExpression(fragment: string, offset: number, bracketFragment, sourceOffsets?: readonly number[]): Expression` |
| W N | `createNestedParser(tokens: readonly Token[]): Parser` |
| | `inheritParseBudget(parent: Parser): void` |
| | `expectStatementEnd(): void` |
| | `expectStatementBoundary(): void` |
| | `reportUntypedExternParameters(parameters: readonly Parameter[]): void` |
| | `reportExternDeclarationBody(): boolean` |
| | `reportClassMemberReadonly(modifier: Token \| null, member: "field" \| "executable", code: string): void` |
| | `skipMistypedDeclaration(): void` |
| | `consumeNewlines(): void` |
| | `expect(kind: TokenKind, message: string): Token` |
| | `match(kind: TokenKind): boolean` |
| | `matchExtensionKeyword(value: string): boolean` |
| | `reservedWordMessage(noun: string): string \| null` |
| | `expectBindingName(message: string, noun: string): Token` |
| | `checkWord(value: string): boolean` |
| | `matchWord(value: string): boolean` |
| | `expectWord(value: string, message: string): Token` |
| | `check(kind: TokenKind): boolean` |
| | `peekKind(distance: number): TokenKind` |
| | `peekValue(distance: number): string` |
| | `advance(): Token` |
| | `reportInvalidAssignmentTarget(expression: Expression): void` |
| | `reportPrefixBang(bang: Token): void` |
| | `current(): Token` |
| | `previous(): Token` |

### `JavaScriptEmitter` — 32 members

Field: `hints: LoweringHints`.

| | signature |
| --- | --- |
| | `emitMappedJavaScript(sourceSpan: Span, render: () => string): string` |
| W N | `additionalHelpers(_program: Program): readonly string[]` |
| W | `reactiveBridgeHelpers(needsJavaScriptCallBoundary: boolean, needsCollections: boolean, usedIdentifiers: ReadonlySet<string>): readonly string[]` |
| | `usesSharedRuntimeModules(): boolean` |
| W | `detachedTaskHelpers(): readonly string[]` |
| | `disposalHelpers(): readonly string[]` |
| | `integrityFailureHelpers(): readonly string[]` |
| | `requiredValueHelpers(): readonly string[]` |
| | `requireRuntimeModule(source: string): void` |
| W | `includesErrorNormalizationRuntime(): boolean` |
| W N | `visitExtensionRuntimeExpression(_expression: Expression, _visitExpression: (expression: Expression) => void): boolean` |
| W N | `visitExtensionRuntimeStatement(_statement: Statement, _visitExpression: (expression: Expression) => void, _visitStatement: (statement: Statement) => void): boolean` |
| W | `extensionExpressionContainsDirectAwait(_expression: Expression, _contains: (expression: Expression) => boolean): boolean \| undefined` |
| W N | `extensionStatementContainsDirectAwait(_statement: Statement, _containsExpression: (expression: Expression) => boolean, _containsBlock: (statements: readonly Statement[]) => boolean): boolean \| undefined` |
| | `emitMappedStatement(statement: Statement, depth: number): string` |
| | `emitStatementLines(statements: readonly Statement[], depth: number): readonly string[]` |
| W N | `emitStatement(statement: Statement, depth: number): string` |
| W | `emitTypeCheck(type: ValueType, value: string, state): string` |
| W | `emitIsCheck(type: ValueType, value: string): string` |
| | `emitNarrowingCheck(type: ValueType, value: string, state): string` |
| | `genericTypeBinding(name: string): boolean` |
| | `runtimeTypeBinding(name: string): boolean` |
| | `nominalRuntimeReceiver(type: Extract<ValueType, { readonly kind: "class" \| "enum" \| "enumMember" }>): string \| null` |
| | `emitParameter(name: string, defaultValue: Expression \| null, rest): string` |
| | `emitMappedExpression(expression: Expression, normalizeNull): string` |
| W N | `emitExpression(expression: Expression): string` |
| | `emitCondition(expression: Expression): string` |
| | `expressionContainsDirectAwait(expression: Expression): boolean` |
| | `emitObjectKey(name: string): string` |
| | `emitBindingPatternStatements(pattern: BindingPattern, value: string, binding: "const" \| "let", exported: boolean, depth: number, label: string): readonly string[]` |
| | `blockAlwaysReturns(statements: readonly Statement[]): boolean` |

D114's table said "Analyzer 64, Parser 43, Emitter 32". Analyzer and Emitter
reproduce; `Parser` counts 44 here, five of which are fields.

## 5. The `@velarscript/compiler` public export list

R1's other frozen surface: 116 names from `src/index.ts` and 111 from
`src/extension.ts`. No star re-exports in either.

**`packages/compiler/src/index.ts` (116)** — `Advisory`, `AdvisoryResolution`,
`AdvisorySuppression`, `AdvisorySuppressionScan`, `AppliedMechanicalFix`,
`BinaryStorageKind`, `BindingNameRestriction`, `CORE_COMPILER_CONTEXTUAL_NAMES`,
`CORE_CONTEXTUAL_KEYWORDS`, `CORE_CONTEXTUAL_KEYWORD_WORDS`,
`CORE_EXPRESSION_CONSTRUCTS`, `CORE_NUMERIC_SUFFIXES`, `CORE_PRELUDE_NAMES`,
`CORE_STATEMENT_CONSTRUCTS`, `CORE_STATEMENT_HEAD_KEYWORDS`,
`CORE_VOCABULARY_NAMES`, `CORE_WORDS`, `CollectionKind`,
`CollectionMemberGuidance`, `CompileOptions`, `CompileResult`,
`CompilerSemanticExtension`, `CoreCompilerContext`, `CoreCompilerContextualName`,
`CoreContextualKeyword`, `CoreContextualKeywordWord`, `CoreNumericSuffix`,
`CorePreludeName`, `CoreVocabularyName`, `Diagnostic`, `DiagnosticEdit`,
`DiagnosticFix`, `EnumInfo`, `GenericApplication`, `GenericTypeInfo`,
`MAX_VELAR_SOURCE_CODE_UNITS`, `MechanicalFixResult`, `MemberNameRestriction`,
`ModuleDependency`, `ModuleDependencySpecifier`, `ModuleInspection`,
`ModuleStartupCode`, `ModuleStartupStatement`, `PERMANENT_NAMESPACE_NAMES`,
`PermanentNamespaceName`, `SemanticDeclareOptions`, `SemanticExpression`,
`SemanticExtensionContext`, `SemanticFunctionLike`, `SemanticImport`,
`SemanticIndex`, `SemanticMember`, `SemanticMemberReference`,
`SemanticModuleReference`, `SemanticReference`, `SemanticScope`,
`SemanticSymbol`, `SemanticSymbolKind`, `SemanticSyntaxDocumentation`,
`SemanticSyntaxToken`, `SemanticSyntaxTokenKind`, `SourceText`,
`SourceTypeGuidance`, `Span`, `TYPE_PARAMETER_DECLARATION_FORMS`,
`TypeParameterDeclarationForm`, `VELAR_BYTES_TYPE_IDENTITY`,
`VELAR_CORE_API_VERSION`, `VELAR_EXTENSION_PROTOCOL_VERSION`,
`VELAR_FLOAT32_BUFFER_TYPE_IDENTITY`, `VELAR_UINT16_BUFFER_TYPE_IDENTITY`,
`VELAR_UINT32_BUFFER_TYPE_IDENTITY`, `VELAR_UINT8_BUFFER_TYPE_IDENTITY`,
`ValueType`, `advisory`, `analysisTypeIdentity`, `applyMechanicalFixes`,
`binaryStorageKind`, `bindingNameRestriction`, `classApplicationType`,
`collectionMemberGuidance`, `compile`, `coreStatementConstructKey`,
`describeType`, `diagnostic`, `formatAdvisory`, `formatDiagnostic`,
`formatSource`, `genericApplicationIdentity`, `genericApplicationType`,
`inspectModule`, `isCoreReservedBinding`, `isForbiddenPrototypeMember`,
`isJavaScriptReservedBinding`, `isReadonlyView`, `isSourceIdentifierPart`,
`isSourceIdentifierStart`, `isValidSourceIdentifier`, `keywordKinds`,
`mechanicalEdits`, `mechanicalFix`, `memberNameRestriction`, `optionalOf`,
`permanentNamespaceCoveringModule`, `readonlyViewOf`,
`removedStandardFunctionGuidance`, `resolveAdvisorySuppressions`,
`scanAdvisorySuppressions`, `semanticImportAt`, `semanticModuleReferenceAt`,
`semanticSymbolAt`, `semanticTypeIdentity`, `semanticVisibleSymbolsAt`,
`sourceTypeNameGuidance`, `typeParameterDeclarationFormsPhrase`, `unionOf`.

**`packages/compiler/src/extension.ts` (111)** — `Analyzer`,
`CompilerAnalysisExtension`, `CompilerAnalyzerFactory`,
`CompilerEditorCompletion`, `CompilerEditorExtension`,
`CompilerEmbeddedJavaScriptModule`, `CompilerEmitter`, `CompilerEmitterOptions`,
`CompilerExtension`, `CompilerFormattingExtension`,
`CompilerFormattingOpaqueSourceScan`, `CompilerInspectionExtension`,
`CompilerInterfaceContext`, `CompilerIntrinsicAnalysisContext`,
`CompilerLexicalExtension`, `CompilerLexicalScanContext`,
`CompilerLexicalScanResult`, `CompilerModuleExtension`, `CompilerParserFactory`,
`CompilerProjectEditorCompletion`, `CompilerProjectEditorCompletionContext`,
`CompilerProjectEditorCompletionResult`, `CompilerProjectEditorExtension`,
`CompilerProjectEditorRenameContext`, `CompilerProjectEditorVisibleSymbol`,
`CompilerResourceDependency`, `CompilerStyleSegments`, `CompilerSyntaxExtension`,
`JavaScriptEmitter`, `ModuleInterface`, `ModuleTest`, `Parser`,
`RetiredNamespace`, `TEXT_NAMESPACE_MEMBERS`, `VELAR_ASSERTION_ERROR_RUNTIME`,
`VELAR_CLASS_FIELD_MODULE`, `VELAR_CLASS_FIELD_MODULE_SOURCE`,
`VELAR_CLASS_FIELD_RUNTIME`, `VELAR_COLLECTION_HOST_EXPORTS`,
`VELAR_COLLECTION_HOST_MODULE`, `VELAR_COLLECTION_HOST_MODULE_SOURCE`,
`VELAR_COLLECTION_IDENTITY_RUNTIME`, `VELAR_COLLECTION_LIST_RUNTIME`,
`VELAR_COLLECTION_LOWERING_DEPENDENCIES`, `VELAR_COLLECTION_LOWERING_EXPORTS`,
`VELAR_COLLECTION_LOWERING_MODULE`, `VELAR_COLLECTION_LOWERING_MODULE_SOURCE`,
`VELAR_COLLECTION_LOWERING_RUNTIME`, `VELAR_COLLECTION_RECORD_RUNTIME`,
`VELAR_COLLECTION_SET_MAP_RUNTIME`, `VELAR_COLLECTION_TYPE_RUNTIME`,
`VELAR_ERROR_NORMALIZATION_MODULE`, `VELAR_ERROR_NORMALIZATION_MODULE_SOURCE`,
`VELAR_ERROR_NORMALIZATION_RUNTIME`, `VELAR_EXTENSION_PROTOCOL_VERSION`,
`VELAR_HOST_ERROR_NAMES`, `VELAR_HOST_ERROR_PATH_NAMES`,
`VELAR_HOST_ERROR_RUNTIME`, `VELAR_NARROWING_MODULE`,
`VELAR_NARROWING_MODULE_SOURCE`, `VELAR_NARROWING_RUNTIME`,
`VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE`, `VELAR_NON_REACTIVE_BRIDGE_RUNTIME`,
`VELAR_NON_REACTIVE_COLLECTION_BRIDGE_RUNTIME`, `VELAR_NUMBER_METHOD_RUNTIME`,
`VELAR_PRIMITIVE_METHOD_MODULE`, `VELAR_PRIMITIVE_METHOD_MODULE_SOURCE`,
`VELAR_PROMISE_NORMALIZATION_MODULE`,
`VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE`,
`VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY`,
`VELAR_PROMISE_NORMALIZATION_RUNTIME`, `VELAR_RANGE_MODULE`,
`VELAR_RANGE_MODULE_SOURCE`, `VELAR_RANGE_RUNTIME`,
`VELAR_REACTIVE_BRIDGE_MODULE`, `VELAR_RUNTIME_REGISTRY_KEY`,
`VELAR_RUNTIME_SCHEMA_VERSION`, `VELAR_RUNTIME_TYPE_COLLECTION_RUNTIME`,
`VELAR_STRICT_JSON_RUNTIME`, `VELAR_TEXT_METHOD_RUNTIME`,
`VELAR_TYPE_REGISTRY_KEY`, `VELAR_TYPE_REGISTRY_RUNTIME`,
`VELAR_TYPE_VALIDATION_MODULE`, `VELAR_TYPE_VALIDATION_MODULE_SOURCE`,
`VELAR_TYPE_VALIDATION_RUNTIME`, `VELAR_UTF8_RUNTIME`,
`VELAR_VALIDATION_ERROR_RUNTIME`, `VelarExtensionContract`,
`VelarExtensionKind`, `anyType`, `bindingNeverReassigned`, `boolType`,
`describeType`, `expressionContainsDirectAwait`,
`findInterpolatedExpressionEnd`, `invalidType`, `isAssignable`,
`isInvalidType`, `isReadonlyView`, `mutatingCollectionMethods`, `nonOptional`,
`nullType`, `numberType`, `optionalOf`, `readonlyViewOf`,
`scanOpaqueEmbeddedSource`, `scanStringLiteral`, `spanIdentity`, `stringType`,
`unionOf`, `unknownType`.

## 6. Test inventory

The runner's counts are authoritative; they come from the `test:full` and
`release:check` runs recorded in §7.

| | files | tests |
| --- | ---: | ---: |
| `tests/*.test.ts` + two acceptance files | 210 | **2,758** |
| Quick suite (`npm test`, the local default) | 70 | **1,083** |
| Reserved for `test:full` only | 140 | 1,675 (60.7%) |
| VelarScript project tests (`run-project-gate.mjs unit`) | 5 projects | 40 |

A static scan of `test(` call sites finds 2,738 across the 210 files; the 20-test
gap against the runner is tests created inside loops, in
`hardening-d59-d60-formatter.test.ts` and `module-enum-surface.test.ts`. By that
same static scan the 147 `hardening-*` files hold 1,735 of the 2,738 call sites
(63.4%), and the 7 `hardening-closeout-*` files among them — the only ones the
quick suite runs — hold 61.

**The quick/full partition rule** (`scripts/run-node-tests.mjs`,
`nodeTestFiles`): the suite is every `tests/*.test.ts` plus `ci.acceptance.ts`
and `release.acceptance.ts`, sorted by name. `full` is all of them. `quick`
drops every file whose name starts with `hardening-` unless it starts with
`hardening-closeout-`. Nothing is listed by hand; there is no exclusion table.

The 10 largest test files by test count:

| tests | lines | file |
| ---: | ---: | --- |
| 530 | 29,949 | `compiler.test.ts` |
| 42 | 3,706 | `node-platform.test.ts` |
| 39 | 1,173 | `hardening-audit-core.test.ts` |
| 38 | 915 | `hardening-wave-c2.test.ts` |
| 38 | 698 | `hardening-wave-z1.test.ts` |
| 38 | 1,464 | `hardening-web-surface.test.ts` |
| 36 | 682 | `hardening-audit-runtime.test.ts` |
| 34 | 448 | `hardening-audit-semantics.test.ts` |
| 33 | 716 | `hardening-d103-look-tokens.test.ts` |
| 27 | 759 | `hardening-wave-z2.test.ts` |

By line count the order starts `compiler.test.ts` 29,949; `node-platform.test.ts`
3,706; `desktop-runtime.test.ts` 1,742; `hardening-web-surface.test.ts` 1,464;
`hardening-web-runtime.test.ts` 1,208. The suite totals 106,687 lines.

**Helper names defined in three or more test files** — the duplication R5
removes. 39 names:

| files | name |
| ---: | --- |
| 53 | `run` |
| 27 | `messages` |
| 27 | `executeModule` |
| 24 | `compile` |
| 15 | `execute` |
| 12 | `webProject` |
| 12 | `diagnostics` |
| 10 | `runCommand` |
| 9 | `codes`, `compiled`, `runCli` |
| 8 | `runtime`, `webMessages`, `compileWeb`, `runProject` |
| 7 | `writeTree`, `reported` |
| 6 | `runClean`, `checkProject`, `materializeNodeRuntimeDependencies` |
| 5 | `rejects`, `temporaryRoot`, `projectMessages` |
| 4 | `coreProject`, `linkedModuleUrls`, `messagesOf`, `mountInChromium`, `clean` |
| 3 | `advisories`, `reports`, `reportedChange`, `poison`, `runFailing`, `emitted`, `routePattern`, `look`, `webDiagnostics`, `moduleOf`, `httpResponseType` |

D114's table quoted 2,548 tests in 200 files and "83 `hardening-<wave>` files
carrying 1,734 tests (68%)" at 0.27.3. At `8bea026` it is 2,758 tests in 210
files, and 147 files begin with `hardening-`; the largest name families are
`hardening-d90-*` (35 files), `hardening-wave-*` (12), `hardening-cli-*` (9),
`hardening-web-*` (7), `hardening-core-*` (7), `hardening-closeout-*` (7).

## 7. Gate timings on this machine, this commit

Read from `/private/tmp/velar-d114/release-gates.log`, the orchestrator's
`npm run release:check` and `npm run test:full` over `8bea026`. The log carries
no timestamps, so only the `node --test` durations are exact; the wall times in
the second table were taken by this wave's own runs.

| Run | files | tests | result | duration |
| --- | ---: | ---: | --- | ---: |
| `node --test` quick (inside `release:check`) | 70 | 1,083 | 1,083 pass, 0 fail | `duration_ms 320026.044959` |
| `node --test` full (inside `test:full`) | 210 | 2,758 | 2,758 pass, 0 fail | `duration_ms 525205.671459` |
| `run-project-gate.mjs unit` | 5 projects | 40 | all pass | not separately timed |
| `check-project-builds.mjs` | 5 projects | — | checked and built | not separately timed |

Wall time measured by this wave on `8bea026`, from a warm checkout, each command
run once and green:

| Command | wall time | what it reported |
| --- | ---: | --- |
| `npm run check` | 9,888 ms | all eight steps, `tsc` included |
| `npm test` | 331,269 ms | 1,083 pass / 0 fail, `duration_ms 327255.264583`, then 40 project tests |
| `npm run fingerprint` | 7,722 ms | 828 files, byte-identical to the listing beside this file |

`npm run check` is fast because TypeScript 7's native compiler builds all eight
packages in seconds; the `node --test` run is where the time is.

## 8. What the tour and app builds weigh

Production `velar build`, from the same fingerprinted output. (`examples/app`
enables source maps; `examples/tour/web` does not.)

| | `examples/tour/web` | `examples/app` |
| --- | ---: | ---: |
| Modules compiled | 13 | 17 |
| JavaScript, total | **1,072,133 B** | **956,358 B** |
| — entry chunk | 1,010,489 B `assets/main-*.js` | 746,145 B `assets/main-*.js` |
| — shared chunk | 61,575 B | 157,210 B |
| — lazy route chunk | 69 B | 53,003 B |
| CSS | **29,836 B** | **5,169 B** |
| HTML (`index.html` = `404.html`) | 747 B each | 741 B each |
| Source maps | none | 972,571 B over 3 files |
| `velar-deploy.json` | 1,816 B | 1,816 B |
| Public assets | 327 B (`tour-mark.svg`) | 1,049 B (svg, robots.txt, activity.json) |

`examples/tour/web`'s `buildId` is `19b354659567eee2b037914b87d4f251e56d0a3a314f847947c27b7d4b4c6d94`
and reproduces from any output directory. `examples/app`'s does not; see the
finding in §1.

The D34 "hello-world baseline" (P3) is a different measurement and is not
attempted here.

## How to reproduce

```bash
# §1 fingerprint
npm run fingerprint -- --write /tmp/fingerprint.txt
npm run fingerprint -- --compare docs/decisions/archive/REFACTOR-BASELINE-2026-09-05.fingerprint.txt

# §2 sizes
for d in packages/*/src; do echo "$d $(find "$d" -name '*.ts' | wc -l) $(find "$d" -name '*.ts' -exec cat {} + | wc -l)"; done
find packages/*/src -name '*.ts' -exec wc -l {} + | sort -rn | sed -n '2,26p'
awk '/^export interface LoweringHints/,/^}/' packages/compiler/src/analyzer.ts | grep -cE '^  (readonly )?[A-Za-z_$][A-Za-z0-9_$]*\??:'

# §6 test inventory
node -e 'import("node:fs").then(({readdirSync})=>console.log(readdirSync("tests").filter(n=>n.startsWith("hardening-")).length))'
node scripts/run-node-tests.mjs quick   # prints the quick/full split
```

§2's per-method spans, §3's cycles and §4's seam inventory were taken with
throwaway scanners in the wave's scratch directory (brace-depth spans, Tarjan
over relative imports, and a 2-space-indent member walk). They are measurements,
not tooling: only `scripts/output-fingerprint.mjs` — the one the acceptance
criterion needs on every slice — was added to the repository.

## 基线重取记录

- 2026-09-05（合并 L、F1 语言波之后）：F1 的 H-U1 改了发射的 Web 运行时前奏（`__velarState.set` 记录自失效写入路径），产物字节按设计变化；指纹清单在该合并提交上重新生成。指纹不变的要求只对**重构片**相对其起点成立，语言波落地后重取基线。
- 2026-09-05（合并 F2 之后）：F2 改了 Web 运行时（`__velarGraphIsRecord`、runaway 报告措辞）与若干发射细节，产物按设计变化；指纹清单在该合并提交上重新生成。
