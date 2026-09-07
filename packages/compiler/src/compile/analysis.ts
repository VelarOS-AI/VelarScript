/**
 * The analysis phase of one compile: the context a module is analyzed in, the
 * analyzer that walks it, and the fixed point that settles the result types an
 * author omitted before the one authoritative pass runs.
 *
 * D115 §三: `index.ts` is the facade that composes a compile's phases; the
 * phase that owns the passes is read here, next to the budget that bounds them.
 * Nothing in this module names `CompileOptions`: it declares the face it reads
 * instead, which is what keeps it out of the package's import ring.
 */
import { Analyzer, type AnalysisContext } from "../analyzer.ts";
import type { Program } from "../ast.ts";
import { diagnostic, type Advisory, type Diagnostic } from "../diagnostic.ts";
import type { CompilerExtension } from "../extension.ts";
import type { SourceText, Span } from "../source.ts";
import { byCodeUnit } from "../stable-order.ts";
import { type ValueType } from "../types.ts";

/**
 * What the analysis phase reads from a compile's options, and nothing more.
 * `CompileOptions` satisfies it structurally.
 */
export interface ModuleAnalysisOptions {
  readonly analysis?: AnalysisContext;
  readonly resourceContents?: ReadonlyMap<string, string>;
  /** The project manifest's extension sections, by extension id; see AnalysisContext. */
  readonly extensionConfig?: ReadonlyMap<string, unknown>;
  readonly executeMain?: boolean;
}

/** What the parse hands the analysis phase. */
export interface ParsedModuleAnalysisInput {
  readonly source: SourceText;
  readonly diagnostics: readonly Diagnostic[];
  readonly advisories: readonly Advisory[];
}

/** The analyzer a compile emits and reports from, with what it accumulated. */
export interface AnalyzedModule {
  readonly analyzer: Analyzer;
  readonly diagnostics: Diagnostic[];
  readonly advisories: Advisory[];
}

/**
 * The context one module is analyzed in: what the caller passed, plus the three
 * facts only this compile knows — the module's own path and text, and whether
 * it is the program entry — and the two project inputs that reach analysis
 * through their own options (`resourceContents` and `extensionConfig`) as well
 * as through a caller-built context.
 */
function moduleAnalysisContext(options: ModuleAnalysisOptions, source: SourceText): AnalysisContext {
  const resources = options.resourceContents ?? options.analysis?.resources;
  const projectConfig = options.extensionConfig ?? options.analysis?.extensionProjectConfig;
  return {
    ...options.analysis,
    path: source.path,
    sourceText: source.text,
    executeMain: options.executeMain !== false,
    ...(resources ? { resources } : {}),
    ...(projectConfig ? { extensionProjectConfig: projectConfig } : {}),
  };
}

/**
 * One module analyzed. Semantic analysis also runs when every earlier
 * diagnostic recovered as the guided spelling, so the caller's emission gate —
 * not this phase — decides whether the module compiles.
 */
export function analyzeModule(
  semanticProgram: Program,
  parsed: ParsedModuleAnalysisInput,
  options: ModuleAnalysisOptions,
  extensions: readonly CompilerExtension[],
): AnalyzedModule {
  const diagnostics = [...parsed.diagnostics];
  const advisories: Advisory[] = [...parsed.advisories];
  const analysisExtensions = extensions.flatMap((extension) => extension.analysis ? [extension.analysis] : []);
  const analyzerExtensions = extensions.filter((extension) => extension.analyzer);
  if (analyzerExtensions.length > 1) throw new Error("Only one compiler extension may own semantic analysis");
  const analysisContext = moduleAnalysisContext(options, parsed.source);
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
  return { analyzer, diagnostics, advisories };
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
