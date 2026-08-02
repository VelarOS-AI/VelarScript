import { lstat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { projectImportKey, type ProjectModule, type ProjectResult } from "./project.ts";
import { contentSecurityPolicy } from "./static-deployment.ts";
import { standardModuleRoute, standardModuleSources } from "./standard-modules.ts";

export interface WebArtifacts {
  readonly entryModule: string;
  readonly css: string;
  readonly html: string;
}

export interface WebArtifactOverrides {
  readonly entryPath?: string;
  readonly stylesheetPath?: string | null;
  readonly includeStandardImports?: boolean;
}

export function createWebArtifacts(project: ProjectResult, development = false, npmImports: Readonly<Record<string, string>> = {}, overrides: WebArtifactOverrides = {}): WebArtifacts | null {
  if (!project.modules.some((module) => module.result.web)) return null;
  const entryModule = withBase(project.webConfig.base, overrides.entryPath ?? relative(project.sourceRoot, project.entryPath).replace(/\.vel$/u, ".js"));
  const css = project.modules.map((module) => module.result.css ?? "").filter(Boolean).join("\n");
  const reload = development ? `
    <script type="module">
      const entry = ${JSON.stringify(entryModule)}
      const eventsUrl = ${JSON.stringify(withBase(project.webConfig.base, "__velar/events"))}
      const mapUrl = ${JSON.stringify(withBase(project.webConfig.base, "__velar/map"))}
      let revision = 0
      globalThis.__velarHotDisposers = []
      const overlay = document.createElement("section")
      overlay.setAttribute("data-velar-error-overlay", "")
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;overflow:auto;background:rgba(15,15,18,.96);color:#fee2e2;padding:28px;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;display:none"
      document.body.append(overlay)
      const showError = (title, message) => {
        overlay.textContent = title + "\\n\\n" + message
        overlay.style.display = "block"
      }
      const hideError = () => {
        overlay.style.display = "none"
        overlay.textContent = ""
      }
      const mapStack = async (value) => {
        const stack = String(value?.stack || value?.message || value)
        const frames = [...stack.matchAll(/https?:\\/\\/[^\\s)]+?\\.js(?:\\?[^:\\s)]*)?:(\\d+):(\\d+)/g)]
        let mapped = stack
        for (const frame of frames) {
          try {
            const parsed = new URL(frame[0].replace(/:(\\d+):(\\d+)$/, ""))
            const response = await fetch(mapUrl + "?file=" + encodeURIComponent(parsed.pathname) + "&line=" + frame[1] + "&column=" + frame[2])
            if (!response.ok) continue
            const source = await response.json()
            mapped = mapped.replace(frame[0], source.path + ":" + source.line + ":" + source.column)
          } catch {}
        }
        return mapped
      }
      const load = async () => {
        for (const dispose of globalThis.__velarHotDisposers.splice(0)) dispose()
        await import(entry + "?velar=" + revision)
      }
      addEventListener("error", async (event) => showError("Velar runtime error", await mapStack(event.error || event.message)))
      addEventListener("unhandledrejection", async (event) => showError("Velar unhandled rejection", await mapStack(event.reason)))
      try { await load() } catch (error) { showError("Velar runtime error", await mapStack(error)) }
      new EventSource(eventsUrl).addEventListener("reload", async (event) => {
        const update = JSON.parse(event.data)
        if (update.errors.length) {
          showError("Velar compile error", update.errors.join("\\n\\n"))
          return
        }
        revision = update.revision
        const stylesheet = document.querySelector("[data-velar-styles]")
        if (stylesheet) stylesheet.href = ${JSON.stringify(withBase(project.webConfig.base, "styles.css"))} + "?velar=" + revision
        try {
          await load()
          hideError()
        } catch (error) {
          showError("Velar runtime error", await mapStack(error))
        }
      })
    </script>` : `
    <script type="module" src="${entryModule}"></script>`;
  const stylesheetPath = overrides.stylesheetPath === undefined ? "styles.css" : overrides.stylesheetPath;
  const stylesheet = stylesheetPath && (css || development) ? `\n    <link data-velar-styles rel="stylesheet" href="${withBase(project.webConfig.base, stylesheetPath)}">` : "";
  const standardImports = overrides.includeStandardImports === false ? {} : Object.fromEntries([...standardModuleSources.keys()].map((source) => [source, withBase(project.webConfig.base, standardModuleRoute(source))]));
  const imports = { ...standardImports, ...npmImports };
  const importMap = Object.keys(imports).length > 0
    ? `\n    <script type="importmap">${JSON.stringify({ imports })}</script>`
    : "";
  const security = !development && project.webConfig.security.contentSecurityPolicy
    ? `\n    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(project.webConfig))}">\n    <meta name="referrer" content="no-referrer">`
    : "";
  return {
    entryModule,
    css,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">${security}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" href="data:,">
    <title>${escapeHtml(project.webConfig.title)}</title>${stylesheet}${importMap}
  </head>
  <body>
    <div id="app"></div>
    ${reload}
  </body>
</html>
`,
  };
}

export function moduleOutput(project: ProjectResult, pathname: string, revision: string | null = null): { readonly body: string; readonly contentType: string } | null {
  const normalized = pathname.replace(/^\//u, "");
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
  const relativeImports = code.replace(/(\bfrom\s+["']|\bimport\s+["'])(\.[^"']+\.js)(["'])/gu, `$1$2?velar=${encoded}$3`);
  return relativeImports.replace(/(\bfrom\s+["']|\bimport\s+["'])([^."'][^"']*)(["'])/gu, (match, prefix: string, source: string, suffix: string) => {
    const targetPath = project.velarImports.get(projectImportKey(module.inputPath, source));
    if (!targetPath) return match;
    const target = project.modules.find((item) => item.inputPath === targetPath);
    if (!target) return match;
    const route = withBase(project.webConfig.base, target.relativePath.replace(/\.vel$/u, ".js").replaceAll("\\", "/"));
    return `${prefix}${route}?velar=${encoded}${suffix}`;
  });
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

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
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
