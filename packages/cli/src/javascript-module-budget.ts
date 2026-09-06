import {
  inspectJavaScriptModule,
  MAX_JAVASCRIPT_MODULE_SYNTAX_NODES,
  MAX_JAVASCRIPT_MODULE_TOKENS,
  type JavaScriptModuleInspection,
} from "@velarscript/compiler";

export interface JavaScriptModuleGraphBudget {
  remainingSyntaxNodes: number;
  remainingTokens: number;
}

export function createJavaScriptModuleGraphBudget(): JavaScriptModuleGraphBudget {
  return {
    remainingSyntaxNodes: MAX_JAVASCRIPT_MODULE_SYNTAX_NODES,
    remainingTokens: MAX_JAVASCRIPT_MODULE_TOKENS,
  };
}

/** Parses one module while charging both independently growing parser costs to a graph-wide budget. */
export function inspectJavaScriptModuleWithinBudget(
  source: string,
  budget: JavaScriptModuleGraphBudget,
): JavaScriptModuleInspection {
  if (budget.remainingSyntaxNodes < 1 || budget.remainingTokens < 1) {
    throw new RangeError("JavaScript module graph exceeds its parse complexity budget");
  }
  const inspection = inspectJavaScriptModule(source, {
    maximumSyntaxNodes: budget.remainingSyntaxNodes,
    maximumTokens: budget.remainingTokens,
  });
  const tokens = inspectionTokens(inspection, source);
  if (inspection.syntaxNodes > budget.remainingSyntaxNodes || tokens > budget.remainingTokens) {
    throw new RangeError("JavaScript module graph exceeds its parse complexity budget");
  }
  budget.remainingSyntaxNodes -= inspection.syntaxNodes;
  budget.remainingTokens -= tokens;
  return inspection;
}

function inspectionTokens(inspection: JavaScriptModuleInspection, source: string): number {
  const tokens = (inspection as JavaScriptModuleInspection & { readonly tokens?: unknown }).tokens;
  // A direct source-tree check can run before the in-tree compiler dist is rebuilt.
  // UTF-8 bytes are a conservative token charge, never permission to skip the
  // new bound until that local build catches up.
  return typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0
    ? tokens
    : Buffer.byteLength(source, "utf8");
}
