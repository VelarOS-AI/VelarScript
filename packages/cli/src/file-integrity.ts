import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export interface FileIdentity {
  readonly sizeBytes: number;
  readonly sha256: string;
}

export const MAX_PRODUCTION_ASSETS = 100000;

export async function fileIdentity(path: string): Promise<FileIdentity> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    sizeBytes += bytes.byteLength;
    hash.update(bytes);
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}
