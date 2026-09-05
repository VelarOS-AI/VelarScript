import { resolveAdvisorySuppressions, type AdvisorySuppression } from "./advisory-suppression.ts";
import { Analyzer, inferredResultPlaceholderType, isCorePrimitiveName, type AnalysisContext, type ClassField, type ClassInfo, type InitializationImportRead } from "./analyzer.ts";
import { astNodesOfKind, blockContainsDirectAwait, moduleStartupCode, testFunctionName } from "./ast.ts";
import type { BindingPattern, DynamicImportExpression, Expression, FunctionDeclaration, ModuleStartupCode, Program, Statement, TypeReference } from "./ast.ts";
import { diagnostic, type Advisory, type Diagnostic } from "./diagnostic.ts";
import { JavaScriptEmitter } from "./emitter.ts";
import { programWithEmbeddedJavaScriptImports } from "./embedded-module.ts";
import type { EmbeddedJavaScriptEditorToken } from "./embedded-javascript-editor.ts";
import type { CompilerEmbeddedJavaScriptModule, CompilerEmitter, CompilerEmitterOptions, CompilerExtension, CompilerInterfaceContext, CompilerResourceDependency, CompilerStyleSegments, ModuleInterface, ModuleTest } from "./extension.ts";
import { Lexer } from "./lexer.ts";
import { isParserComplexityFailure, Parser } from "./parser.ts";
import { SourceText, type Span } from "./source.ts";
import { bindingNameRestriction, memberNameRestriction } from "./source-names.ts";
import { buildSemanticIndex, type SemanticIndex } from "./semantic.ts";
import { byCodeUnit } from "./stable-order.ts";
import type { Token } from "./token.ts";
import { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
import {
  bindNamedTypeParameters,
  boolType,
  classApplicationType,
  genericApplicationIdentity,
  genericApplicationType,
  invalidType,
  isTypeParameterBound,
  mergeTypes,
  nullType,
  numberType,
  optionalOf,
  resolveTypeReference,
  readonlyViewOf,
  resolvedAsyncType,
  stringType,
  unknownType,
  type EnumInfo,
  type GenericTypeInfo,
  type TypeParameterBound,
  type ValueType,
} from "./types.ts";

export { advisory, diagnostic, formatAdvisory, formatDiagnostic, mechanicalEdits, mechanicalFix, type Advisory, type Diagnostic, type DiagnosticEdit, type DiagnosticFix } from "./diagnostic.ts";
export { resolveAdvisorySuppressions, scanAdvisorySuppressions, type AdvisoryResolution, type AdvisorySuppression, type AdvisorySuppressionScan } from "./advisory-suppression.ts";
export { applyMechanicalFixes, type AppliedMechanicalFix, type MechanicalFixResult } from "./mechanical-fix.ts";
export { formatSource } from "./formatter.ts";
export { collectionMemberGuidance, removedStandardFunctionGuidance, sourceTypeNameGuidance, type CollectionKind, type CollectionMemberGuidance, type SourceTypeGuidance } from "./language-guidance.ts";
export { SourceText, type Span } from "./source.ts";
export type { EmbeddedJavaScriptEditorToken, EmbeddedJavaScriptEditorTokenModifier, EmbeddedJavaScriptEditorTokenType } from "./embedded-javascript-editor.ts";
export { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
export { bindingNameRestriction, isCoreReservedBinding, isForbiddenPrototypeMember, isJavaScriptReservedBinding, isSourceIdentifierPart, isSourceIdentifierStart, isValidSourceIdentifier, memberNameRestriction, type BindingNameRestriction, type MemberNameRestriction } from "./source-names.ts";
export { VELAR_EXTENSION_PROTOCOL_VERSION } from "./extension.ts";
export { CORE_EXPRESSION_CONSTRUCTS, CORE_STATEMENT_CONSTRUCTS, coreStatementConstructKey, type ModuleStartupCode, type ModuleStartupStatement } from "./ast.ts";
// D62 rule 157: the editor's keyword list is the lexer's table plus Core's
// contextual roster, so it is published rather than retyped downstream.
export { keywordKinds } from "./token.ts";
export type { CompilerAnalysisExtension, CompilerAnalyzerFactory, CompilerEditorCompletion, CompilerEditorExtension, CompilerEmbeddedJavaScriptModule, CompilerEmitter, CompilerEmitterOptions, CompilerExtension, CompilerFormattingExtension, CompilerInspectionExtension, CompilerInterfaceContext, CompilerIntrinsicAnalysisContext, CompilerLexicalExtension, CompilerLexicalScanContext, CompilerLexicalScanResult, CompilerModuleExtension, CompilerParserFactory, CompilerProjectEditorCompletion, CompilerProjectEditorCompletionContext, CompilerProjectEditorCompletionResult, CompilerProjectEditorExtension, CompilerProjectEditorRenameContext, CompilerProjectEditorVisibleSymbol, CompilerResourceDependency, CompilerStyleSegments, ModuleInterface, ModuleTest, VelarExtensionContract, VelarExtensionKind } from "./extension.ts";
export { semanticImportAt, semanticModuleReferenceAt, semanticSymbolAt, semanticVisibleSymbolsAt, type CompilerSemanticExtension, type SemanticDeclareOptions, type SemanticExpression, type SemanticExtensionContext, type SemanticFunctionLike, type SemanticImport, type SemanticIndex, type SemanticMember, type SemanticMemberReference, type SemanticModuleReference, type SemanticReference, type SemanticScope, type SemanticSymbol, type SemanticSymbolKind, type SemanticSyntaxDocumentation, type SemanticSyntaxToken, type SemanticSyntaxTokenKind } from "./semantic.ts";
export { analysisTypeIdentity, binaryStorageKind, classApplicationType, describeType, genericApplicationIdentity, genericApplicationType, isReadonlyView, optionalOf, readonlyViewOf, semanticTypeIdentity, unionOf, VELAR_BYTES_TYPE_IDENTITY, VELAR_FLOAT32_BUFFER_TYPE_IDENTITY, VELAR_UINT8_BUFFER_TYPE_IDENTITY, VELAR_UINT16_BUFFER_TYPE_IDENTITY, VELAR_UINT32_BUFFER_TYPE_IDENTITY, type BinaryStorageKind, type EnumInfo, type GenericApplication, type GenericTypeInfo, type ValueType } from "./types.ts";
export { permanentNamespaceCoveringModule } from "./analyzer.ts";
export type { AnalysisContext, ClassField, ClassInfo, InitializationImportRead } from "./analyzer.ts";
export {
  CORE_CONTEXTUAL_KEYWORD_WORDS,
  CORE_CONTEXTUAL_KEYWORDS,
  CORE_COMPILER_CONTEXTUAL_NAMES,
  CORE_NUMERIC_SUFFIXES,
  CORE_PRELUDE_NAMES,
  CORE_STATEMENT_HEAD_KEYWORDS,
  CORE_VOCABULARY_NAMES,
  CORE_WORDS,
  PERMANENT_NAMESPACE_NAMES,
  TYPE_PARAMETER_DECLARATION_FORMS,
  VELAR_CORE_API_VERSION,
  typeParameterDeclarationFormsPhrase,
  type CoreContextualKeyword,
  type CoreContextualKeywordWord,
  type CoreCompilerContext,
  type CoreCompilerContextualName,
  type CoreNumericSuffix,
  type CorePreludeName,
  type CoreVocabularyName,
  type PermanentNamespaceName,
  type TypeParameterDeclarationForm,
} from "./core-vocabulary.ts";

export interface CompileOptions {
  readonly path?: string;
  readonly analysis?: AnalysisContext;
  readonly exportFunctions?: ReadonlySet<string>;
  readonly extensions?: readonly CompilerExtension[];
  readonly resourceContents?: ReadonlyMap<string, string>;
  readonly sharedRuntimeModules?: boolean;
  /** 当前源文件是否作为程序入口生成 `@main`；直接编译单个源文件时默认为 true。 */
  readonly executeMain?: boolean;
  /**
   * 是否生成 Source Map。编译器 API 默认生成，便于开发工具和诊断调用方继续
   * 获得完整位置信息；生产构建可显式关闭，避免在随后不会写出映射时仍遍历
   * 整份生成代码和源位置表。
   */
  readonly emitSourceMap?: boolean;
}

export interface CompileResult {
  /** 模块是否声明了编译器拥有的 `@main` 程序入口。 */
  readonly hasMain: boolean;
  /**
   * 模块顶层的启动代码——没有 `@main` 时它就停在那里。
   *
   * `hasMain` 只回答入口区域在不在；应用入口契约还要知道「不在的时候，启动代码
   * 是什么形状」，才能把可证明等价的一种改写交给 `velar fix`，把其余形状原样退
   * 回给作者。两个问题由同一次解析回答，不需要下游重新解析。
   */
  readonly moduleStartup: ModuleStartupCode;
  readonly code: string | null;
  readonly sourceMap: string | null;
  readonly embeddedModules: readonly CompilerEmbeddedJavaScriptModule[];
  /** Editor-only roles from embedded JavaScript; separate from Velar symbols/references. */
  readonly embeddedJavaScriptTokens: readonly EmbeddedJavaScriptEditorToken[];
  readonly css: string | null;
  readonly styleSegments: CompilerStyleSegments | null;
  readonly runtimeModules: readonly string[];
  readonly extensions: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  /**
   * D89: the advisory channel. Advisories are reported beside the diagnostics
   * and never counted with them, so they never withhold `code`.
   */
  readonly advisories: readonly Advisory[];
  readonly source: SourceText;
  readonly dependencies: readonly ModuleDependency[];
  readonly resources: readonly CompilerResourceDependency[];
  readonly moduleInterface: ModuleInterface;
  readonly semanticIndex: SemanticIndex;
  /** Initialization-position reads of imported bindings; the project driver checks them against module cycles. */
  readonly initializationImportReads: readonly InitializationImportRead[];
}

export interface ModuleDependencySpecifier {
  readonly imported: string;
  readonly local: string;
  readonly namespace: boolean;
}

export interface ModuleDependency {
  readonly source: string;
  /** Author source span of the literal module specifier. */
  readonly span: Span;
  readonly javascript: boolean;
  readonly unsafe: boolean;
  readonly dynamic: boolean;
  /** A checked resource edge that is emitted as an ESM value import. */
  readonly resource?: "json";
  /** True for `export {name} from "source"` re-export dependencies. */
  readonly reExport?: boolean;
  /** True when the importing module declares `extern module "source"` itself. */
  readonly externOwned?: boolean;
  readonly specifiers: readonly ModuleDependencySpecifier[];
}

export interface ModuleInspection {
  readonly diagnostics: readonly Diagnostic[];
  /** D89: the lexical and syntactic advisories of this module. */
  readonly advisories: readonly Advisory[];
  readonly source: SourceText;
  readonly dependencies: readonly ModuleDependency[];
  readonly resources: readonly CompilerResourceDependency[];
  readonly moduleInterface: ModuleInterface;
  readonly semanticIndex: SemanticIndex;
  /** Editor-only roles from embedded JavaScript; separate from Velar symbols/references. */
  readonly embeddedJavaScriptTokens: readonly EmbeddedJavaScriptEditorToken[];
}

export function inspectModule(text: string, options: Pick<CompileOptions, "path" | "extensions"> = {}): ModuleInspection {
  const extensions = normalizedExtensions(options.extensions ?? []);
  const parsed = parseModule(text, options.path ?? "<source>", extensions);
  const semanticProgram = programWithEmbeddedJavaScriptImports(parsed.program, parsed.source.path);
  // An inspection stops after parsing, so the analyzer's advisories are absent
  // by construction: suppressions still apply, and a suppression that matched
  // nothing here is unanswerable rather than stale.
  const resolved = resolveAdvisorySuppressions(parsed.source, parsed.advisories, parsed.suppressions, { reportStale: false });
  return {
    diagnostics: parsed.diagnostics,
    advisories: resolved.advisories,
    source: parsed.source,
    dependencies: dependenciesOf(parsed.program),
    resources: resourcesOf(parsed.program, extensions),
    moduleInterface: interfaceOf(semanticProgram, parsed.source.path, extensions),
    semanticIndex: buildSemanticIndex(semanticProgram, parsed.source, new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), extensions.flatMap((extension) => extension.semantic ? [extension.semantic] : []), parsed.tokens),
    embeddedJavaScriptTokens: embeddedJavaScriptTokensOf(parsed.program),
  };
}

export function compile(text: string, options: CompileOptions = {}): CompileResult {
  try {
    return compileUnchecked(text, options);
  } catch (error) {
    // 「源码嵌套过深」由显式预算判定：解析器的语法深度门（parser.ts 的
    // MAX_PARSE_DEPTH）和下面 MAX_ANALYSIS_NESTING_DEPTH 的 AST 深度门。走到这里
    // 说明还有一条没设门的递归路径把 JavaScript 栈用尽了 —— 那是编译器自己的
    // 缺陷，不是作者写得太复杂，所以报内部错误并请求上报，而不是把责任推给用户。
    // 栈深度取决于引擎、线程栈大小和当前已用深度，所以这条路径一旦可达，同一份
    // 源码在 CLI、playground、worker 里的结论就会不一致；把它标成内部错误正是为了
    // 让这种不确定性可见而不是被伪装成一条正常诊断。
    if (!isJavaScriptStackOverflow(error)) throw error;
    return emptyCompileResult(text, options, diagnostic(
      "VEL9001",
      "Internal compiler error: a compiler recursion ran out of JavaScript stack before any explicit budget stopped it; please report this module",
      { start: 0, end: Math.min(1, text.length) },
    ));
  }
}

function compileUnchecked(text: string, options: CompileOptions): CompileResult {
  const extensions = normalizedExtensions(options.extensions ?? []);
  const parsed = parseModule(text, options.path ?? "<source>", extensions);
  const semanticProgram = programWithEmbeddedJavaScriptImports(parsed.program, parsed.source.path);
  // 解析器的语法深度门管不到这里：`1 + 1 + …` 这样的左结合链是循环解析的，一层
  // 语法深度都不花，却生成一棵和链等长的 AST，而分析器、发射器和语义索引都是递归
  // 遍历。所以解析之后再过一道显式的 AST 深度门，是「嵌套过深」在任何宿主上都给出
  // 同一个答案的唯一办法。这道门带节点自己的位置，用户知道该改哪里。
  const overDeep = nodeSpanBeyondNestingDepth(semanticProgram, MAX_ANALYSIS_NESTING_DEPTH);
  if (overDeep) {
    return emptyCompileResult(text, options, diagnostic(
      "VEL2008",
      `VelarScript source nesting is too complex to process safely; expression and statement nesting cannot exceed ${MAX_ANALYSIS_NESTING_DEPTH} levels`,
      overDeep,
    ));
  }
  const diagnostics = [...parsed.diagnostics];
  const advisories: Advisory[] = [...parsed.advisories];
  const analysisExtensions = extensions.flatMap((extension) => extension.analysis ? [extension.analysis] : []);
  const analyzerExtensions = extensions.filter((extension) => extension.analyzer);
  if (analyzerExtensions.length > 1) throw new Error("Only one compiler extension may own semantic analysis");
  const analysisResources = options.resourceContents ?? options.analysis?.resources;
  const analysisContext: AnalysisContext = {
    ...options.analysis,
    path: parsed.source.path,
    sourceText: parsed.source.text,
    executeMain: options.executeMain !== false,
    ...(analysisResources ? { resources: analysisResources } : {}),
  };
  const createAnalyzer = (
    inferredFunctionResults: ReadonlyMap<string, ValueType> = new Map(),
    finalizeFunctionResultInference = false,
  ): Analyzer => {
    const context: AnalysisContext = {
      ...analysisContext,
      inferredFunctionResults,
      finalizeFunctionResultInference,
    };
    return analyzerExtensions[0]?.analyzer?.create(context, analysisExtensions)
      ?? new Analyzer(context, analysisExtensions);
  };
  let analyzer = createAnalyzer();
  // Semantic analysis also runs when every earlier diagnostic is a guidance
  // diagnostic that recovered as the guided spelling, so lexer-, parser-, and
  // analyzer-level guidance co-reports in one compile. Compilation still
  // fails: the emission gate below requires zero diagnostics.
  if (diagnostics.every((item) => item.recovered)) {
    // Omitted results use isolated semantic passes so forward and recursive
    // calls converge before the one authoritative diagnostic/lowering pass.
    // Intermediate diagnostics are intentionally discarded.
    const initialDiagnostics = analyzer.analyze(semanticProgram);
    let inferredResults = analyzer.inferredFunctionResults();
    if (inferredResults.size === 0) {
      diagnostics.push(...initialDiagnostics);
      advisories.push(...analyzer.analyzedAdvisories());
    } else {
      // 收敛依据：每一趟至少让一个省略了结果标注的函数定型，所以 `size + 2` 是这个
      // 假设下的紧上界（+1 定完最后一个，+1 确认已经稳定）。外层的硬上限则是一条
      // **工作量**预算而不是正确性判据 —— 每一趟都是全模块重分析，趟数再随函数数
      // 线性增长，去掉上限最坏情况就是模块规模的平方。所以上限保留，但预算用尽而
      // 仍未稳定这件事必须报出来：静默地把最后一趟（可能正在两个类型之间震荡的）
      // 结果当成答案，等于交给用户一个看起来编译成功、推断结果却不确定的产物。
      const maximumPasses = Math.min(Math.max(inferredResults.size + 2, 4), MAX_RESULT_INFERENCE_PASSES);
      let converged = false;
      for (let pass = 0; pass < maximumPasses; pass += 1) {
        const probe = createAnalyzer(inferredResults);
        probe.analyze(semanticProgram);
        const next = probe.inferredFunctionResults();
        converged = Analyzer.inferredFunctionResultsMatch(inferredResults, next);
        inferredResults = next;
        if (converged) break;
      }
      analyzer = createAnalyzer(inferredResults, true);
      diagnostics.push(...analyzer.analyze(semanticProgram));
      // The advisories are read off the same analyzer whose diagnostics were
      // kept; the probe passes above are discarded whole.
      advisories.push(...analyzer.analyzedAdvisories());
      if (!converged) {
        // 权威趟本身就是最后一次收敛检查：它以最后一趟的结果为种子重新推断，推出来
        // 的还是同一组结果就说明种子已经是真不动点，预算刚好用尽也无妨。只有这里
        // 仍然不一致，才是「没收敛」，而它必须留下痕迹。
        const settled = analyzer.inferredFunctionResults();
        const unsettled = unsettledResultKeys(inferredResults, settled);
        if (unsettled.length > 0) {
          diagnostics.push(diagnostic(
            "VEL2038",
            `Result type inference did not settle within the compiler's ${maximumPasses}-pass budget; ${unsettled.length} inferred result${unsettled.length === 1 ? "" : "s"} still changed on the last pass and must be annotated explicitly`,
            spanOfResultKey(unsettled[0] ?? "0:0"),
          ));
        }
      }
    }
  }

  // D89: the reasoned suppressions are applied here, between the last producer
  // and the emission gate. A stale one is a diagnostic, so it must join
  // `diagnostics` before the gate reads the array — but only once the module
  // otherwise compiles, because an earlier failure can keep the stage that
  // would have reported the advisory from running at all.
  const resolved = resolveAdvisorySuppressions(parsed.source, advisories, parsed.suppressions, {
    reportStale: diagnostics.length === 0,
  });
  diagnostics.push(...resolved.diagnostics);
  const reportedAdvisories = [...resolved.advisories];

  diagnostics.sort((left, right) => left.span.start - right.span.start || byCodeUnit(left.code, right.code));
  reportedAdvisories.sort((left, right) => left.span.start - right.span.start || byCodeUnit(left.code, right.code));
  const emitterExtensions = extensions.filter((extension) => extension.createEmitter);
  if (emitterExtensions.length > 1) throw new Error("Only one compiler extension may own JavaScript emission");
  const emitterOptions: CompilerEmitterOptions = {
    sourcePath: parsed.source.path,
    source: parsed.source,
    executeMain: options.executeMain !== false,
    ...(options.sharedRuntimeModules === undefined ? {} : { sharedRuntimeModules: options.sharedRuntimeModules }),
  };
  const emitter: CompilerEmitter = emitterExtensions[0]?.createEmitter?.(
    analyzer.loweringHints(),
    options.exportFunctions ?? new Set(),
    options.resourceContents ?? new Map(),
    options.analysis?.extensionImports ?? new Map(),
    emitterOptions,
  )
    ?? new JavaScriptEmitter(analyzer.loweringHints(), options.exportFunctions, emitterOptions);
  const code = diagnostics.length === 0 ? emitter.emit(parsed.program) : null;
  const emitSourceMap = options.emitSourceMap !== false;
  const sourceMap = code === null || !emitSourceMap ? null : emitter.sourceMap(parsed.source);
  const embeddedModules = code === null ? [] : emitter.embeddedModules?.(parsed.source, emitSourceMap) ?? [];
  const css = code === null ? null : emitter.css?.() ?? null;
  const styleSegments = code === null ? null : emitter.styleSegments?.() ?? null;
  const runtimeModules = code === null ? [] : emitter.runtimeModules?.() ?? [];
  const semanticExpressions = analyzer.semanticExpressions();
  const semanticIndex = buildSemanticIndex(
    semanticProgram,
    parsed.source,
    analyzer.semanticTypes(),
    analyzer.semanticMembers(),
    semanticExpressions.types,
    semanticExpressions.members,
    semanticExpressions.owners,
    semanticExpressions.objectPropertyOwners,
    semanticExpressions.bindingEntryOwners,
    semanticExpressions.jsxAttributeOwners,
    semanticExpressions.contexts,
    semanticExpressions.contextMembers,
    extensions.flatMap((extension) => extension.semantic ? [extension.semantic] : []),
    parsed.tokens,
  );
  return {
    hasMain: parsed.program.body.some((statement) => statement.kind === "MainBlock"),
    moduleStartup: moduleStartupCode(parsed.program),
    code,
    sourceMap,
    embeddedModules,
    css,
    styleSegments,
    runtimeModules,
    extensions: extensions.map((extension) => extension.id),
    diagnostics,
    advisories: reportedAdvisories,
    source: parsed.source,
    dependencies: dependenciesOf(parsed.program),
    resources: resourcesOf(parsed.program, extensions),
    moduleInterface: interfaceOf(
      semanticProgram,
      parsed.source.path,
      extensions,
      analyzer.semanticTypes(),
      analyzer.analyzedClasses(),
      analyzer.analyzedNamedTypes(),
      analyzer.analyzedNamedTypeReadonlyFields(),
      analyzer.analyzedNamedTypeBases(),
      analyzer.analyzedGenericTypes(),
    ),
    semanticIndex,
    embeddedJavaScriptTokens: embeddedJavaScriptTokensOf(parsed.program),
    initializationImportReads: analyzer.moduleInitializationImportReads(),
  };
}

/**
 * 结果类型不动点迭代的趟数上限。紧上界是「省略结果标注的数量 + 2」，这个常量只在
 * 那之上再夹一刀，作用是把最坏工作量从「模块规模的平方」压回「模块规模的常数倍」：
 * 每一趟都是全模块重分析。代价是一条超过 254 个互相串联、且都省略结果标注的函数的
 * 模块会被这条预算拦下 —— 那时报的是 VEL2038 而不是猜一个答案。真正的解法是按调用
 * 图的强连通分量分组做局部不动点，只在真递归环里迭代，那需要一份可靠的函数调用图。
 */
const MAX_RESULT_INFERENCE_PASSES = 256;

/** `spanIdentity` 生成的结果键（`start:end`）反解回位置，用来给未收敛的推断定位。 */
function spanOfResultKey(key: string): Span {
  const separator = key.lastIndexOf(":");
  const start = Number.parseInt(key.slice(0, separator), 10);
  const end = Number.parseInt(key.slice(separator + 1), 10);
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : { start: 0, end: 0 };
}

/** 两趟推断之间仍在变化的结果键，按位置排序，所以诊断的落点是确定的。 */
function unsettledResultKeys(
  left: ReadonlyMap<string, ValueType>,
  right: ReadonlyMap<string, ValueType>,
): readonly string[] {
  const unsettled: string[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const before = left.get(key);
    const after = right.get(key);
    if (before === undefined || after === undefined) {
      unsettled.push(key);
      continue;
    }
    // 单键对比借用分析器自己的结果等价判断，避免在这里重写一份类型比较。
    if (!Analyzer.inferredFunctionResultsMatch(new Map([[key, before]]), new Map([[key, after]]))) unsettled.push(key);
  }
  return unsettled.sort((first, second) => {
    const firstSpan = spanOfResultKey(first);
    const secondSpan = spanOfResultKey(second);
    return firstSpan.start - secondSpan.start || firstSpan.end - secondSpan.end || byCodeUnit(first, second);
  });
}

/**
 * AST 的最大节点嵌套深度。依据是实测：真实语料里最深的模块是 13 层，而分析器在
 * 600 层左右耗尽 Node 主线程的栈；256 既远高于任何人写得出的嵌套，又留了一倍以上
 * 的余量给栈更小的宿主（浏览器 worker）。它和解析器的语法深度预算取同一个数，
 * 因为一层语法嵌套至多生成常数层 AST 节点，两道门给出同一条 VEL2008。
 */
const MAX_ANALYSIS_NESTING_DEPTH = 256;

/**
 * 第一个深度超过 `limit` 的 AST 节点的位置，没有则为 null。走的是显式栈而不是
 * 递归，所以这道门自己不会成为下一个栈溢出源；深度只在带 `kind` 的节点上累加，
 * 数组与 span 这类附属对象不计。
 */
function nodeSpanBeyondNestingDepth(root: unknown, limit: number): Span | null {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value: root, depth: 0 }];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    const value = entry.value;
    if (typeof value !== "object" || value === null) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) pending.push({ value: value[index], depth: entry.depth });
      continue;
    }
    const node = typeof (value as { kind?: unknown }).kind === "string";
    const depth = node ? entry.depth + 1 : entry.depth;
    if (node && depth > limit) {
      const span = (value as { span?: Span }).span;
      return span && typeof span.start === "number" && typeof span.end === "number" ? span : { start: 0, end: 0 };
    }
    const children = Object.values(value);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push({ value: children[index], depth });
  }
  return null;
}

/** 结构完整但没有程序的编译结果：下游读到的是一条诊断，而不是一个崩溃。 */
function emptyCompileResult(text: string, options: CompileOptions, reported: Diagnostic): CompileResult {
  const path = options.path ?? "<source>";
  const extensions = normalizedExtensions(options.extensions ?? []);
  const source = new SourceText(path, text);
  const program: Program = { kind: "Program", body: [], span: { start: 0, end: 0 } };
  return {
    hasMain: false,
    moduleStartup: moduleStartupCode(program),
    code: null,
    sourceMap: null,
    embeddedModules: [],
    embeddedJavaScriptTokens: [],
    css: null,
    styleSegments: null,
    runtimeModules: [],
    extensions: extensions.map((extension) => extension.id),
    diagnostics: [reported],
    advisories: [],
    source,
    dependencies: [],
    resources: [],
    moduleInterface: interfaceOf(program, path, extensions),
    semanticIndex: buildSemanticIndex(program, source),
    initializationImportReads: [],
  };
}

function embeddedJavaScriptTokensOf(program: Program): readonly EmbeddedJavaScriptEditorToken[] {
  return program.body
    .flatMap((statement) => statement.kind === "EmbeddedJavaScriptDeclaration" ? statement.editorTokens : [])
    .sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
}

function resourcesOf(program: Program, extensions: readonly CompilerExtension[]): readonly CompilerResourceDependency[] {
  const output: CompilerResourceDependency[] = [];
  const seen = new Set<string>();
  for (const statement of program.body) {
    if (statement.kind !== "ImportDeclaration" || !statement.resource) continue;
    const key = `${statement.resource}\0${statement.source}`;
    seen.add(key);
    output.push({ source: statement.source, kind: statement.resource });
  }
  for (const extension of extensions) {
    for (const resource of extension.inspection?.resources?.(program) ?? []) {
      const key = `${resource.kind}\0${resource.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(resource);
    }
  }
  return output;
}

function parseModule(text: string, path: string, extensions: readonly CompilerExtension[]): { source: SourceText; program: Program; diagnostics: readonly Diagnostic[]; advisories: readonly Advisory[]; suppressions: readonly AdvisorySuppression[]; tokens: readonly Token[] } {
  if (text.length > MAX_VELAR_SOURCE_CODE_UNITS) {
    const source = new SourceText(path, text, false);
    return {
      source,
      program: { kind: "Program", body: [], span: { start: 0, end: 0 } },
      diagnostics: [diagnostic(
        "VEL1003",
        `A VelarScript source module cannot exceed ${MAX_VELAR_SOURCE_CODE_UNITS / 1024 / 1024} MiB`,
        { start: 0, end: Math.min(1, text.length) },
      )],
      advisories: [],
      suppressions: [],
      tokens: [],
    };
  }
  const source = new SourceText(path, text);
  try {
    const lexicalExtensions = extensions.flatMap((extension) => extension.lexical ? [extension.lexical] : []);
    const lexed = new Lexer(text, lexicalExtensions).lex();
    // Guidance diagnostics that recovered as the guided token stream do not
    // suppress parsing; only unrecovered lexical failures gate the parser.
    if (lexed.diagnostics.some((item) => (item.code === "VEL1005" || item.code === "VEL1006") && !item.recovered)) {
      return {
        source,
        program: { kind: "Program", body: [], span: { start: 0, end: text.length } },
        diagnostics: lexed.diagnostics,
        advisories: lexed.advisories,
        suppressions: lexed.suppressions,
        tokens: lexed.tokens,
      };
    }
    const parserExtensions = extensions.filter((extension) => extension.parser);
    if (parserExtensions.length > 1) throw new Error("Only one compiler extension may own syntax parsing");
    const parser = parserExtensions[0]?.parser?.create(lexed.tokens, lexicalExtensions)
      ?? new Parser(lexed.tokens, lexicalExtensions);
    const parsed = parser.parse();
    // A parser cannot recover a token the lexer never produced. Once VEL1001
    // owns an unsupported spelling, later parser reports on that same physical
    // line and after that spelling describe only the hole it left behind. Keep
    // independent earlier and later-line diagnostics, but do not present the
    // recovery cascade as additional mistakes the author has to fix.
    const invalidFromByLine = new Map<number, number>();
    for (const item of lexed.diagnostics) {
      if (item.code !== "VEL1001" || item.message.startsWith("Unexpected UTF-8 BOM")) continue;
      const line = source.location(item.span.start).line;
      invalidFromByLine.set(line, Math.min(invalidFromByLine.get(line) ?? item.span.start, item.span.start));
    }
    const parserDiagnostics = parsed.diagnostics.filter((item) => {
      const invalidFrom = invalidFromByLine.get(source.location(item.span.start).line);
      return invalidFrom === undefined || item.span.start < invalidFrom;
    });
    return {
      source,
      program: parsed.program,
      diagnostics: [...lexed.diagnostics, ...parserDiagnostics],
      advisories: [...lexed.advisories, ...parsed.advisories],
      // D103: a region an extension scanner claimed whole is lexed again by the
      // parser, so the suppressions its comments carry arrive from there. Both
      // producers are read for the same reason both diagnostic channels are.
      suppressions: [...lexed.suppressions, ...parsed.suppressions],
      tokens: lexed.tokens,
    };
  } catch (error) {
    // 只有解析器自己的深度预算哨兵才是这条诊断的来源。栈溢出不再在这里被翻译成
    // 「你的源码太复杂」：它交给 `compile` 的兜底报成内部编译器错误。
    if (!isParserComplexityFailure(error)) throw error;
    return {
      source,
      program: { kind: "Program", body: [], span: { start: 0, end: 0 } },
      diagnostics: [diagnostic("VEL2008", "VelarScript source nesting is too complex to parse safely", { start: 0, end: Math.min(1, text.length) })],
      advisories: [],
      suppressions: [],
      tokens: [],
    };
  }
}

/**
 * 消息文本是给人看的，不是接口的一部分，所以这个判据只用来给**内部错误**分类：
 * 认出来就报 VEL9001 并请求上报，认不出来就原样抛出。用户可见的「嵌套过深」由
 * 显式深度预算决定，不再依赖任何引擎的英文措辞。
 */
function isJavaScriptStackOverflow(error: unknown): boolean {
  return error instanceof RangeError && /Maximum call stack size exceeded|too much recursion/iu.test(error.message);
}

function normalizedExtensions(extensions: readonly CompilerExtension[]): readonly CompilerExtension[] {
  const seen = new Set<string>();
  const capabilities = new Set<string>();
  const primitiveOwners = new Map<string, string>();
  const globalOwners = new Map<string, string>();
  const extensionReservedBindings = new Set(extensions.flatMap((extension) => [...extension.analysis?.reservedBindings ?? []]));
  for (const extension of extensions) {
    if (!extension.id || seen.has(extension.id)) throw new Error(`Compiler extension '${extension.id}' is invalid or duplicated`);
    seen.add(extension.id);
    for (const capability of extension.capabilities ?? []) {
      if (!/^[a-z][a-z0-9-]*$/u.test(capability) || capabilities.has(capability)) {
        throw new Error(`Compiler capability '${capability}' is invalid or has more than one owner`);
      }
      capabilities.add(capability);
    }
    for (const name of extension.analysis?.primitiveTypes ?? []) {
      const owner = primitiveOwners.get(name);
      if (isCorePrimitiveName(name)) throw new Error(`Compiler extension '${extension.id}' cannot replace Core primitive '${name}'`);
      if (bindingNameRestriction(name, extensionReservedBindings) || owner) {
        throw new Error(`Compiler primitive '${name}' is invalid or has more than one owner${owner ? ` (${owner}, ${extension.id})` : ""}`);
      }
      primitiveOwners.set(name, extension.id);
    }
    for (const name of extension.analysis?.globals?.keys() ?? []) {
      const restriction = bindingNameRestriction(name);
      if (restriction === "core") throw new Error(`Compiler extension '${extension.id}' cannot replace reserved Core binding '${name}'`);
      if (restriction) throw new Error(`Compiler extension '${extension.id}' declares invalid global '${name}'`);
      const owner = globalOwners.get(name);
      if (owner) throw new Error(`Compiler global '${name}' has more than one owner (${owner}, ${extension.id})`);
      globalOwners.set(name, extension.id);
    }
  }

  const parents = new Map<string, Set<string>>();
  for (const extension of extensions) {
    for (const [name, values] of extension.analysis?.primitiveParents ?? []) {
      if (primitiveOwners.get(name) !== extension.id) {
        throw new Error(`Compiler extension '${extension.id}' cannot define parents for primitive '${name}' that it does not own`);
      }
      const collected = parents.get(name) ?? new Set<string>();
      for (const parent of values) {
        if (!primitiveOwners.has(parent)) throw new Error(`Compiler primitive '${name}' has unknown parent '${parent}'`);
        collected.add(parent);
      }
      parents.set(name, collected);
    }
    for (const [name, fields] of extension.analysis?.primitiveMutableFields ?? []) {
      if (primitiveOwners.get(name) !== extension.id) {
        throw new Error(`Compiler extension '${extension.id}' cannot make fields writable on primitive '${name}' that it does not own`);
      }
      for (const field of fields) {
        if (memberNameRestriction(field, "data")) throw new Error(`Compiler primitive '${name}' has invalid writable field '${field}'`);
      }
    }
  }

  const completed = new Set<string>();
  const active = new Set<string>();
  const visit = (name: string): void => {
    if (completed.has(name)) return;
    if (active.has(name)) throw new Error(`Compiler primitive inheritance contains a cycle at '${name}'`);
    active.add(name);
    for (const parent of parents.get(name) ?? []) visit(parent);
    active.delete(name);
    completed.add(name);
  };
  for (const name of primitiveOwners.keys()) visit(name);
  return extensions;
}

// No extension list: dependency discovery asks the AST and nothing else.
function dependenciesOf(program: Program): readonly ModuleDependency[] {
  const externSources = new Set(program.body
    .filter((statement) => statement.kind === "ExternModuleDeclaration")
    .map((statement) => statement.source));
  const dependencies: ModuleDependency[] = program.body
    .filter((statement) => statement.kind === "ImportDeclaration")
    .map((statement) => ({
      source: statement.source,
      span: statement.sourceSpan,
      javascript: statement.javascript || statement.resource !== undefined,
      unsafe: statement.unsafe,
      dynamic: false,
      ...(statement.resource ? { resource: statement.resource } : {}),
      ...(statement.javascript && !statement.unsafe && externSources.has(statement.source) ? { externOwned: true } : {}),
      specifiers: statement.specifiers.map((specifier) => ({
        imported: specifier.imported,
        local: specifier.local,
        namespace: specifier.namespace,
      })),
    }));
  for (const statement of program.body) {
    if (statement.kind !== "ReExportDeclaration") continue;
    dependencies.push({
      source: statement.source,
      span: statement.sourceSpan,
      javascript: false,
      unsafe: false,
      dynamic: false,
      reExport: true,
      specifiers: statement.specifiers.map((specifier) => ({
        imported: specifier.imported,
        local: specifier.exported,
        namespace: false,
      })),
    });
  }

  // Inline JavaScript is still part of the project's JavaScript dependency
  // graph. The source spelling no longer decides whether check can see it:
  // Acorn's module parse above supplies the same literal specifiers that the
  // sibling module will execute after emission.
  for (const statement of program.body) {
    if (statement.kind !== "EmbeddedJavaScriptDeclaration") continue;
    for (const dependency of statement.dependencies) {
      dependencies.push({
        source: dependency.source,
        span: dependency.span,
        javascript: true,
        unsafe: statement.unsafe,
        dynamic: dependency.dynamic,
        specifiers: [],
      });
    }
  }

  // Dynamic imports are found by walking the AST structurally rather than by
  // a second switch over the statement and expression kinds this function
  // remembers. A-010: that switch existed, and it had no case for `try`,
  // `using`, or `test "…":`, and descended into a class only through its
  // fields, `constructor:` and methods — so a `import("./dep.vel")` in a
  // getter, a `@dispose:`, or a `@iterate:` left the module out of the graph
  // while `check` reported success. `@iterate:` was missing from the day D68
  // added it: a hand-kept copy of the AST drifts the moment the AST grows,
  // and every future container would have drifted the same way.
  const dynamicSources = new Set<string>();
  for (const expression of astNodesOfKind<DynamicImportExpression>(program, "DynamicImportExpression")) {
    if (dynamicSources.has(expression.source)) continue;
    dynamicSources.add(expression.source);
    dependencies.push({
      source: expression.source,
      span: expression.span,
      javascript: false,
      unsafe: false,
      dynamic: true,
      specifiers: [],
    });
  }
  return dependencies;
}

function interfaceOf(
  program: Program,
  path: string,
  extensions: readonly CompilerExtension[],
  analyzedBindings: ReadonlyMap<string, ValueType> = new Map(),
  analyzedClasses: ReadonlyMap<string, ClassInfo> = new Map(),
  analyzedNamedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  analyzedNamedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  analyzedNamedTypeBases: ReadonlyMap<string, ValueType> = new Map(),
  analyzedGenericTypes: ReadonlyMap<string, GenericTypeInfo> = new Map(),
): ModuleInterface {
  const classIdentities = new Map<string, string>([["Error", "Error"]]);
  for (const statement of program.body) {
    if (statement.kind === "ClassDeclaration") classIdentities.set(statement.name, `velar:${path}#${statement.name}`);
  }
  // Extern classes are nominal per JavaScript source and class name, so
  // signatures that mention them stay nominal across module interfaces. A
  // Velar class declaration owns its bare name if both exist in one module.
  for (const statement of program.body) {
    if (statement.kind !== "ExternModuleDeclaration") continue;
    for (const declaration of statement.classes) {
      if (!classIdentities.has(declaration.name)) classIdentities.set(declaration.name, `js:${statement.source}#${declaration.name}`);
    }
  }
  const enumNames = new Map(program.body
    .filter((statement) => statement.kind === "EnumDeclaration")
    .map((statement) => [statement.name, {
      identity: `${path}#enum:${statement.name}`,
      members: new Set(statement.members.map((member) => member.name)),
      wireValues: new Map(statement.members.map((member) => [member.name, member.value])),
    }] satisfies [string, EnumInfo]));
  const namedTypeIdentities = new Map(program.body
    .filter((statement) => statement.kind === "TypeDeclaration")
    .map((statement) => [statement.name, `velar:${path}#type:${statement.name}`] satisfies [string, string]));
  const aliasDeclarations = new Map<string, Extract<Statement, { kind: "TypeAliasDeclaration" }>>();
  for (const statement of program.body) {
    if (statement.kind === "TypeAliasDeclaration") aliasDeclarations.set(statement.name, statement);
  }
  const analysisExtensions = extensions.flatMap((extension) => extension.analysis ? [extension.analysis] : []);
  const directAwaitExpression = (
    expression: Expression,
    contains: (expression: Expression) => boolean,
  ): boolean | undefined => {
    for (const extension of analysisExtensions) {
      const result = extension.directAwaitExpression?.(expression, contains);
      if (result !== undefined) return result;
    }
    return undefined;
  };
  const directAwaitStatement = (
    statement: Statement,
    containsExpression: (expression: Expression) => boolean,
    containsBlock: (statements: readonly Statement[]) => boolean,
  ): boolean | undefined => {
    for (const extension of analysisExtensions) {
      const result = extension.directAwaitStatement?.(statement, containsExpression, containsBlock);
      if (result !== undefined) return result;
    }
    return undefined;
  };
  const resolveRaw = (reference: TypeReference): ValueType => resolveTypeReference(reference, (syntax, nested) => {
    for (const extension of analysisExtensions) {
      const resolved = extension.resolveTypeSyntax?.(syntax, nested);
      if (resolved) return resolved;
    }
    return undefined;
  });
  const aliasCache = new Map<string, ValueType>();
  const expandAliases = (type: ValueType, seen: ReadonlySet<string> = new Set()): ValueType => {
    if (type.kind === "named" && aliasDeclarations.has(type.name)) {
      if (seen.has(type.name)) return unknownType;
      const cached = aliasCache.get(type.name);
      if (cached) return type.readonlyView ? readonlyViewOf(cached) : cached;
      const declaration = aliasDeclarations.get(type.name)!;
      const expanded = expandAliases(resolveRaw(declaration.target), new Set([...seen, type.name]));
      aliasCache.set(type.name, expanded);
      return type.readonlyView ? readonlyViewOf(expanded) : expanded;
    }
    // D55 rule 121: an alias inside a type argument is transparent here too,
    // so the interface publishes the same instantiation identity the analyzer
    // computed for the body.
    if (type.kind === "named" && type.application) {
      return { ...type, application: { ...type.application, arguments: type.application.arguments.map((argument) => expandAliases(argument, seen)) } };
    }
    if (type.kind === "optional") return optionalOf(expandAliases(type.inner, seen));
    if (type.kind === "list") return { ...type, element: expandAliases(type.element, seen) };
    if (type.kind === "set") return { ...type, element: expandAliases(type.element, seen) };
    if (type.kind === "map") return { ...type, key: expandAliases(type.key, seen), value: expandAliases(type.value, seen) };
    if (type.kind === "record") return { ...type, value: expandAliases(type.value, seen) };
    if (type.kind === "promise") return { kind: "promise", value: expandAliases(type.value, seen) };
    if (type.kind === "runtimeType") return { kind: "runtimeType", value: expandAliases(type.value, seen) };
    if (type.kind === "typeObject") return type.value ? { ...type, value: expandAliases(type.value, seen) } : type;
    if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, expandAliases(value, seen)])) };
    if (type.kind === "extension") {
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, expandAliases(value, seen)])),
        arguments: type.arguments.map((argument) => expandAliases(argument, seen)),
      };
    }
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => expandAliases(parameter, seen)),
      ...(type.rest ? { rest: expandAliases(type.rest, seen) } : {}),
      result: expandAliases(type.result, seen),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => expandAliases(member, seen)) };
    return type;
  };
  const resolve = (reference: TypeReference | null): ValueType => resolveNominals(expandAliases(reference ? resolveRaw(reference) : unknownType), classIdentities, enumNames, namedTypeIdentities);
  const resolveAnalyzed = (type: ValueType): ValueType => resolveNominals(expandAliases(type), classIdentities, enumNames, namedTypeIdentities);
  const resolvedAnalyzedBindings = new Map([...analyzedBindings]
    .map(([name, type]) => [name, resolveNominals(expandAliases(type), classIdentities, enumNames, namedTypeIdentities)]));
  const namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  const namedTypeReadonlyFields = new Map<string, ReadonlySet<string>>();
  const namedTypeBases = new Map<string, ValueType>();
  const genericTypes = new Map<string, GenericTypeInfo>();
  const typeAliases = new Map<string, ValueType>();
  const enums = new Map<string, EnumInfo>();
  const classes = new Map<string, ClassInfo>();
  const exports = new Map<string, ValueType>();
  const hoistedExports = new Set<string>();
  const mutableExports = new Set<string>();
  const reactiveExports = new Map<string, "state">();
  const inspectionExtensions = extensions.flatMap((extension) => extension.inspection ? [extension.inspection] : []);
  const tests: ModuleTest[] = [];
  const extensionExports = new Map(extensions.map((extension) => [extension.id, new Map<string, unknown>()] as const));
  const extensionData = new Map<string, unknown>();
  for (const extension of extensions) {
    const data = extension.inspection?.moduleData?.(program, path);
    if (data !== undefined) extensionData.set(extension.id, data);
    const context: CompilerInterfaceContext = {
      exports,
      reactiveExports,
      extensionExports: extensionExports.get(extension.id)!,
      resolve,
      inferPublicExpression: (expression: Expression) => inferPublicExpression(expression, inspectionExtensions),
      bindingType: (name: string, spanStart: number) => resolvedAnalyzedBindings.get(`${spanStart}:${name}`) ?? null,
      unresolvedInferredResult: inferredResultPlaceholderType,
    };
    const annotations = extension.inspection?.exportAnnotations?.(program, context);
    if (annotations) {
      const values = extensionExports.get(extension.id)!;
      for (const [name, value] of annotations) values.set(name, value);
    }
  }

  for (const [name, declaration] of aliasDeclarations) typeAliases.set(name, resolve(declaration.target));

  for (const statement of program.body) {
    if (statement.kind === "TypeDeclaration") {
      const readonlyFields = new Set(analyzedNamedTypeReadonlyFields.get(statement.name)
        ?? statement.fields.filter((field) => field.readonly).map((field) => field.name));
      if (statement.base) {
        namedTypeBases.set(statement.name, resolveAnalyzed(
          analyzedNamedTypeBases.get(statement.name) ?? resolve(statement.base),
        ));
      }
      // D55 rule 120: a generic record crosses the boundary as a template. Its
      // field table still has the `parameter` kinds in it, which is what lets a
      // dependent instantiate it with an argument this module never named.
      if (statement.typeParameters?.length) {
        const frame = new Map<string, ValueType>(statement.typeParameters
          .map((parameter, index) => [parameter.name, { kind: "parameter", name: parameter.name, index }] as const));
        const analyzed = analyzedGenericTypes.get(statement.name);
        genericTypes.set(statement.name, {
          identity: namedTypeIdentities.get(statement.name)!,
          name: statement.name,
          parameterNames: statement.typeParameters.map((parameter) => parameter.name),
          parameterBounds: statement.typeParameters.map((parameter) =>
            parameter.bound && isTypeParameterBound(parameter.bound) ? parameter.bound : null),
          fields: analyzed
            ? new Map([...analyzed.fields].map(([name, type]) => [name, resolveAnalyzed(type)]))
            : new Map(statement.fields.map((field) => [field.name, bindNamedTypeParameters(resolve(field.type), frame)])),
          ...(readonlyFields.size > 0 ? { readonlyFields } : {}),
        });
        continue;
      }
      const analyzed = analyzedNamedTypes.get(statement.name);
      namedTypes.set(statement.name, analyzed
        ? new Map([...analyzed].map(([name, type]) => [name, resolveAnalyzed(type)]))
        : new Map(statement.fields.map((field) => [field.name, resolve(field.type)])));
      if (readonlyFields.size > 0) namedTypeReadonlyFields.set(statement.name, readonlyFields);
    } else if (statement.kind === "EnumDeclaration") {
      enums.set(statement.name, enumNames.get(statement.name)!);
    } else if (statement.kind === "ClassDeclaration") {
      const fields = new Map([
        ...statement.parameters
          .filter((parameter) => parameter.binding && !parameter.private)
          .map((parameter) => [parameter.name, { mutable: parameter.binding === "let", type: resolve(parameter.type) }] as const),
        ...statement.fields
          .filter((field) => !field.static && !field.private)
          .map((field) => [field.name, { mutable: field.binding === "let", type: resolve(field.type) }] as const),
        ...statement.getters
          .filter((getter) => !getter.static && !getter.private)
          .map((getter) => [getter.name, { mutable: false, type: resolve(getter.returnType) }] as const),
      ]);
      const staticFields = new Map(statement.fields
        .filter((field) => field.static && !field.private)
        .map((field) => [field.name, { mutable: field.binding === "let", type: resolve(field.type) }] as const));
      for (const getter of statement.getters.filter((candidate) => candidate.static && !candidate.private)) {
        staticFields.set(getter.name, { mutable: false, type: resolve(getter.returnType) });
      }
      const methods = new Map(statement.methods.filter((method) => !method.static && !method.private).map((method) => [method.name, functionSignature(method, resolve)]));
      const staticMethods = new Map(statement.methods.filter((method) => method.static && !method.private).map((method) => [method.name, functionSignature(method, resolve)]));
      const identity = classIdentities.get(statement.name)!;
      classes.set(statement.name, {
        identity,
        // D43 item 69: the release contract crosses the module boundary with
        // the class, so an imported handle stays usable with `using`.
        ...(statement.dispose ? {
          dispose: blockContainsDirectAwait(statement.dispose.body, directAwaitExpression, directAwaitStatement) ? "async" : "sync",
        } as const : {}),
        parameters: statement.parameters.map((parameter) => resolve(parameter.type)),
        parameterNames: statement.parameters.map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.defaultValue).length,
        base: statement.base ? classIdentities.get(statement.base.name) ?? statement.base.name : null,
        abstract: statement.abstract,
        fields,
        getters: new Set(statement.getters.filter((getter) => !getter.static && !getter.private).map((getter) => getter.name)),
        abstractGetters: new Set(statement.getters.filter((getter) => getter.abstract && !getter.private).map((getter) => getter.name)),
        methods,
        abstractMethods: new Set(statement.methods.filter((method) => method.abstract && !method.private).map((method) => method.name)),
        staticFields,
        staticGetters: new Set(statement.getters.filter((getter) => getter.static && !getter.private).map((getter) => getter.name)),
        staticMethods,
      });
      const analyzed = analyzedClasses.get(statement.name);
      if (analyzed) {
        const analyzedBaseApplication = analyzed.baseApplication
          ? {
            ...analyzed.baseApplication,
            declaration: classIdentities.get(analyzed.baseApplication.declaration) ?? analyzed.baseApplication.declaration,
            arguments: analyzed.baseApplication.arguments.map(resolveAnalyzed),
          }
          : undefined;
        classes.set(statement.name, {
          ...analyzed,
          identity,
          parameters: analyzed.parameters.map(resolveAnalyzed),
          ...(analyzed.constructorRest ? { constructorRest: resolveAnalyzed(analyzed.constructorRest) } : {}),
          // D68 rule 177: the iteration contract crosses the module boundary
          // with the class, so an imported Bag iterates in the importing module
          // exactly as it does in its own.
          ...(analyzed.iterate ? { iterate: resolveAnalyzed(analyzed.iterate) } : {}),
          // D55 rule 120 layer two: a generic base crosses as its parts, and its
          // key is recomputed from them — `Stack<number>` is a function of the
          // declaration identity and the arguments, not a name any table holds.
          ...(analyzedBaseApplication ? { baseApplication: analyzedBaseApplication } : {}),
          base: analyzedBaseApplication
            ? genericApplicationIdentity(analyzedBaseApplication.declaration, analyzedBaseApplication.arguments)
            : analyzed.base ? classIdentities.get(analyzed.base) ?? analyzed.base : null,
          fields: new Map([...analyzed.fields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
          methods: new Map([...analyzed.methods].map(([name, type]) => [name, resolveAnalyzed(type)])),
          staticFields: new Map([...analyzed.staticFields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
          staticMethods: new Map([...analyzed.staticMethods].map(([name, type]) => [name, resolveAnalyzed(type)])),
        });
      }
    } else if (statement.kind === "ExternModuleDeclaration") {
      // Extern classes travel with the interface under their identity so a
      // dependent module that declares the same class for the same source can
      // verify that both declarations agree on one contract.
      for (const declaration of statement.classes) {
        const identity = `js:${statement.source}#${declaration.name}`;
        const analyzed = analyzedClasses.get(identity);
        if (analyzed) {
          classes.set(identity, {
            ...analyzed,
            identity,
            parameters: analyzed.parameters.map(resolveAnalyzed),
            ...(analyzed.constructorRest ? { constructorRest: resolveAnalyzed(analyzed.constructorRest) } : {}),
            fields: new Map([...analyzed.fields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
            methods: new Map([...analyzed.methods].map(([name, type]) => [name, resolveAnalyzed(type)])),
            staticFields: new Map([...analyzed.staticFields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
            staticMethods: new Map([...analyzed.staticMethods].map(([name, type]) => [name, resolveAnalyzed(type)])),
          });
          continue;
        }
        const fields = new Map<string, ClassField>();
        const staticFields = new Map<string, ClassField>();
        for (const parameter of declaration.parameters) {
          if (parameter.binding) fields.set(parameter.name, { mutable: parameter.binding === "let", type: resolve(parameter.type) });
        }
        for (const field of declaration.fields) {
          (field.static ? staticFields : fields).set(field.name, { mutable: field.mutable, type: resolve(field.type) });
        }
        const getters = new Set<string>();
        const staticGetters = new Set<string>();
        for (const getter of declaration.getters) {
          (getter.static ? staticFields : fields).set(getter.name, { mutable: false, type: resolve(getter.type) });
          (getter.static ? staticGetters : getters).add(getter.name);
        }
        const methods = new Map<string, ValueType>();
        const staticMethods = new Map<string, ValueType>();
        for (const method of declaration.methods) {
          (method.static ? staticMethods : methods).set(method.name, functionSignature(method, resolve));
        }
        const rest = declaration.parameters.find((parameter) => parameter.rest);
        classes.set(identity, {
          identity,
          parameters: declaration.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolve(parameter.type)),
          requiredParameters: declaration.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
          ...(rest ? { constructorRest: resolve(rest.type) } : {}),
          base: declaration.base ? `js:${statement.source}#${declaration.base}` : null,
          abstract: false,
          fields,
          getters,
          abstractGetters: new Set(),
          methods,
          abstractMethods: new Set(),
          staticFields,
          staticGetters,
          staticMethods,
        });
      }
    } else if (statement.kind === "TestDeclaration") {
      tests.push({ name: testFunctionName(statement), title: statement.title });
    }
  }

  for (const statement of program.body) {
    if (!("exported" in statement) || !statement.exported) continue;
    if (statement.kind === "TypeDeclaration") {
      // D55 rule 126: a generic record's export is the instantiation factory,
      // not a Type object — it has no `is` of its own, so it carries no value
      // shape and the analyzer refuses to read it as one.
      exports.set(statement.name, statement.typeParameters?.length
        ? { kind: "typeObject", name: statement.name }
        : {
          kind: "typeObject",
          name: statement.name,
          value: {
            kind: "named",
            name: statement.name,
            identity: namedTypeIdentities.get(statement.name)!,
          },
        });
    } else if (statement.kind === "TypeAliasDeclaration") {
      exports.set(statement.name, { kind: "typeObject", name: statement.name, value: typeAliases.get(statement.name)! });
    } else if (statement.kind === "EnumDeclaration") {
      const info = enums.get(statement.name)!;
      exports.set(statement.name, { kind: "enumObject", name: statement.name, identity: info.identity, members: info.members });
    } else if (statement.kind === "ClassDeclaration") {
      exports.set(statement.name, { kind: "classConstructor", name: statement.name, identity: classIdentities.get(statement.name)! });
    } else if (statement.kind === "FunctionDeclaration") {
      exports.set(statement.name, resolvedAnalyzedBindings.get(`${statement.span.start}:${statement.name}`) ?? functionSignature(statement, resolve));
      // `def` emits a JavaScript function declaration, which the host
      // initializes at link time; `class`, `enum`, and `const`/`let` all emit
      // bindings that stay in their temporal dead zone until the module body
      // reaches them.
      hoistedExports.add(statement.name);
    } else if (statement.kind === "VariableDeclaration") {
      exportPattern(
        statement.pattern,
        statement.type ? resolve(statement.type) : inferPublicExpression(statement.initializer, inspectionExtensions),
        exports,
        mutableExports,
        statement.binding === "let",
        namedTypes,
        resolvedAnalyzedBindings,
      );
    } else {
      for (const extension of extensions) {
        if (!extension.inspection) continue;
        const context = {
          exports,
          reactiveExports,
          extensionExports: extensionExports.get(extension.id)!,
          resolve,
          inferPublicExpression: (expression: Expression) => inferPublicExpression(expression, inspectionExtensions),
          bindingType: (name: string, spanStart: number) => resolvedAnalyzedBindings.get(`${spanStart}:${name}`) ?? null,
          unresolvedInferredResult: inferredResultPlaceholderType,
        };
        if (extension.inspection.contributeInterface?.(statement, context)) break;
      }
    }
  }
  const reExports = new Map<string, { readonly source: string; readonly imported: string }>();
  for (const statement of program.body) {
    if (statement.kind !== "ReExportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      reExports.set(specifier.exported, { source: statement.source, imported: specifier.imported });
    }
  }

  return {
    exports,
    hoistedExports,
    mutableExports,
    reactiveExports,
    reExports,
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    ...(namedTypeBases.size > 0 ? { namedTypeBases } : {}),
    ...(genericTypes.size > 0 ? { genericTypes } : {}),
    typeAliases,
    enums,
    classes,
    tests,
    extensionExports: new Map([...extensionExports].filter(([, values]) => values.size > 0)),
    extensionData,
  };
}

function functionSignature(
  statement: Pick<FunctionDeclaration, "typeParameters" | "parameters" | "returnType" | "asynchronous">,
  resolve: (reference: TypeReference | null) => ValueType,
): ValueType {
  const frame = new Map<string, ValueType>();
  // D41 item 61 risk 4: this is the cross-module export interface. A bound
  // dropped here would silently disappear from every imported generic.
  const bounds: (TypeParameterBound | null)[] = [];
  for (const declaration of statement.typeParameters ?? []) {
    if (frame.has(declaration.name)) continue;
    frame.set(declaration.name, { kind: "parameter", name: declaration.name, index: frame.size });
    bounds.push(declaration.bound && isTypeParameterBound(declaration.bound) ? declaration.bound : null);
  }
  const boundVector = bounds.some((bound) => bound !== null) ? bounds : null;
  const resolveBound = (reference: TypeReference | null): ValueType =>
    frame.size === 0 ? resolve(reference) : bindNamedTypeParameters(resolve(reference), frame);
  const result = statement.returnType
    ? resolveBound(statement.returnType)
    : "abstract" in statement && statement.abstract === true ? invalidType : inferredResultPlaceholderType;
  const rest = statement.parameters.find((parameter) => parameter.rest);
  return {
    kind: "function",
    ...(frame.size > 0 ? { typeParameterNames: [...frame.keys()] } : {}),
    ...(frame.size > 0 && boundVector ? { typeParameterBounds: boundVector } : {}),
    parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolveBound(parameter.type)),
    parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
    requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
    ...(rest ? { rest: resolveBound(rest.type) } : {}),
    result: statement.asynchronous ? { kind: "promise", value: resolvedAsyncType(result) } : result,
  };
}

function resolveNominals(
  type: ValueType,
  classIdentities: ReadonlyMap<string, string>,
  enumNames: ReadonlyMap<string, EnumInfo>,
  namedTypeIdentities: ReadonlyMap<string, string>,
): ValueType {
  // D55 rule 121: the interface is where a module's local names become the
  // identities its dependents see, and an application has to make that crossing
  // whole — the declaration *and* every argument — or the two sides of the
  // boundary would compute two different instantiation identities for one type.
  if (type.kind === "named" && type.application) {
    const arguments_ = type.application.arguments.map((argument) => resolveNominals(argument, classIdentities, enumNames, namedTypeIdentities));
    const declaration = namedTypeIdentities.get(type.application.name) ?? type.application.declaration;
    return genericApplicationType(declaration, type.application.name, arguments_, type.readonlyView === true);
  }
  // D55 rule 120 layer two: a class application makes the same crossing a
  // record application makes — declaration identity and every argument — so the
  // two sides of the boundary compute one instantiation identity for it.
  if (type.kind === "class" && type.application) {
    const arguments_ = type.application.arguments.map((argument) => resolveNominals(argument, classIdentities, enumNames, namedTypeIdentities));
    const declaration = classIdentities.get(type.application.name) ?? type.application.declaration;
    return classApplicationType(declaration, type.application.name, arguments_);
  }
  if (type.kind === "named" && classIdentities.has(type.name)) {
    const identity = classIdentities.get(type.name)!;
    return {
      kind: "class",
      name: type.name,
      ...(identity === type.name ? {} : { identity }),
    };
  }
  if (type.kind === "named" && enumNames.has(type.name)) return { kind: "enum", name: type.name, identity: enumNames.get(type.name)!.identity };
  if (type.kind === "named" && namedTypeIdentities.has(type.name)) {
    return { ...type, identity: namedTypeIdentities.get(type.name)! };
  }
  if ((type.kind === "class" || type.kind === "classConstructor") && classIdentities.has(type.name)
    && (!type.identity || type.identity === type.name)) {
    return { ...type, identity: classIdentities.get(type.name)! };
  }
  if ((type.kind === "enum" || type.kind === "enumMember" || type.kind === "enumObject") && enumNames.has(type.name)
    && type.identity === type.name) {
    return { ...type, identity: enumNames.get(type.name)!.identity };
  }
  if (type.kind === "optional") return optionalOf(resolveNominals(type.inner, classIdentities, enumNames, namedTypeIdentities));
  if (type.kind === "list") return { ...type, element: resolveNominals(type.element, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "set") return { ...type, element: resolveNominals(type.element, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "map") return { ...type, key: resolveNominals(type.key, classIdentities, enumNames, namedTypeIdentities), value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "record") return { ...type, value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "promise") return { kind: "promise", value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "runtimeType") return { kind: "runtimeType", value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "typeObject") return type.value
    ? { ...type, value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) }
    : type;
  if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, resolveNominals(value, classIdentities, enumNames, namedTypeIdentities)])) };
  if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
    ...type,
    parameters: type.parameters.map((parameter) => resolveNominals(parameter, classIdentities, enumNames, namedTypeIdentities)),
    ...(type.rest ? { rest: resolveNominals(type.rest, classIdentities, enumNames, namedTypeIdentities) } : {}),
    result: resolveNominals(type.result, classIdentities, enumNames, namedTypeIdentities),
  };
  if (type.kind === "union") return { kind: "union", members: type.members.map((member) => resolveNominals(member, classIdentities, enumNames, namedTypeIdentities)) };
  if (type.kind === "extension") return {
    ...type,
    properties: new Map([...type.properties].map(([name, value]) => [name, resolveNominals(value, classIdentities, enumNames, namedTypeIdentities)])),
    arguments: type.arguments.map((argument) => resolveNominals(argument, classIdentities, enumNames, namedTypeIdentities)),
  };
  return type;
}

function inferPublicExpression(expression: Expression, extensions: readonly NonNullable<CompilerExtension["inspection"]>[]): ValueType {
  for (const extension of extensions) {
    const inferred = extension.inferPublicExpression?.(expression);
    if (inferred) return inferred;
  }
  switch (expression.kind) {
    case "LiteralExpression":
      return expression.value === null ? nullType : typeof expression.value === "string" ? stringType : typeof expression.value === "number" ? numberType : boolType;
    case "FStringExpression":
      return stringType;
    case "ListExpression": {
      let element = unknownType;
      for (const item of expression.elements) {
        const type = inferPublicExpression(item.kind === "SpreadExpression" ? item.value : item, extensions);
        element = mergeTypes(element, item.kind === "SpreadExpression" && type.kind === "list" ? type.element : type);
      }
      return { kind: "list", element };
    }
    case "ObjectExpression": {
      const fields = new Map<string, ValueType>();
      const optionalFields = new Set<string>();
      for (const property of expression.properties) {
        if (property.kind === "ObjectProperty") {
          fields.set(property.name, inferPublicExpression(property.value, extensions));
          optionalFields.delete(property.name);
        }
        else {
          const spread = inferPublicExpression(property.value, extensions);
          if (spread.kind === "object") for (const [name, type] of spread.fields) {
            const alreadyRequired = fields.has(name) && !optionalFields.has(name);
            fields.set(name, type);
            if (!alreadyRequired && spread.optionalFields?.has(name)) optionalFields.add(name);
            else optionalFields.delete(name);
          }
        }
      }
      return { kind: "object", fields, ...(optionalFields.size > 0 ? { optionalFields } : {}) };
    }
    case "SpreadExpression":
      return inferPublicExpression(expression.value, extensions);
    default:
      return unknownType;
  }
}

function exportPattern(
  pattern: BindingPattern,
  type: ValueType,
  exports: Map<string, ValueType>,
  mutableExports: Set<string>,
  mutable: boolean,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>>,
  analyzedBindings: ReadonlyMap<string, ValueType> = new Map(),
): void {
  if (pattern.kind === "NameBindingPattern") {
    exports.set(pattern.name, analyzedBindings.get(`${pattern.span.start}:${pattern.name}`) ?? type);
    if (mutable) mutableExports.add(pattern.name);
    return;
  }
  if (pattern.kind === "ListBindingPattern") {
    const element = type.kind === "list" ? type.element : unknownType;
    for (const child of pattern.elements) if (child) {
      exportPattern(child, element, exports, mutableExports, mutable, namedTypes, analyzedBindings);
    }
    if (pattern.rest) exports.set(
      pattern.rest.name,
      analyzedBindings.get(`${pattern.rest.span.start}:${pattern.rest.name}`) ?? { kind: "list", element },
    );
    if (pattern.rest && mutable) mutableExports.add(pattern.rest.name);
    return;
  }
  const fields = type.kind === "object" ? type.fields : type.kind === "named" ? namedTypes.get(type.name) : null;
  const selected = new Set(pattern.entries.map((entry) => entry.property));
  for (const entry of pattern.entries) {
    const field = fields?.get(entry.property) ?? unknownType;
    exportPattern(
      entry.pattern,
      type.kind === "object" && type.optionalFields?.has(entry.property) ? optionalOf(field) : field,
      exports,
      mutableExports,
      mutable,
      namedTypes,
      analyzedBindings,
    );
  }
  if (pattern.rest) {
    const optionalFields = type.kind === "object"
      ? new Set([...type.optionalFields ?? []].filter((name) => !selected.has(name)))
      : new Set<string>();
    exports.set(pattern.rest.name, analyzedBindings.get(`${pattern.rest.span.start}:${pattern.rest.name}`) ?? {
      kind: "object",
      fields: new Map([...(fields ?? [])].filter(([name]) => !selected.has(name))),
      ...(optionalFields.size > 0 ? { optionalFields } : {}),
    });
    if (mutable) mutableExports.add(pattern.rest.name);
  }
}
