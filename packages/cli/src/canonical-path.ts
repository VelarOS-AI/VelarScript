import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { isHostErrorCode } from "./host-error.ts";

export async function canonicalizePotentialPath(path: string): Promise<string> {
  let current = resolve(path);
  const missing: string[] = [];
  for (let depth = 0; depth <= 64; depth += 1) {
    try {
      return resolve(await realpath(current), ...missing.reverse());
    } catch (error) {
      if (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR")) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.push(basename(current));
      current = parent;
    }
  }
  throw new RangeError("Filesystem authorization path exceeds 64 unresolved levels");
}

export async function canonicalPathWithinCanonicalRoot(canonicalRoot: string, path: string): Promise<boolean> {
  return pathWithinCanonicalRoot(resolve(canonicalRoot), await canonicalizePotentialPath(path));
}

function pathWithinCanonicalRoot(canonicalRoot: string, canonicalPath: string): boolean {
  const value = relative(canonicalRoot, canonicalPath);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}
