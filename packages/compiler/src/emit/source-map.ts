/**
 * The mapping bookkeeping: each emitted JavaScript node gets an id and an
 * authoring span, and rendering the node writes the span into the generated
 * mappings.
 */
import { type Span } from "../source.ts";
import { javaScriptNodeMarker, type GeneratedMapping, type JavaScriptNode } from "./javascript.ts";

export interface SourceMapRecorderHost {
  readonly javaScriptNodeSpans: Map<number, Span>;
  nextJavaScriptNodeId: number;
}

export class SourceMapRecorder {
  private readonly host: SourceMapRecorderHost;

  constructor(host: SourceMapRecorderHost) {
    this.host = host;
  }

  emitJavaScriptNode(sourceSpan: Span, render: () => string): JavaScriptNode {
    const node = { id: this.host.nextJavaScriptNodeId++, code: render(), sourceSpan } satisfies JavaScriptNode;
    this.host.javaScriptNodeSpans.set(node.id, sourceSpan);
    return node;
  }

  markJavaScriptNode(node: JavaScriptNode): string {
    return node.code.length === 0 ? "" : `\u0000VELAR_MAP_${node.id}\u0000${node.code}`;
  }

  renderJavaScriptNode(node: JavaScriptNode): { readonly code: string; readonly mappings: readonly GeneratedMapping[] } {
    let code = "";
    let cursor = 0;
    const mappings: GeneratedMapping[] = [{ offset: 0, sourceSpan: node.sourceSpan }];
    for (const marker of node.code.matchAll(javaScriptNodeMarker)) {
      const markerIndex = marker.index;
      code += node.code.slice(cursor, markerIndex);
      const sourceSpan = this.host.javaScriptNodeSpans.get(Number(marker[1]));
      cursor = markerIndex + marker[0].length;
      // A marker id this emit never issued cannot come from a marked node, so
      // it is text that only looks like emitter metadata. Markers are
      // invisible by construction: the render drops the sequence and keeps one
      // mapping fewer rather than failing the whole compile with a host throw.
      if (!sourceSpan) continue;
      mappings.push({ offset: code.length, sourceSpan });
    }
    code += node.code.slice(cursor);
    return { code, mappings };
  }
}
