import { readFile, stat } from "node:fs/promises";

export async function readBoundedText(path: string, maximumBytes: number, label: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${label} is not a regular file`);
  if (metadata.size > maximumBytes) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
  const source = await readFile(path, "utf8");
  if (Buffer.byteLength(source, "utf8") > maximumBytes) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
  return source;
}
