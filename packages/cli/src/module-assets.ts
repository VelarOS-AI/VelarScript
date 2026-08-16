import { lstat } from "node:fs/promises";
import { extname, posix, relative, resolve } from "node:path";
import { projectImportKey, type ProjectModule, type ProjectResult } from "./project.ts";
import { frameworkBase } from "./framework-host.ts";

export function moduleOutput(project: ProjectResult, pathname: string, revision: string | null = null): { readonly body: string; readonly contentType: string } | null {
  const normalized = pathname.replace(/^\//u, "");
  for (const owner of project.modules) {
    const ownerDirectory = posix.dirname(owner.relativePath.replaceAll("\\", "/"));
    for (const embedded of owner.result.embeddedModules) {
      const route = posix.normalize(posix.join(ownerDirectory, embedded.specifier));
      if (normalized === `${route}.map`) return { body: embedded.sourceMap, contentType: "application/json; charset=utf-8" };
      if (normalized !== route) continue;
      const fileName = posix.basename(route);
      // The owner imports this sibling with the revision query already. Never
      // regexp-rewrite the raw foreign source: import-looking text can occur in
      // a string, template, regex, or comment and must remain byte-for-byte JS.
      return { body: `${embedded.code}//# sourceMappingURL=${fileName}.map\n`, contentType: "text/javascript; charset=utf-8" };
    }
  }
  const sourceRelative = normalized.replace(/\.js(?:\.map)?$/u, ".vel").replace(/\.vel\.map$/u, ".vel");
  const module = project.modules.find((item) => item.relativePath === sourceRelative);
  if (!module) return null;
  if (pathname.endsWith(".js.map")) return { body: module.result.sourceMap ?? "", contentType: "application/json; charset=utf-8" };
  if (pathname.endsWith(".js")) {
    const fileName = normalized.split("/").at(-1) ?? "module.js";
    const code = revision ? addRevisionToImports(project, module, module.result.code ?? "", revision) : module.result.code ?? "";
    return { body: `${code}//# sourceMappingURL=${fileName}.map\n`, contentType: "text/javascript; charset=utf-8" };
  }
  return null;
}

function addRevisionToImports(project: ProjectResult, module: ProjectModule, code: string, revision: string): string {
  const encoded = encodeURIComponent(revision);
  const relativeImports = addRevisionToRelativeJavaScriptImports(code, revision);
  return relativeImports.replace(/(\bfrom\s+["']|\bimport\s+["'])([^."'][^"']*)(["'])/gu, (match, prefix: string, source: string, suffix: string) => {
    const targetPath = project.velarImports.get(projectImportKey(module.inputPath, source));
    if (!targetPath) return match;
    const target = project.modules.find((item) => item.inputPath === targetPath);
    if (!target) return match;
    const route = withBase(frameworkBase(project.framework), target.relativePath.replace(/\.vel$/u, ".js").replaceAll("\\", "/"));
    return `${prefix}${route}?velar=${encoded}${suffix}`;
  });
}

function addRevisionToRelativeJavaScriptImports(code: string, revision: string): string {
  const encoded = encodeURIComponent(revision);
  return code.replace(/(\bfrom\s+["']|\bimport\s+["'])(\.[^"']+\.js)(["'])/gu, `$1$2?velar=${encoded}$3`);
}

export async function publicAsset(publicRoot: string, pathname: string): Promise<{ readonly path: string; readonly sizeBytes: number; readonly contentType: string } | null> {
  const relativePath = pathname.replace(/^\/+|\/+$/gu, "");
  if (!relativePath || relativePath.split(/[\\/]/u).includes("..")) return null;
  const root = resolve(publicRoot);
  const path = resolve(root, relativePath);
  const pathFromRoot = relative(root, path);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || pathFromRoot.startsWith("/") || pathFromRoot.startsWith("\\")) return null;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    return { path, sizeBytes: metadata.size, contentType: contentTypeFor(relativePath) };
  } catch {
    return null;
  }
}

function withBase(base: string, path: string): string {
  return `${base}${path.replace(/^\/+/, "")}`;
}

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".ico": return "image/x-icon";
    default: return "application/octet-stream";
  }
}
