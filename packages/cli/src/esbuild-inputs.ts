import { isBuiltin } from "node:module";
import { isAbsolute, resolve } from "node:path";
import type { Metafile } from "esbuild";

/** Ordinary filesystem modules esbuild read, excluding virtual namespace inputs. */
export function ordinaryEsbuildInputPaths(
  metafile: Metafile,
  workingDirectory: string,
): readonly string[] {
  return Object.keys(metafile.inputs)
    .filter(ordinaryMetafileInput)
    .map((path) => isAbsolute(path) ? resolve(path) : resolve(workingDirectory, path));
}

/** Rejects any bare runtime edge that the generated output would still resolve from its host. */
export function assertEsbuildExternalImportsClosed(
  metafile: Metafile,
  allowedExternal: ReadonlySet<string>,
  owner: string,
): void {
  for (const output of Object.values(metafile.outputs)) {
    for (const dependency of output.imports) {
      if (!dependency.external || isBuiltin(dependency.path) || allowedExternal.has(dependency.path)) continue;
      throw new Error(`${owner} left npm dependency '${dependency.path}' outside the generated output`);
    }
  }
}

function ordinaryMetafileInput(path: string): boolean {
  if (path === "<stdin>") return false;
  if (/^[A-Za-z]:[\\/]/u.test(path)) return true;
  return !/^[a-z][a-z0-9-]*:/u.test(path);
}
