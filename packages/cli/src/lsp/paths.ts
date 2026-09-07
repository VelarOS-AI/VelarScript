/**
 * D115 P4 R4c — document URIs, and the Desktop project grant that confines them.
 *
 * `confinedWorkspaceRoot` and `confinedCanonicalRoot` were mutable module-level
 * state; they are session fields now, and every helper that enforces the grant
 * takes the session as `WorkspaceConfinement`.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPathWithinCanonicalRoot } from "../canonical-path.ts";
import type { TextDocument } from "./protocol.ts";

/** The grant a session runs under: a workspace root, and the canonical root symlinks are resolved against. */
export interface WorkspaceConfinement {
  readonly confinedWorkspaceRoot: string | null;
  readonly confinedCanonicalRoot: string | null;
}

export function pathOf(confinement: WorkspaceConfinement, uri: string): string | null {
  const path = rawPathOf(uri);
  return path && (!confinement.confinedWorkspaceRoot || withinWorkspaceRoot(confinement.confinedWorkspaceRoot, path)) ? path : null;
}

export function rawPathOf(uri: string): string | null {
  try { return uri.startsWith("file:") ? fileURLToPath(uri) : null; } catch { return null; }
}

export function isVelarDocument(document: TextDocument): boolean {
  const language = document.languageId.trim().toLowerCase();
  if (language === "velar" || language === "velarscript") return true;
  const path = rawPathOf(document.uri);
  return path !== null && path.toLowerCase().endsWith(".vel");
}

export async function authorizedPathOf(confinement: WorkspaceConfinement, uri: string): Promise<string | null> {
  const path = pathOf(confinement, uri);
  if (!path || !confinement.confinedCanonicalRoot) return path;
  try {
    return await canonicalPathWithinCanonicalRoot(confinement.confinedCanonicalRoot, path) ? path : null;
  } catch {
    return null;
  }
}

export function requestedWorkspaceRoots(confinement: WorkspaceConfinement, params: Record<string, unknown> | undefined): readonly string[] {
  const roots: string[] = [];
  const folders = params?.workspaceFolders;
  if (Array.isArray(folders)) {
    for (const folder of folders) {
      if (!folder || typeof folder !== "object" || Array.isArray(folder)) continue;
      const uri = (folder as Record<string, unknown>).uri;
      if (typeof uri !== "string") continue;
      const path = rawPathOf(uri);
      if (!path) throw new TypeError("LSP workspace folders must use file URLs");
      roots.push(path);
    }
  }
  if (roots.length === 0 && typeof params?.rootUri === "string") {
    const path = rawPathOf(params.rootUri);
    if (!path) throw new TypeError("LSP rootUri must use a file URL");
    roots.push(path);
  }
  if (roots.length === 0 && typeof params?.rootPath === "string" && params.rootPath !== "") roots.push(params.rootPath);
  if (confinement.confinedWorkspaceRoot) {
    if (roots.some((root) => !withinWorkspaceRoot(confinement.confinedWorkspaceRoot!, resolve(root)))) {
      throw new RangeError("LSP workspace roots must remain inside the Desktop project grant");
    }
    return [confinement.confinedWorkspaceRoot];
  }
  return [...new Set(roots)];
}

export function configuredWorkspaceRoot(): string | null {
  const value = process.env.VELAR_LANGUAGE_SERVER_WORKSPACE_ROOT;
  return typeof value === "string" && value !== "" ? resolve(value) : null;
}

export function configuredCanonicalRoot(): string | null {
  const value = process.env.VELAR_LANGUAGE_SERVER_CANONICAL_ROOT;
  return typeof value === "string" && value !== "" ? resolve(value) : null;
}

export function withinWorkspaceRoot(root: string, path: string): boolean {
  const value = relative(root, resolve(path));
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

export function projectRelativeGraphPath(root: string, path: string): string {
  return relative(root, resolve(path)).replaceAll("\\", "/");
}
