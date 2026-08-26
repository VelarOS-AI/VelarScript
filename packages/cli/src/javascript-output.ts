import { basename } from "node:path";
import { transform } from "esbuild";

/**
 * JavaScript 构建产物只有两种公开模式。
 *
 * - `production`：默认模式。压缩标识符、语法和空白，并删除可安全消除的代码，
 *   用于部署、发布和性能测试。
 * - `readable`：保留编译器生成的结构化名称与排版，用于脱离 VelarScript
 *   工具链后的排障、审计和人工接管。
 *
 * 两种模式使用同一份 VelarScript 语义分析结果；这里仅改变 JavaScript 的
 * 表达形式，不能改变模块边界、导出、异常行为或运行结果。
 */
export type JavaScriptBuildMode = "production" | "readable";

export interface JavaScriptOutputInput {
  readonly code: string;
  readonly sourceMap: string | null;
  readonly sourceFile: string;
  readonly outputFile: string;
  readonly mode: JavaScriptBuildMode;
  readonly sourceMaps: boolean;
  readonly target: "es2022" | "node24";
}

export interface JavaScriptOutput {
  readonly code: string;
  readonly sourceMap: string;
}

/**
 * 把编译器的规范 JavaScript 渲染为最终构建产物。
 *
 * 可读模式不再经过第二个代码生成器，避免“为了好看”意外改写用户语义。
 * 生产模式才交给 esbuild 做纯 JavaScript 级优化。输入源码映射以内联形式
 * 交给 esbuild，使新的映射仍然能回到 `.vel`，而不是只回到中间 JavaScript。
 */
export async function renderJavaScriptOutput(input: JavaScriptOutputInput): Promise<JavaScriptOutput> {
  if (input.mode === "readable") {
    return {
      code: terminateLine(input.code),
      sourceMap: input.sourceMaps ? input.sourceMap ?? "" : "",
    };
  }

  const sourceMap = input.sourceMaps && input.sourceMap
    ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(input.sourceMap).toString("base64")}\n`
    : "";
  const result = await transform(`${input.code}${sourceMap}`, {
    loader: "js",
    format: "esm",
    target: input.target,
    minify: true,
    treeShaking: true,
    legalComments: "none",
    sourcefile: input.sourceFile,
    sourcemap: input.sourceMaps ? "external" : false,
    sourcesContent: input.sourceMaps,
  });
  return {
    // `transform` 的 external source map 不带链接注释。链接由统一写盘函数添加，
    // 从而主模块、内嵌模块与单文件输出都使用真实输出文件名。
    code: terminateLine(result.code.replace(
      new RegExp(`\\n?//# sourceMappingURL=${escapeRegularExpression(basename(input.outputFile))}\\.map\\s*$`, "u"),
      "",
    )),
    sourceMap: input.sourceMaps ? result.map : "",
  };
}

function terminateLine(value: string): string {
  return value.endsWith("\n") || value.endsWith("\r") ? value : `${value}\n`;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
