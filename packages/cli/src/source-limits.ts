import { readFile, stat } from "node:fs/promises";
import { MAX_VELAR_SOURCE_CODE_UNITS } from "@velarscript/compiler";

export const MAX_VELAR_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_VELAR_PROJECT_MODULES = 4096;

export function validateVelarSourceText(text: string, path: string): string {
  if (text.length > MAX_VELAR_SOURCE_CODE_UNITS || Buffer.byteLength(text, "utf8") > MAX_VELAR_SOURCE_BYTES) {
    throw new RangeError(`${path} exceeds the 4 MiB VelarScript source-module limit`);
  }
  return text;
}

export async function readVelarSourceFile(path: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${path} is not a regular source file`);
  if (metadata.size > MAX_VELAR_SOURCE_BYTES) throw new RangeError(`${path} exceeds the 4 MiB VelarScript source-module limit`);
  return validateVelarSourceText(await readFile(path, "utf8"), path);
}
