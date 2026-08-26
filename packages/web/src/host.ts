import {
  VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION,
  type FrameworkHostArtifacts,
  type FrameworkHostArtifactsInput,
  type FrameworkHostErrorDocumentInput,
  type FrameworkHostExtension,
  type FrameworkRequiredPublicAsset,
  type FrameworkStaticDeployment,
} from "@velarscript/compiler/framework-host";
import { BROWSER_TEST_SOURCE_SUFFIX } from "./browser-test.ts";
import { VELAR_WEB_API_VERSION } from "./compiler.ts";
import { WEB_ICON_TYPES, webIconType, type VelarWebConfig } from "./project-config.ts";

export function createWebArtifacts(input: FrameworkHostArtifactsInput): FrameworkHostArtifacts {
  const config = webConfig(input.config);
  const styles = input.styles;
  const entryModule = withBase(config.base, input.entryPath);
  const reload = input.development ? `
    <script type="module">
      const entry = ${JSON.stringify(entryModule)}
      const eventsUrl = ${JSON.stringify(withBase(config.base, "__velar/events"))}
      const mapUrl = ${JSON.stringify(withBase(config.base, "__velar/map"))}
      let revision = 0
      globalThis.__velarHotDisposers = []
      // D70 rule 180: the runtime detects a frozen reactive read that has since
      // diverged; the development host is what turns its capture site back into
      // a .vel line, through the same map endpoint the error overlay uses. The
      // hook is published before the entry module loads, and its absence is
      // what makes a production build carry none of the detection.
      //
      // Only the reading line is mapped, and only the first frame that is the
      // author's. An error overlay maps a whole stack because a whole stack is
      // what the reader needs there; here the answer is one line, and asking the
      // map endpoint about the compiler's own frames would answer nothing while
      // filling the console with failed requests of its own.
      const reportedFrozenReads = new Set()
      const frozenReadSite = async (stack) => {
        for (const line of String(stack).split("\\n")) {
          if (line.includes("__velar")) continue
          const frame = /https?:\\/\\/[^\\s)]+?\\.js(?:\\?[^:\\s)]*)?:(\\d+):(\\d+)/.exec(line)
          if (!frame) continue
          try {
            const parsed = new URL(frame[0].replace(/:(\\d+):(\\d+)$/, ""))
            const response = await fetch(mapUrl + "?file=" + encodeURIComponent(parsed.pathname) + "&line=" + frame[1] + "&column=" + frame[2])
            if (!response.ok) return frame[0]
            const source = await response.json()
            return source.path + ":" + source.line + ":" + source.column
          } catch { return frame[0] }
        }
        return "an unmapped position"
      }
      globalThis.__velarDevelopmentHooks = {
        frozenRead: async (report) => {
          if (reportedFrozenReads.has(report.stack)) return
          reportedFrozenReads.add(report.stack)
          console.warn("VelarScript: " + report.message + "\\n    read at " + (await frozenReadSite(report.stack)))
        },
      }
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
        reportedFrozenReads.clear()
        for (const dispose of globalThis.__velarHotDisposers.splice(0)) dispose()
        await import(entry + "?velar=" + revision)
      }
      addEventListener("error", async (event) => showError("VelarScript runtime error", await mapStack(event.error || event.message)))
      addEventListener("unhandledrejection", async (event) => showError("VelarScript unhandled rejection", await mapStack(event.reason)))
      try { await load() } catch (error) { showError("VelarScript runtime error", await mapStack(error)) }
      new EventSource(eventsUrl).addEventListener("reload", async (event) => {
        const update = JSON.parse(event.data)
        if (update.errors.length) {
          showError("VelarScript compile error", update.errors.join("\\n\\n"))
          return
        }
        revision = update.revision
        const stylesheet = document.querySelector("[data-velar-styles]")
        if (stylesheet) stylesheet.href = ${JSON.stringify(withBase(config.base, "styles.css"))} + "?velar=" + revision
        try {
          await load()
          hideError()
        } catch (error) {
          showError("VelarScript runtime error", await mapStack(error))
        }
      })
    </script>` : `
    <script type="module" src="${entryModule}"></script>`;
  const stylesheet = input.stylesheetPath && (styles || input.development)
    ? `\n    <link data-velar-styles rel="stylesheet" href="${withBase(config.base, input.stylesheetPath)}">`
    : "";
  const importMap = Object.keys(input.imports).length > 0
    ? `\n    <script type="importmap">${JSON.stringify({ imports: input.imports })}</script>`
    : "";
  const security = !input.development && config.security.contentSecurityPolicy
    ? `\n    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(config))}">\n    <meta name="referrer" content="no-referrer">`
    : "";
  const icon = iconLink(config);
  return {
    entryModule,
    css: styles,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">${security}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${icon}
    <title>${escapeHtml(config.title)}</title>${stylesheet}${importMap}
  </head>
  <body>
    <div id="app"></div>
    ${reload}
  </body>
</html>
`,
  };
}

/**
 * `web.icon` names a file under `publicDir`; the CLI fails the build when that
 * file is absent, so the emitted href always resolves. Without the setting the
 * document keeps `data:,` — an empty inline icon, not an oversight: it stops the
 * browser from requesting `/favicon.ico` on its own, which is the right default
 * offline and under a strict Content-Security-Policy.
 */
function iconLink(config: VelarWebConfig): string {
  if (!config.icon) return `<link rel="icon" href="data:,">`;
  const type = webIconType(config.icon);
  // Manifest validation closes the extension set, so an icon with no media type
  // means the configuration never went through it. Refuse rather than write
  // type="undefined" into a document nobody would think to re-read.
  if (!type) throw new TypeError(`@velarscript/web host cannot type the icon '${config.icon}'; 'web.icon' accepts ${[...WEB_ICON_TYPES.keys()].join(", ")}`);
  return `<link rel="icon" type="${type}" href="${escapeHtml(withBase(config.base, config.icon))}">`;
}

const WEB_STRUCTURAL_STYLES = ":where(*,*::before,*::after){box-sizing:border-box}\n:where(html,body,#app){min-block-size:100%}\n:where(body){margin:0}\n:where(button,input,textarea,select){font:inherit}";

export function webStaticDeployment(config: unknown): FrameworkStaticDeployment {
  const web = webConfig(config);
  return Object.freeze({
    base: web.base,
    spaFallback: web.deployment.spaFallback,
    contentSecurityPolicy: web.security.contentSecurityPolicy ? contentSecurityPolicy(web, true) : null,
  });
}

export function webRequiredPublicAssets(config: unknown): readonly FrameworkRequiredPublicAsset[] {
  const icon = webConfig(config).icon;
  return Object.freeze(icon ? [Object.freeze({ field: "web.icon", path: icon })] : []);
}

export function createWebErrorDocument(input: FrameworkHostErrorDocumentInput): string {
  const config = webConfig(input.config);
  const escaped = input.errors.join("\n\n").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const eventsUrl = withBase(config.base, "__velar/events");
  return `<!doctype html><html><head><meta charset="UTF-8"><title>VelarScript build error</title><style>body{font:15px/1.55 ui-monospace,monospace;margin:0;padding:32px;background:#171717;color:#fee2e2}pre{white-space:pre-wrap}</style></head><body><h1>VelarScript build error</h1><pre>${escaped}</pre><script>new EventSource(${JSON.stringify(eventsUrl)}).addEventListener("reload",(event)=>{if(JSON.parse(event.data).errors.length===0)location.reload()})</script></body></html>`;
}

export const velarFrameworkHost: FrameworkHostExtension = Object.freeze({
  protocolVersion: VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION,
  id: "@velarscript/web",
  capability: "web",
  displayName: "Web",
  target: "browser",
  apiVersion: VELAR_WEB_API_VERSION,
  artifactKind: "velar-web-build",
  base(config: unknown) {
    return webConfig(config).base;
  },
  prepareStyles(_config: unknown, styles: string) {
    return [WEB_STRUCTURAL_STYLES, styles].filter(Boolean).join("\n\n") + "\n";
  },
  createArtifacts: createWebArtifacts,
  createErrorDocument: createWebErrorDocument,
  staticDeployment: webStaticDeployment,
  requiredPublicAssets: webRequiredPublicAssets,
  browserTests: Object.freeze({
    sourceSuffix: BROWSER_TEST_SOURCE_SUFFIX,
    runtimeKey: "velar.browser.test.v1",
  }),
});

function webConfig(value: unknown): VelarWebConfig {
  if (!value || typeof value !== "object") throw new TypeError("@velarscript/web host requires its validated project configuration");
  return value as VelarWebConfig;
}

function contentSecurityPolicy(config: VelarWebConfig, includeFrameAncestors = false): string {
  const connect = ["'self'", ...config.security.connectSources].join(" ");
  const images = ["'self'", "data:", ...config.security.imageSources].join(" ");
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    `img-src ${images}`,
    `connect-src ${connect}`,
    "font-src 'self'",
    "form-action 'self'",
    ...(includeFrameAncestors ? ["frame-ancestors 'none'"] : []),
  ].join("; ");
}

function withBase(base: string, path: string): string {
  return `${base}${path.replace(/^\/+/, "")}`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
