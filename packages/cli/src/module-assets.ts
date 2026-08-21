import { lstat } from "node:fs/promises";
import { extname, posix, relative, resolve } from "node:path";
import { projectImportKey, type ProjectModule, type ProjectResult } from "./project.ts";
import { frameworkBase } from "./framework-host.ts";
import { jsonResourceModule } from "./resource-output.ts";

export function moduleOutput(project: ProjectResult, pathname: string, revision: string | null = null): { readonly body: string; readonly contentType: string } | null {
  const normalized = pathname.replace(/^\//u, "");
  for (const resource of project.resources ?? []) {
    if (!resource.source.startsWith(".")) continue;
    const owner = project.modules.find((module) => module.inputPath === resource.importerPath);
    if (!owner) continue;
    const route = posix.normalize(posix.join(
      posix.dirname(owner.relativePath.replaceAll("\\", "/")),
      `${resource.source}.js`,
    ));
    if (normalized === route) return { body: jsonResourceModule(resource.content), contentType: "text/javascript; charset=utf-8" };
  }
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
  let output = "";
  let cursor = 0;
  for (const site of importSpecifierSites(code)) {
    const revised = revisedSpecifier(project, module, site.source, encoded);
    if (revised === null) continue;
    output += code.slice(cursor, site.start) + site.quote + revised + site.quote;
    cursor = site.end;
  }
  return cursor === 0 ? code : output + code.slice(cursor);
}

function revisedSpecifier(project: ProjectResult, module: ProjectModule, source: string, encoded: string): string | null {
  // An escaped or already-queried specifier is left alone: the revision is a
  // cache-buster, never a reason to rewrite a specifier we cannot read plainly.
  if (source.includes("\\") || source.includes("?")) return null;
  if (source.startsWith(".")) {
    return source.length > ".js".length && source.endsWith(".js") ? `${source}?velar=${encoded}` : null;
  }
  const targetPath = project.velarImports.get(projectImportKey(module.inputPath, source));
  if (!targetPath) return null;
  const target = project.modules.find((item) => item.inputPath === targetPath);
  if (!target) return null;
  const route = withBase(frameworkBase(project.framework), target.relativePath.replace(/\.vel$/u, ".js").replaceAll("\\", "/"));
  return `${route}?velar=${encoded}`;
}

export interface ImportSpecifierSite {
  /** Offset of the opening quote of the specifier literal. */
  readonly start: number;
  /** Offset just past its closing quote. */
  readonly end: number;
  readonly quote: string;
  readonly source: string;
}

/**
 * The revision query is a cache-buster for the browser's module registry, so it
 * belongs on an import specifier and nowhere else. A regular expression over the
 * emitted text cannot honour that: it rewrote import-looking text inside a user
 * string literal — changing a program's own data on every hot reload — while
 * `\bimport\s+["']` never matched `import("./page.js")` at all, so a lazily
 * imported module kept its revision-free URL and the browser's module map served
 * the pre-edit code for the whole session. This scanner walks the emitted
 * JavaScript once, tracking strings, templates, comments and regular
 * expressions, and reports only the specifiers in real import position:
 * `from "…"`, a bare `import "…"`, and `import("…")`. It is exported because the
 * rule it enforces has to be tested against JavaScript the compiler does not
 * emit today but a `js`-authored dependency can.
 */
export function importSpecifierSites(code: string): readonly ImportSpecifierSite[] {
  const sites: ImportSpecifierSite[] = [];
  const templateBraces: number[] = [];
  let mode: "code" | "template" = "code";
  let braceDepth = 0;
  let previous = "";
  let expecting: "none" | "import" | "importCall" | "from" = "none";
  let index = 0;
  while (index < code.length) {
    const character = code[index]!;
    if (mode === "template") {
      if (character === "\\") { index += 2; continue; }
      if (character === "`") { mode = "code"; previous = "template"; index += 1; continue; }
      if (character === "$" && code[index + 1] === "{") {
        templateBraces.push(braceDepth);
        mode = "code";
        previous = "{";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (/\s/u.test(character)) { index += 1; continue; }
    if (character === "/" && code[index + 1] === "/") {
      const end = code.indexOf("\n", index);
      index = end === -1 ? code.length : end + 1;
      continue;
    }
    if (character === "/" && code[index + 1] === "*") {
      const end = code.indexOf("*/", index + 2);
      index = end === -1 ? code.length : end + 2;
      continue;
    }
    if (character === "/" && regularExpressionAllowedAfter(previous)) {
      index = skipRegularExpression(code, index);
      previous = "regex";
      expecting = "none";
      continue;
    }
    if (character === "\"" || character === "'") {
      const end = skipString(code, index, character);
      if (expecting !== "none") {
        sites.push({ start: index, end, quote: character, source: code.slice(index + 1, end - 1) });
      }
      previous = "string";
      expecting = "none";
      index = end;
      continue;
    }
    if (character === "`") { mode = "template"; expecting = "none"; index += 1; continue; }
    if (character === "{") { braceDepth += 1; previous = "{"; expecting = "none"; index += 1; continue; }
    if (character === "}") {
      if (templateBraces.length > 0 && braceDepth === templateBraces.at(-1)) {
        templateBraces.pop();
        mode = "template";
        index += 1;
        continue;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      previous = "}";
      expecting = "none";
      index += 1;
      continue;
    }
    if (character === "(") {
      expecting = expecting === "import" ? "importCall" : "none";
      previous = "(";
      index += 1;
      continue;
    }
    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (end < code.length && isIdentifierPart(code[end]!)) end += 1;
      const word = code.slice(index, end);
      // `object.import` and `object.from` are member names, not the keyword.
      expecting = previous === "." ? "none" : word === "import" ? "import" : word === "from" ? "from" : "none";
      previous = keywordsBeforeRegularExpression.has(word) ? `keyword:${word}` : "identifier";
      index = end;
      continue;
    }
    if (character >= "0" && character <= "9") {
      let end = index + 1;
      while (end < code.length && /[0-9a-zA-Z._]/u.test(code[end]!)) end += 1;
      previous = "number";
      expecting = "none";
      index = end;
      continue;
    }
    const pair = code.slice(index, index + 2);
    previous = pair === "++" || pair === "--" ? pair : character;
    expecting = "none";
    index += previous.length;
  }
  return sites;
}

const keywordsBeforeRegularExpression = new Set([
  "await", "case", "delete", "do", "else", "in", "instanceof", "new", "of", "return", "throw", "typeof", "void", "yield",
]);

/** A `/` opens a regular expression unless the token before it ended a value. */
function regularExpressionAllowedAfter(previous: string): boolean {
  if (previous === "identifier" || previous === "number" || previous === "string" || previous === "template" || previous === "regex") return false;
  return previous !== ")" && previous !== "]" && previous !== "++" && previous !== "--";
}

function skipString(code: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < code.length) {
    const character = code[index]!;
    if (character === "\\") { index += 2; continue; }
    if (character === quote) return index + 1;
    if (character === "\n") return index;
    index += 1;
  }
  return code.length;
}

function skipRegularExpression(code: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < code.length) {
    const character = code[index]!;
    if (character === "\\") { index += 2; continue; }
    if (character === "\n") return index;
    if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    else if (character === "/" && !inClass) {
      index += 1;
      while (index < code.length && /[a-z]/iu.test(code[index]!)) index += 1;
      return index;
    }
    index += 1;
  }
  return code.length;
}

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_$]|[\u0080-\uFFFF]/u.test(character);
}

function isIdentifierPart(character: string): boolean {
  return /[A-Za-z0-9_$]|[\u0080-\uFFFF]/u.test(character);
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
