import { realpath } from "node:fs/promises";
import { extname, dirname, resolve } from "node:path";
import type { Plugin } from "esbuild";
import { readOrdinaryFileSnapshot } from "./ordinary-file-snapshot.ts";
import {
  assertStaticJavaScriptDeploymentInputSnapshots,
  MAX_STATIC_DEPLOYMENT_JAVASCRIPT_BYTES,
  MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS,
  type StaticJavaScriptDeploymentInputSnapshot,
} from "./static-javascript-deployment.ts";

export interface EsbuildJavaScriptSnapshotCapture {
  readonly plugin: Plugin;
  /** Proves that every ordinary JavaScript input came from the captured bytes. */
  readonly assertInputs: (inputPaths: readonly string[]) => Promise<void>;
}

/**
 * Binds esbuild and the static deployment proof to one immutable read of each
 * ordinary JavaScript file. A pathname change after onLoad cannot substitute
 * different bytes for the proof or for the captured output plan.
 */
export function createEsbuildJavaScriptSnapshotCapture(owner: string): EsbuildJavaScriptSnapshotCapture {
  const snapshots = new Map<string, StaticJavaScriptDeploymentInputSnapshot>();
  const capturedSnapshots = new Set<StaticJavaScriptDeploymentInputSnapshot>();
  let remainingBytes = MAX_STATIC_DEPLOYMENT_JAVASCRIPT_BYTES;
  const plugin: Plugin = {
    name: "velar-static-javascript-snapshot",
    setup(context) {
      context.onLoad({ filter: /\.[cm]?js$/, namespace: "file" }, async (arguments_) => {
        const path = resolve(arguments_.path);
        const canonicalBefore = await realpath(path);
        const existing = snapshots.get(path) ?? snapshots.get(canonicalBefore);
        if (existing) {
          return { contents: existing.bytes, loader: "js", resolveDir: dirname(path) };
        }
        if (capturedSnapshots.size >= MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS) {
          throw new RangeError(`${owner} cannot contain more than ${MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS} JavaScript inputs`);
        }
        if (remainingBytes < 1) throw deploymentSizeError(owner);
        let bytes: Buffer;
        try {
          ({ bytes } = await readOrdinaryFileSnapshot(
            path,
            remainingBytes,
            `${owner} JavaScript input '${path}'`,
            { followSymbolicLink: true },
          ));
        } catch (error) {
          if (error instanceof RangeError) throw deploymentSizeError(owner);
          throw error;
        }
        // esbuild accepts Uint8Array contents and parses exactly this captured
        // byte sequence; UTF-8 validity is checked by the shared proof below.
        const canonicalAfter = await realpath(path);
        if (canonicalAfter !== canonicalBefore) {
          throw new Error(`${owner} JavaScript input '${path}' changed while the deployment bundler read it`);
        }
        const snapshot = { path: canonicalAfter, bytes: new Uint8Array(bytes) };
        snapshots.set(path, snapshot);
        snapshots.set(canonicalAfter, snapshot);
        capturedSnapshots.add(snapshot);
        remainingBytes -= bytes.byteLength;
        return { contents: snapshot.bytes, loader: "js", resolveDir: dirname(path) };
      });
    },
  };
  return {
    plugin,
    assertInputs: async (inputPaths) => {
      const selected: StaticJavaScriptDeploymentInputSnapshot[] = [];
      for (const inputPath of [...new Set(inputPaths.map((path) => resolve(path)))].sort(compare)) {
        const extension = extname(inputPath).toLowerCase();
        if (extension === ".json") continue;
        if (extension !== ".js" && extension !== ".mjs" && extension !== ".cjs") {
          throw new Error(`${owner} includes unsupported JavaScript input '${inputPath}'`);
        }
        const snapshot = snapshots.get(inputPath) ?? snapshots.get(await realpath(inputPath));
        if (!snapshot) {
          throw new Error(`${owner} JavaScript input '${inputPath}' was not captured by the deployment bundler`);
        }
        selected.push(snapshot);
      }
      await assertStaticJavaScriptDeploymentInputSnapshots(selected, owner);
    },
  };
}

function deploymentSizeError(owner: string): RangeError {
  return new RangeError(`${owner} JavaScript inputs exceed ${MAX_STATIC_DEPLOYMENT_JAVASCRIPT_BYTES} bytes`);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
