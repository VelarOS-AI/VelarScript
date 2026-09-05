import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";

export interface FileContentFingerprint {
  readonly bytes: number;
  readonly sha256: string;
}

/** Hashes a regular file without retaining its contents in the long-lived caller. */
export async function boundedFileFingerprint(
  path: string,
  maximumBytes: number,
  label: string,
): Promise<FileContentFingerprint> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
  if (metadata.size > maximumBytes) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = createReadStream(path);
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > maximumBytes) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
      hash.update(chunk);
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }
  return { bytes, sha256: hash.digest("hex") };
}

export function textFingerprint(value: string): FileContentFingerprint {
  return {
    bytes: Buffer.byteLength(value, "utf8"),
    sha256: createHash("sha256").update(value, "utf8").digest("hex"),
  };
}

export function sameFileFingerprint(
  left: FileContentFingerprint | undefined,
  right: FileContentFingerprint,
): boolean {
  return left?.bytes === right.bytes && left.sha256 === right.sha256;
}
