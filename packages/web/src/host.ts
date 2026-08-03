import {
  VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION,
  type FrameworkHostArtifacts,
  type FrameworkHostArtifactsInput,
  type FrameworkHostErrorDocumentInput,
  type FrameworkHostExtension,
  type FrameworkStaticDeployment,
} from "@velarscript/compiler/framework-host";
import { VELAR_WEB_API_VERSION } from "./compiler.ts";
import type { VelarWebConfig } from "./project-config.ts";

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
        if (stylesheet) stylesheet.href = ${JSON.stringify(withBase(config.base, "styles.css"))} + "?velar=" + revision
        try {
          await load()
          hideError()
        } catch (error) {
          showError("Velar runtime error", await mapStack(error))
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
  return {
    entryModule,
    css: styles,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">${security}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" href="data:,">
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

const WEB_STRUCTURAL_STYLES = ":where(*,*::before,*::after){box-sizing:border-box}\n:where(html,body,#app){min-block-size:100%}\n:where(body){margin:0}\n:where(button,input,textarea,select){font:inherit}";

export function webStaticDeployment(config: unknown): FrameworkStaticDeployment {
  const web = webConfig(config);
  return Object.freeze({
    base: web.base,
    spaFallback: web.deployment.spaFallback,
    adapter: web.deployment.adapter,
    contentSecurityPolicy: web.security.contentSecurityPolicy ? contentSecurityPolicy(web, true) : null,
  });
}

export function createWebErrorDocument(input: FrameworkHostErrorDocumentInput): string {
  const config = webConfig(input.config);
  const escaped = input.errors.join("\n\n").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const eventsUrl = withBase(config.base, "__velar/events");
  return `<!doctype html><html><head><meta charset="UTF-8"><title>Velar build error</title><style>body{font:15px/1.55 ui-monospace,monospace;margin:0;padding:32px;background:#171717;color:#fee2e2}pre{white-space:pre-wrap}</style></head><body><h1>Velar build error</h1><pre>${escaped}</pre><script>new EventSource(${JSON.stringify(eventsUrl)}).addEventListener("reload",(event)=>{if(JSON.parse(event.data).errors.length===0)location.reload()})</script></body></html>`;
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
  sourceMaps(config: unknown) {
    return webConfig(config).build.sourceMaps;
  },
  prepareStyles(_config: unknown, styles: string) {
    return [WEB_STRUCTURAL_STYLES, styles].filter(Boolean).join("\n\n") + "\n";
  },
  createArtifacts: createWebArtifacts,
  createErrorDocument: createWebErrorDocument,
  staticDeployment: webStaticDeployment,
  browserTests: Object.freeze({
    sourceSuffix: ".browser.test.vel",
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
