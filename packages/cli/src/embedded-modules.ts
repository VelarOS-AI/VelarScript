import { basename, dirname, join, resolve } from "node:path";

export interface EmbeddedModuleArtifact {
  readonly specifier: string;
  readonly code: string;
  readonly sourceMap: string;
}

export interface CompiledModuleArtifactSet {
  readonly ownerPath: string;
  readonly embeddedModules: readonly EmbeddedModuleArtifact[];
}

export const VELAR_EMBEDDED_MODULE_MARKER = "// @velarscript/generated-embedded-module\n";

export function embeddedModuleOutputPath(ownerOutputPath: string, specifier: string): string {
  const name = specifier.startsWith("./") ? specifier.slice(2) : "";
  if (!name || basename(name) !== name || !name.endsWith(".js")) {
    throw new Error(`Compiler emitted an invalid sibling JavaScript module specifier '${specifier}'`);
  }
  return join(dirname(ownerOutputPath), name);
}

/** Refuse ambiguous output graphs before any owner or sibling is written. */
export function assertUniqueEmbeddedModuleOutputs(artifacts: readonly CompiledModuleArtifactSet[]): void {
  const owners = new Map<string, string>();
  const claim = (path: string, label: string): void => {
    const key = resolve(path);
    const previous = owners.get(key);
    if (previous) {
      throw new Error(`Embedded JavaScript output collision at '${path}': ${previous} and ${label} would write the same file`);
    }
    owners.set(key, label);
  };
  for (const artifact of artifacts) {
    claim(artifact.ownerPath, `compiled module '${artifact.ownerPath}'`);
    for (const embedded of artifact.embeddedModules) {
      const path = embeddedModuleOutputPath(artifact.ownerPath, embedded.specifier);
      claim(path, `embedded module '${embedded.specifier}' owned by '${artifact.ownerPath}'`);
    }
  }
}

export function embeddedModuleFileContents(path: string, artifact: EmbeddedModuleArtifact): string {
  const code = artifact.code.endsWith("\n") || artifact.code.endsWith("\r") ? artifact.code : `${artifact.code}\n`;
  return `${code}${VELAR_EMBEDDED_MODULE_MARKER}//# sourceMappingURL=${basename(path)}.map\n`;
}
