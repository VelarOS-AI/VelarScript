import { TextDecoder } from "node:util";
import {
  readOrdinaryFileSnapshot,
  type OrdinaryFileSnapshotOperations,
} from "./ordinary-file-snapshot.ts";

export const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
export const MAX_TYPESCRIPT_DECLARATION_BYTES = 2 * 1024 * 1024;
export const MAX_TYPESCRIPT_DECLARATION_FILES = 64;

export interface TypeScriptDeclarationReadOperations {
  readonly afterPathInspection?: (
    path: string,
    label: string,
  ) => Promise<void>;
}

export interface TypeScriptDeclarationSourceSnapshot {
  readonly text: string;
  readonly size: number;
}

export interface TypeScriptDeclarationGraphSourceBudget {
  readonly paths: Set<string>;
  totalBytes: number;
}

export type TypeScriptDeclarationGraphSource =
  | { readonly kind: "source"; readonly text: string }
  | { readonly kind: "file-limit" }
  | { readonly kind: "byte-limit" };

export function createTypeScriptDeclarationGraphSourceBudget(): TypeScriptDeclarationGraphSourceBudget {
  return { paths: new Set(), totalBytes: 0 };
}

/** Reads one manifest or declaration from one pathname-bound bounded descriptor. */
export async function readTypeScriptDeclarationSource(
  path: string,
  maximumBytes: number,
  label: string,
  operations: TypeScriptDeclarationReadOperations = {},
  followSymbolicLink = false,
): Promise<TypeScriptDeclarationSourceSnapshot> {
  const afterPathInspection = operations.afterPathInspection;
  const snapshotOperations: OrdinaryFileSnapshotOperations = {
    ...(afterPathInspection ? {
      afterPathInspection: () => afterPathInspection(path, label),
    } : {}),
    ...(followSymbolicLink ? { followSymbolicLink: true } : {}),
  };
  const { bytes } = await readOrdinaryFileSnapshot(path, maximumBytes, label, snapshotOperations);
  return { text: strictUtf8(bytes, label), size: bytes.byteLength };
}

/** Reads and accounts one declaration against the graph's actual stable bytes. */
export async function readTypeScriptDeclarationGraphSource(
  path: string,
  budget: TypeScriptDeclarationGraphSourceBudget,
  operations: TypeScriptDeclarationReadOperations = {},
): Promise<TypeScriptDeclarationGraphSource> {
  if (budget.paths.size >= MAX_TYPESCRIPT_DECLARATION_FILES) return { kind: "file-limit" };
  const remaining = MAX_TYPESCRIPT_DECLARATION_BYTES - budget.totalBytes;
  let snapshot: TypeScriptDeclarationSourceSnapshot;
  try {
    snapshot = await readTypeScriptDeclarationSource(path, remaining, "TypeScript declaration", operations);
  } catch (error) {
    if (error instanceof RangeError) return { kind: "byte-limit" };
    throw error;
  }
  budget.paths.add(path);
  budget.totalBytes += snapshot.size;
  return { kind: "source", text: snapshot.text };
}

function strictUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8`);
  }
}
