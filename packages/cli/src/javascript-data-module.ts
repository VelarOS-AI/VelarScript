import { Buffer } from "node:buffer";
import { isBuiltin } from "node:module";
import {
  inspectJavaScriptModule,
  MAX_JAVASCRIPT_MODULE_SYNTAX_NODES,
} from "@velarscript/compiler";
import type { VelarPackageTarget } from "./source-package-manifest.ts";

const MAX_INLINE_JAVASCRIPT_MODULES = 128;
const MAX_INLINE_JAVASCRIPT_BYTES = 4 * 1024 * 1024;

/**
 * Proves an inline data-module graph at check time. A data URL has no package
 * owner or filesystem base, so its only portable nested edge is another data
 * module; Node builtins additionally belong to the explicit Node target.
 */
export function assertJavaScriptDataModuleTarget(
  source: string,
  target: VelarPackageTarget,
): void {
  const pending = [source];
  const visited = new Set<string>();
  let remainingSyntaxNodes = MAX_JAVASCRIPT_MODULE_SYNTAX_NODES;
  let decodedBytes = 0;
  while (pending.length > 0) {
    const specifier = pending.pop()!;
    if (visited.has(specifier)) continue;
    visited.add(specifier);
    if (visited.size > MAX_INLINE_JAVASCRIPT_MODULES) {
      throw new RangeError(`inline JavaScript graph exceeds ${MAX_INLINE_JAVASCRIPT_MODULES} data modules`);
    }
    const code = decodeJavaScriptDataModule(specifier);
    decodedBytes += Buffer.byteLength(code);
    if (decodedBytes > MAX_INLINE_JAVASCRIPT_BYTES) {
      throw new RangeError(`inline JavaScript graph exceeds ${MAX_INLINE_JAVASCRIPT_BYTES} decoded bytes`);
    }
    const inspection = inspectJavaScriptModule(code, { maximumSyntaxNodes: remainingSyntaxNodes });
    remainingSyntaxNodes -= inspection.syntaxNodes;
    for (const edge of inspection.edges) {
      if (edge.source === null) throw new Error("inline JavaScript data modules cannot use computed dynamic imports");
      if (edge.source.startsWith("data:")) {
        pending.push(edge.source);
        continue;
      }
      if (isBuiltin(edge.source)) {
        if (target !== "node") {
          throw new Error(`Node builtin '${edge.source}' is available only to the Node target`);
        }
        continue;
      }
      if (edge.source.startsWith("node:")) throw new Error(`'${edge.source}' is not a Node builtin`);
      throw new Error(
        `nested import '${edge.source}' has no portable owner; use a package import from VelarScript source instead`,
      );
    }
  }
}

function decodeJavaScriptDataModule(source: string): string {
  const comma = source.indexOf(",");
  if (!source.startsWith("data:") || comma < 0) throw new Error("invalid JavaScript data URL");
  const metadata = source.slice(5, comma).split(";");
  const mediaType = metadata.shift()?.toLowerCase();
  if (mediaType !== "text/javascript" && mediaType !== "application/javascript") {
    throw new Error("inline JavaScript data modules require a text/javascript media type");
  }
  const base64 = metadata.at(-1)?.toLowerCase() === "base64";
  if (base64) metadata.pop();
  if (metadata.some((item) => item.toLowerCase() !== "charset=utf-8")) {
    throw new Error("inline JavaScript data modules support only the UTF-8 charset parameter");
  }
  let payload: string;
  try {
    payload = decodeURIComponent(source.slice(comma + 1));
  } catch {
    throw new Error("inline JavaScript data module contains invalid percent encoding");
  }
  if (!base64) return payload;
  const compact = payload.replace(/[\t\n\f\r ]/gu, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(compact)) {
    throw new Error("inline JavaScript data module contains invalid base64");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(compact, "base64"));
  } catch {
    throw new Error("inline JavaScript data module is not valid UTF-8");
  }
}
