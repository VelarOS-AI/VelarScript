import { open, type FileHandle } from "node:fs/promises";

const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Reads at most maximumBytes + 1 from one opened file identity. The descriptor
 * closes the path-replacement race, while the explicit loop also bounds files
 * that grow after stat or report an unhelpful size.
 */
export async function readBoundedBytes(path: string, maximumBytes: number, label: string): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} has an invalid byte limit`);
  }
  const handle = await open(path, "r");
  try {
    return await readBoundedFileHandle(handle, maximumBytes, label);
  } finally {
    await handle.close();
  }
}

/** Keeps caller-owned identity checks and bounded I/O on the same descriptor. */
export async function readBoundedFileHandle(
  handle: FileHandle,
  maximumBytes: number,
  label: string,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} has an invalid byte limit`);
  }
  const metadata = await handle.stat();
  if (!metadata.isFile()) throw new Error(`${label} is not a regular file`);
  if (metadata.size > maximumBytes) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);

  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maximumBytes) {
    const remaining = maximumBytes + 1 - total;
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
    if (bytesRead === 0) return Buffer.concat(chunks, total);
    chunks.push(bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
}

export async function readBoundedText(path: string, maximumBytes: number, label: string): Promise<string> {
  return (await readBoundedBytes(path, maximumBytes, label)).toString("utf8");
}
