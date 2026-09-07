/**
 * `/__velar/map`: the original `.vel` line and column behind a generated
 * JavaScript position, decoded from the module's own source map.
 */

import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectResult } from "../project.ts";

interface SourceMapShape {
  readonly sources: readonly string[];
  readonly mappings: string;
}

export function mapSourcePosition(
  project: ProjectResult,
  pathname: string,
  generatedLine: number,
  generatedColumn: number,
): { readonly path: string; readonly line: number; readonly column: number } | null {
  const route = pathname.replace(/^\/+/, "");
  const normalized = route.replace(/\.js$/u, ".vel");
  let module = project.modules.find((item) => item.relativePath.replaceAll("\\", "/") === normalized);
  let sourceMap = module?.result.sourceMap ?? null;
  if (!module) {
    for (const candidate of project.modules) {
      const directory = posix.dirname(candidate.relativePath.replaceAll("\\", "/"));
      const embedded = candidate.result.embeddedModules.find((item) =>
        posix.normalize(posix.join(directory, item.specifier)) === route);
      if (!embedded) continue;
      module = candidate;
      sourceMap = embedded.sourceMap;
      break;
    }
  }
  if (!module || !sourceMap || generatedLine < 1 || generatedColumn < 1) return null;
  let map: SourceMapShape;
  try {
    map = JSON.parse(sourceMap) as SourceMapShape;
  } catch {
    return null;
  }
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  const lines = map.mappings.split(";");
  for (let lineIndex = 0; lineIndex < Math.min(generatedLine, lines.length); lineIndex += 1) {
    let generated = 0;
    let selected: { source: number; line: number; column: number } | null = null;
    for (const encoded of lines[lineIndex]!.split(",").filter(Boolean)) {
      const values = decodeVlqSegment(encoded);
      if (values.length < 4) continue;
      generated += values[0]!;
      previousSource += values[1]!;
      previousOriginalLine += values[2]!;
      previousOriginalColumn += values[3]!;
      if (lineIndex === generatedLine - 1 && generated <= generatedColumn - 1) {
        selected = { source: previousSource, line: previousOriginalLine + 1, column: previousOriginalColumn + 1 };
      }
    }
    if (lineIndex === generatedLine - 1 && selected) {
      const mappedSource = map.sources[selected.source] ?? module.inputPath;
      const source = mappedSource.startsWith("file:") ? fileURLToPath(mappedSource) : mappedSource;
      const path = relativePath(project.projectRoot, source);
      return { path, line: selected.line, column: selected.column };
    }
  }
  return null;
}

function decodeVlqSegment(value: string): number[] {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const output: number[] = [];
  let current = 0;
  let shift = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return [];
    current += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const negative = (current & 1) === 1;
    output.push((negative ? -1 : 1) * (current >> 1));
    current = 0;
    shift = 0;
  }
  return output;
}

function relativePath(root: string, path: string): string {
  const normalized = path.startsWith(root) ? path.slice(root.length).replace(/^[/\\]+/u, "") : path;
  return normalized.replaceAll("\\", "/");
}
