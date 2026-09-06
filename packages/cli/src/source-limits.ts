import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { MAX_VELAR_SOURCE_CODE_UNITS } from "@velarscript/compiler";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import {
  ChangedOrdinaryFileError,
  NonOrdinaryFileError,
  readOrdinaryFileSnapshot,
  type OrdinaryFileSnapshotOperations,
} from "./ordinary-file-snapshot.ts";

export const MAX_VELAR_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_VELAR_PROJECT_MODULES = 4096;

export interface VelarSourceFileSnapshot {
  readonly text: string;
  /** SHA-256 of the exact source bytes read from disk. */
  readonly sha256: string;
}

export interface VelarSourceFileReadOperations {
  readonly afterPathInspection?: OrdinaryFileSnapshotOperations["afterPathInspection"];
  /** Canonical path authorized by the project graph before this descriptor was opened. */
  readonly expectedCanonicalPath?: string;
}

export function validateVelarSourceText(text: string, path: string): string {
  if (text.length > MAX_VELAR_SOURCE_CODE_UNITS || Buffer.byteLength(text, "utf8") > MAX_VELAR_SOURCE_BYTES) {
    throw new RangeError(`${path} exceeds the 4 MiB VelarScript source-module limit`);
  }
  return text;
}

export function snapshotVelarSourceText(text: string, path: string): VelarSourceFileSnapshot {
  const validated = validateVelarSourceText(text, path);
  return { text: validated, sha256: createHash("sha256").update(validated, "utf8").digest("hex") };
}

function decodeVelarSourceBytes(bytes: Uint8Array, path: string): string {
  if (bytes.byteLength > MAX_VELAR_SOURCE_BYTES) throw new RangeError(`${path} exceeds the 4 MiB VelarScript source-module limit`);
  try {
    // Keep a leading BOM in the compiler input so decoding and re-encoding are
    // byte-exact. Invalid byte sequences are source errors, never replacement
    // characters that can disappear into a comment or string literal.
    return validateVelarSourceText(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), path);
  } catch (error) {
    if (error instanceof RangeError && error.message.includes("source-module limit")) throw error;
    throw new Error(`${path} must contain valid UTF-8`);
  }
}

export async function readVelarSourceFileSnapshot(
  path: string,
  operations: VelarSourceFileReadOperations = {},
): Promise<VelarSourceFileSnapshot> {
  let bytes: Buffer;
  try {
    ({ bytes } = await readOrdinaryFileSnapshot(path, MAX_VELAR_SOURCE_BYTES, path, {
      ...(operations.afterPathInspection ? { afterPathInspection: operations.afterPathInspection } : {}),
      followSymbolicLink: true,
      ...(operations.expectedCanonicalPath === undefined ? {} : {
        validateOpenedSnapshot: async () => {
          if (await canonicalizePotentialPath(path) !== operations.expectedCanonicalPath) {
            throw new ChangedOrdinaryFileError(`${path} changed its canonical source identity while it was read`);
          }
        },
      }),
    }));
  } catch (error) {
    if (error instanceof RangeError) throw new RangeError(`${path} exceeds the 4 MiB VelarScript source-module limit`);
    if (error instanceof NonOrdinaryFileError) throw new Error(`${path} is not a regular source file`);
    throw error;
  }
  return {
    text: decodeVelarSourceBytes(bytes, path),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function resolveVelarSourceSnapshot(
  path: string,
  override: string | undefined,
  operations: VelarSourceFileReadOperations = {},
): Promise<VelarSourceFileSnapshot> {
  return override === undefined ? readVelarSourceFileSnapshot(path, operations) : snapshotVelarSourceText(override, path);
}

export async function readVelarSourceFile(path: string): Promise<string> {
  return (await readVelarSourceFileSnapshot(path)).text;
}
