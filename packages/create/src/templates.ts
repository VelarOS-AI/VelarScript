import { basename } from "node:path";
import type { VelarProjectTemplate } from "./types.ts";

export function createTemplateFiles(
  template: VelarProjectTemplate,
  root: string,
  version: string,
  formatVersion: number,
): ReadonlyMap<string, string> {
  const displayName = basename(root);
  const name = packageName(displayName);
  const dependencyVersion = version.includes("-") ? version : `^${version}`;
  return template === "library"
    ? libraryTemplate(name, displayName, dependencyVersion, formatVersion)
    : template === "component"
      ? componentTemplate(name, displayName, dependencyVersion, formatVersion)
      : template === "docs"
        ? docsTemplate(name, displayName, dependencyVersion, formatVersion)
        : template === "desktop"
          ? desktopTemplate(name, displayName, dependencyVersion, formatVersion)
          : template === "node"
            ? nodeTemplate(name, displayName, dependencyVersion, formatVersion)
            : webTemplate(name, displayName, dependencyVersion, formatVersion);
}

function webTemplate(name: string, displayName: string, version: string, formatVersion: number): ReadonlyMap<string, string> {
  const files = new Map([
    ...commonWebFiles(name, displayName, version, formatVersion),
    ["README.md", `# ${displayName}\n\nA VelarScript Web starter for the JavaScript ecosystem.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nEdit \`src/app.vel\` to begin. Before sharing a production build, run \`npm run validate\`.\n`],
    ["src/app.vel", `import {Head} from "velar/web"\n\nexport const appName = "${escapeVelarString(displayName)}"\nexport const frameworkPosition = "The first extensible language framework for the AI era, built for the JavaScript ecosystem."\n\nconst ink = rgb(24, 24, 24)\nconst inkSoft = rgb(92, 92, 92)\nconst paper = rgb(247, 247, 244)\nconst white = rgb(255, 255, 255)\n\nconst pageLook = look:\n    display = "grid"\n    placeItems = "center"\n    minHeight = 100vh\n    padding = spacing(32px, 20px)\n    color = ink\n    background = paper\n    fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif"\n\nconst helloLook = look:\n    display = "grid"\n    justifyItems = "center"\n    gap = 20px\n    width = 100%\n    maxWidth = 680px\n    textAlign = "center"\n\nconst markLook = look:\n    width = 132px\n    height = "auto"\n\nconst eyebrowLook = look:\n    margin = 0\n    color = inkSoft\n    fontWeight = 700\n    letterSpacing = 0.12em\n    textTransform = "uppercase"\n\nconst titleLook = look:\n    margin = 0\n    fontSize = clamp(2.5rem, 8vw, 5rem)\n    lineHeight = 0.96\n    letterSpacing = -0.06em\n\nconst leadLook = look:\n    maxWidth = 560px\n    margin = 0\n    color = inkSoft\n    fontSize = 1.05rem\n    lineHeight = 1.65\n\nconst buttonLook = look:\n    padding = spacing(11px, 18px)\n    border = border(0px, color("transparent"))\n    borderRadius = 9999px\n    color = white\n    background = ink\n    fontWeight = 700\n    cursor = "pointer"\n\nexport component App:\n    state count = 0\n\n    def increment() -> null:\n        count += 1\n\n    return <main class="page" look={pageLook}>\n        <Head title={appName} description={frameworkPosition} image="/velarscript-mark.svg" themeColor="#f7f7f4" />\n        <section class="hello" look={helloLook}>\n            <img look={markLook} src="/velarscript-mark.svg" alt="VelarScript" />\n            <p class="eyebrow" look={eyebrowLook}>VelarScript Web</p>\n            <h1 look={titleLook}>Hello, {appName}</h1>\n            <p look={leadLook}>{frameworkPosition}</p>\n            <button look={buttonLook} type="button" on:click={increment}>Count is {count}</button>\n        </section>\n    </main>\n`],
    ["src/app.test.vel", `import {expect} from "velar/test"\nimport {appName, frameworkPosition} from "./app.vel"\n\ndef test_application_contract() -> null:\n    expect(appName).toBe("${escapeVelarString(displayName)}")\n    expect(frameworkPosition).toContain("JavaScript ecosystem")\n`],
    ["src/app.browser.test.vel", `import {expect} from "velar/test"\nimport {browser} from "velar/web-test"\n\nasync def test_home_page() -> null:\n    await browser.open("/")\n    expect(await browser.text("h1")).toBe("Hello, ${escapeVelarString(displayName)}")\n    expect(await browser.attribute("img", "src")).toBe("/velarscript-mark.svg")\n    await browser.click("button")\n    await browser.waitForText("button", "Count is 1")\n`],
  ]);
  files.set("src/app.vel", `import {border, clamp, color, rgb, spacing} from "velar/look"\n${files.get("src/app.vel")!}`);
  return files;
}

function nodeTemplate(name: string, displayName: string, version: string, formatVersion: number): ReadonlyMap<string, string> {
  const publicName = escapeHtml(displayName);
  return new Map([
    [".gitignore", "node_modules/\ndist/\n.velar/\n"],
    ...brandPublicFiles(),
    ["package.json", json({
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        check: "velar check",
        format: "velar format",
        "format:check": "velar format --check",
        dev: "velar run",
        start: "velar run",
        test: "velar test",
        build: "velar build",
        validate: "npm run format:check && npm run check && npm test && npm run build",
      },
      dependencies: { "@velarscript/node": version },
      devDependencies: { "@velarscript/cli": version },
    })],
    ["velar.json", json({
      formatVersion,
      entry: "src/main.vel",
      outDir: "dist",
      publicDir: "public",
      extensions: [],
    })],
    ["README.md", `# ${displayName}\n\nA VelarScript Node starter modeled on the familiar Node.js Hello World server.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nOpen \`http://127.0.0.1:3000\`. Edit \`src/app.vel\` to add routes and \`src/main.vel\` to change the host or port.\n`],
    ["public/index.html", `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${publicName} · VelarScript Node</title>
    <style>
      :root { color: #181818; background: #f7f7f4; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
      main { display: grid; justify-items: center; gap: 18px; max-width: 640px; text-align: center; }
      img { width: 120px; height: auto; }
      small { color: #5c5c5c; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(2.5rem, 8vw, 5rem); line-height: .96; letter-spacing: -.06em; }
      p { max-width: 560px; margin: 0; color: #5c5c5c; line-height: 1.65; }
      code { color: #181818; }
    </style>
  </head>
  <body>
    <main>
      <img src="/velarscript-mark.svg" alt="VelarScript" />
      <small>VelarScript Node</small>
      <h1>Hello from ${publicName}</h1>
      <p>The first extensible language framework for the AI era, built for the JavaScript ecosystem.</p>
      <p>Try the checked JSON endpoint at <code>/api/hello</code>.</p>
    </main>
  </body>
</html>
`],
    ["src/app.vel", `import {ServeRequest, ServeResponse, fileResponse} from "velar/serve"

export const appName = "${escapeVelarString(displayName)}"
export const greeting = "Hello from VelarScript Node"

export async def handle(request: ServeRequest) -> ServeResponse:
    if request.path == "/api/hello":
        return {status: 200, json: {message: greeting, target: "node"}}
    return fileResponse(root = "public", path = request.path, fallback = "index.html")
`],
    ["src/main.vel", `import {serve} from "velar/serve"
import {appName, handle} from "./app.vel"

const server = await serve(handle, port = 3000)
print(f"{appName} is running at http://127.0.0.1:{server.port}")
`],
    ["src/app.test.vel", `import {expect} from "velar/test"
import {appName, greeting} from "./app.vel"

def test_node_application_contract() -> null:
    expect(appName).toBe("${escapeVelarString(displayName)}")
    expect(greeting).toBe("Hello from VelarScript Node")
`],
  ]);
}

function desktopTemplate(name: string, displayName: string, version: string, formatVersion: number): ReadonlyMap<string, string> {
  const identifier = applicationIdentifier(name);
  const files = new Map([
    [".gitignore", "node_modules/\ndist/\n.velar/\n"],
    ...brandPublicFiles(),
    ["package.json", json({
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        check: "velar check",
        format: "velar format",
        "format:check": "velar format --check",
        dev: "velar dev",
        test: "velar test",
        "test:browser": "velar test --browser=all",
        build: "velar build",
        package: "velar package",
        validate: "npm run format:check && npm run check && npm test && npm run build",
      },
      dependencies: { "@velarscript/desktop": version },
      devDependencies: { "@velarscript/cli": version },
    })],
    ["velar.json", json({
      formatVersion,
      entry: "src/main.vel",
      outDir: "dist/renderer",
      publicDir: "public",
      extensions: ["@velarscript/desktop"],
      desktop: {
        productName: displayName,
        identifier: `dev.velarscript.${identifier}`,
        window: { width: 1040, height: 720, minWidth: 640, minHeight: 480 },
        permissions: { files: [], processes: [], network: [], environment: [], secrets: [] },
      },
    })],
    ["README.md", `# ${displayName}\n\nA single-project VelarScript Desktop starter backed by the system WebView.\n\n\`\`\`sh\nnpm install\nnpm run dev\nnpm run package\n\`\`\`\n\n\`npm run dev\` previews the renderer. On macOS, \`npm run package\` creates a native \`.app\` using the default VelarScript application icon.\n`],
    ["src/main.vel", `import {App} from "./app.vel"

mount(<App />, "#app")
`],
    ["src/app.vel", `import {Head} from "velar/web"

export const appName = "${escapeVelarString(displayName)}"
export const desktopModel = "One VelarScript project, one system WebView, no renderer/main split."

const ink = rgb(24, 24, 24)
const inkSoft = rgb(92, 92, 92)
const paper = rgb(247, 247, 244)
const white = rgb(255, 255, 255)

const pageLook = look:
    display = "grid"
    placeItems = "center"
    minHeight = 100vh
    padding = spacing(32px, 20px)
    color = ink
    background = paper
    fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif"

const helloLook = look:
    display = "grid"
    justifyItems = "center"
    gap = 20px
    width = 100%
    maxWidth = 680px
    textAlign = "center"

const markLook = look:
    width = 132px
    height = "auto"

const eyebrowLook = look:
    margin = 0
    color = inkSoft
    fontWeight = 700
    letterSpacing = 0.12em
    textTransform = "uppercase"

const titleLook = look:
    margin = 0
    fontSize = clamp(2.5rem, 8vw, 5rem)
    lineHeight = 0.96
    letterSpacing = -0.06em

const leadLook = look:
    maxWidth = 560px
    margin = 0
    color = inkSoft
    fontSize = 1.05rem
    lineHeight = 1.65

const buttonLook = look:
    padding = spacing(11px, 18px)
    border = border(0px, color("transparent"))
    borderRadius = 9999px
    color = white
    background = ink
    fontWeight = 700
    cursor = "pointer"

export component App:
    state count = 0

    def increment() -> null:
        count += 1

    return <main class="page" look={pageLook}>
        <Head title={appName} description={desktopModel} image="/velarscript-mark.svg" themeColor="#f7f7f4" />
        <section class="hello" look={helloLook}>
            <img look={markLook} src="/velarscript-mark.svg" alt="VelarScript" />
            <p class="eyebrow" look={eyebrowLook}>VelarScript Desktop</p>
            <h1 look={titleLook}>Hello, {appName}</h1>
            <p look={leadLook}>{desktopModel}</p>
            <button look={buttonLook} type="button" on:click={increment}>Count is {count}</button>
        </section>
    </main>
`],
    ["src/app.test.vel", `import {expect} from "velar/test"
import {appName, desktopModel} from "./app.vel"

def test_desktop_application_contract() -> null:
    expect(appName).toBe("${escapeVelarString(displayName)}")
    expect(desktopModel).toContain("system WebView")
`],
    ["src/app.browser.test.vel", `import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_desktop_home() -> null:
    await browser.open("/")
    expect(await browser.text("h1")).toBe("Hello, ${escapeVelarString(displayName)}")
    expect(await browser.attribute("img", "src")).toBe("/velarscript-mark.svg")
    await browser.click("button")
    await browser.waitForText("button", "Count is 1")
`],
  ]);
  files.set("src/app.vel", `import {border, clamp, color, rgb, spacing} from "velar/look"\n${files.get("src/app.vel")!}`);
  return files;
}

function docsTemplate(name: string, displayName: string, version: string, formatVersion: number): ReadonlyMap<string, string> {
  const files = new Map([
    ...commonWebFiles(name, displayName, version, formatVersion),
    ["README.md", `# ${displayName}\n\nA routed documentation site written in VelarScript.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nAfter bootstrap, use \`npm exec velar -- add <package>\`, \`remove\`, and \`update\` for project-aware dependency changes. Edit the navigation and page metadata in \`src/content.vel\`.\n`],
    ["src/content.vel", `export type DocPage:\n    path: string\n    label: string\n    title: string\n    summary: string\n\nexport const pages: List<DocPage> = [\n    {path: "/", label: "Overview", title: "${escapeVelarString(displayName)}", summary: "A documentation site built entirely with VelarScript."},\n    {path: "/guide", label: "Guide", title: "Guide", summary: "Start with one component, then grow through typed modules and the Web framework."},\n]\n\nexport def pageTitle(path: string) -> string:\n    for page in pages:\n        if page.path == path:\n            return page.title\n    return "Page not found"\n`],
    ["src/styles.vel", `export const ink = rgb(17, 18, 22)\nexport const inkSoft = rgb(94, 96, 102)\nexport const paper = rgb(247, 245, 240)\nexport const paperPure = rgb(251, 250, 247)\nexport const sea = rgb(68, 123, 159)\nexport const seaSoft = rgba(68, 123, 159, 0.12)\nexport const rule = rgba(17, 18, 22, 0.14)\n\nexport const documentLook = look:\n    display = "grid"\n    gap = 18px\n    width = 100%\n    maxWidth = 824px\n    padding = spacing(72px, 32px)\n\nexport const eyebrowLook = look:\n    margin = 0\n    color = sea\n    fontWeight = 700\n    textTransform = "uppercase"\n    letterSpacing = 0.08em\n\nexport const titleLook = look:\n    margin = 0\n    fontSize = clamp(3rem, 8vw, 6rem)\n    lineHeight = 0.96\n    letterSpacing = -0.06em\n\nexport const leadLook = look:\n    margin = 0\n    color = inkSoft\n    fontSize = 1.2rem\n    lineHeight = 1.65\n\nexport const linkLook = look:\n    color = sea\n    fontWeight = 700\n\nexport const codeLook = look:\n    overflow = "auto"\n    padding = 20px\n    border = border(1px, rule)\n    borderRadius = 12px\n    background = paperPure\n`],
    ["src/pages/home.vel", `import {Head, Link} from "velar/web"\nimport {pages} from "../content.vel"\nimport {documentLook, eyebrowLook, leadLook, linkLook, titleLook} from "../styles.vel"\n\nexport component Home:\n    const page = pages[0]\n\n    return <main class="document" look={documentLook}>\n        <Head title={page.title} description={page.summary} themeColor="#f7f5f0" />\n        <p class="eyebrow" look={eyebrowLook}>VelarScript documentation</p>\n        <h1 look={titleLook}>{page.title}</h1>\n        <p class="lead" look={leadLook}>{page.summary}</p>\n        <Link to="/guide" look={linkLook}>Read the guide</Link>\n    </main>\n`],
    ["src/pages/guide.vel", `import {Head} from "velar/web"\nimport {pages} from "../content.vel"\nimport {codeLook, documentLook, eyebrowLook, leadLook, titleLook} from "../styles.vel"\n\nconst example = "export component Hello(name: string):\\n    return <h1>Hello {name}</h1>"\n\nexport component Guide:\n    const page = pages[1]\n\n    return <main class="document" look={documentLook}>\n        <Head title={page.title} description={page.summary} themeColor="#f7f5f0" />\n        <p class="eyebrow" look={eyebrowLook}>Guide</p>\n        <h1 look={titleLook}>{page.title}</h1>\n        <p class="lead" look={leadLook}>{page.summary}</p>\n        <pre look={codeLook}><code>{example}</code></pre>\n    </main>\n`],
    ["src/app.vel", `import {NavLink, RouteContext, Router, route} from "velar/web"\nimport {pages} from "./content.vel"\nimport {documentLook, eyebrowLook, ink, inkSoft, paper, paperPure, rule, seaSoft, titleLook} from "./styles.vel"\nimport {Home} from "./pages/home.vel"\nimport {Guide} from "./pages/guide.vel"\n\ncomponent NotFound(route: RouteContext):\n    return <main class="document" look={documentLook}><p class="eyebrow" look={eyebrowLook}>404</p><h1 look={titleLook}>Page not found</h1><p>No document matches {route.path}.</p></main>\n\nconst routes = [route("/", Home), route("/guide", Guide)]\n\nconst shellLook = look:\n    display = "grid"\n    gridTemplateColumns = tracks(240px, minmax(0px, 1fr))\n    minHeight = 100vh\n    color = ink\n    background = paper\n    fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif"\n\n    if viewport.width <= 720px:\n        gridTemplateColumns = tracks(1fr)\n\nconst navLook = look:\n    display = "grid"\n    alignContent = "start"\n    gap = 8px\n    padding = spacing(28px, 20px)\n    borderRight = border(1px, rule)\n    background = paperPure\n\n    if viewport.width <= 720px:\n        flexDirection = "column"\n        justifyContent = "start"\n        borderRight = border(0px, color("transparent"))\n        borderBottom = border(1px, rule)\n\nconst brandLook = look:\n    marginBottom = 16px\n\n    if viewport.width <= 720px:\n        margin = spacing(8px, 12px, 0px, 0px)\n\nconst navLinkLook = look:\n    padding = spacing(8px, 10px)\n    borderRadius = 8px\n    color = inkSoft\n    textDecoration = "none"\n\n    if @current:\n        color = ink\n        background = seaSoft\n\nexport component App:\n    return <div class="shell" look={shellLook}>\n        <nav look={navLook} aria-label="Documentation">\n            <strong look={brandLook}>${escapeVelarString(displayName)}</strong>\n            {pages.map(page => <NavLink key={page.path} to={page.path} exact={true} look={navLinkLook}>{page.label}</NavLink>)}\n        </nav>\n        <Router routes={routes} fallback={NotFound} />\n    </div>\n`],
    ["src/content.test.vel", `import {expect} from "velar/test"\nimport {pageTitle, pages} from "./content.vel"\n\ndef test_documentation_navigation() -> null:\n    expect(pages).toHaveLength(2)\n    expect(pageTitle("/guide")).toBe("Guide")\n    expect(pageTitle("/missing")).toBe("Page not found")\n`],
    ["src/app.browser.test.vel", `import {expect} from "velar/test"\nimport {browser} from "velar/web-test"\n\nasync def test_guide_route() -> null:\n    await browser.open("/guide")\n    expect(await browser.text("h1")).toBe("Guide")\n    expect(await browser.text("nav")).toContain("Overview")\n`],
  ]);
  files.set("src/styles.vel", `import {border, clamp, rgb, rgba, spacing} from "velar/look"\n\n${files.get("src/styles.vel")!}`);
  files.set("src/app.vel", `import {border, color, minmax, spacing, tracks} from "velar/look"\n${files.get("src/app.vel")!}`);
  return files;
}

function libraryTemplate(name: string, displayName: string, version: string, formatVersion: number): ReadonlyMap<string, string> {
  const packageManifest = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    files: ["src"],
    velar: { entry: "src/index.vel" },
    scripts: {
      check: "velar check",
      format: "velar format",
      "format:check": "velar format --check",
      test: "velar test",
      build: "velar build",
      validate: "npm run format:check && npm run check && npm test && npm run build",
    },
    devDependencies: {
      "@velarscript/cli": version,
    },
  };
  return new Map([
    [".gitignore", "node_modules/\ndist/\n.velar/\n"],
    ["package.json", json(packageManifest)],
    ["velar.json", json({
      formatVersion,
      entry: "src/index.vel",
      outDir: "dist",
      publicDir: "public",
      extensions: [],
    })],
    ["README.md", `# ${displayName}\n\nA reusable VelarScript source library.\n\n\`\`\`sh\nnpm install\nnpm run validate\n\`\`\`\n\nAfter bootstrap, use \`npm exec velar -- add <package>\`, \`remove\`, and \`update\` for project-aware dependency changes. The package is private by default. Remove \`private\` only after choosing a public package name, license, and release policy.\n`],
    ["src/index.vel", `export type Greeting:\n    message: string\n    recipient: string\n\nexport def greet(name: string) -> Greeting:\n    const recipient = name.trim()\n    assert recipient != "" else "A greeting requires a name"\n    return {message: f"Hello, {recipient}!", recipient: recipient}\n`],
    ["src/index.test.vel", `import {expect} from "velar/test"\nimport {greet} from "./index.vel"\n\ndef test_greeting() -> null:\n    const greeting = greet("Velar")\n    expect(greeting.message).toBe("Hello, Velar!")\n    expect(greeting.recipient).toBe("Velar")\n\ndef test_greeting_rejects_blank_names() -> null:\n    expect(() => greet("   ")).toThrow()\n`],
  ]);
}

function componentTemplate(name: string, displayName: string, version: string, formatVersion: number): ReadonlyMap<string, string> {
  const packageManifest = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    files: ["src/index.vel", "README.md"],
    velar: { entry: "src/index.vel" },
    scripts: {
      check: "velar check",
      format: "velar format",
      "format:check": "velar format --check",
      test: "velar test",
      "test:browser": "velar test --browser",
      build: "velar build",
      verify: "velar verify",
      validate: "npm run format:check && npm run check && npm test && npm run build && npm run verify",
    },
    peerDependencies: {
      "@velarscript/web": version,
    },
    devDependencies: {
      "@velarscript/cli": version,
      "@velarscript/web": version,
    },
  };
  const files = new Map([
    [".gitignore", "node_modules/\ndist/\n.velar/\n"],
    ...brandPublicFiles(),
    ["package.json", json(packageManifest)],
    ["velar.json", json({
      formatVersion,
      entry: "src/demo.vel",
      outDir: "dist",
      publicDir: "public",
      extensions: ["@velarscript/web"],
      web: {
        title: `${displayName} component preview`,
        base: "/",
        publicConfig: {},
        build: { sourceMaps: false },
        security: { contentSecurityPolicy: true, connectSources: [], imageSources: [] },
        deployment: { spaFallback: true },
      },
    })],
    ["README.md", `# ${displayName}\n\nA reusable VelarScript Web component source package.\n\n\`\`\`sh\nnpm install\nnpm run validate\nnpm run test:browser\n\`\`\`\n\nThe published package entry is \`src/index.vel\`; \`src/demo.vel\` is the local preview application. The package is private by default. Remove \`private\` only after choosing a public package name, license, and release policy.\n`],
    ["src/index.vel", `import {domId} from "velar/web"\n\nexport type CardContent:\n    title: string\n    body: string\n\nexport const exampleContent: CardContent = {title: "Built with VelarScript", body: "A reusable component ships as checked VelarScript source."}\n\nconst cardLook = look:\n    display = "grid"\n    gap = 10px\n    padding = 20px\n    border = border(1px, rgba(17, 18, 22, 0.14))\n    borderRadius = 14px\n    background = rgb(251, 250, 247)\n\nconst titleLook = look:\n    margin = 0\n\nconst bodyLook = look:\n    margin = 0\n    color = rgb(94, 96, 102)\n    lineHeight = 1.6\n\nexport component InfoCard(content: CardContent):\n    const titleId = domId("info-card-title")\n    return <article class="card" look={cardLook} aria-labelledby={titleId}><h2 look={titleLook} id={titleId}>{content.title}</h2><p look={bodyLook}>{content.body}</p></article>\n`],
    ["src/demo.vel", `import {InfoCard, exampleContent} from "./index.vel"\n\nmount(<main><InfoCard content={exampleContent} /></main>, "#app")\n`],
    ["src/index.test.vel", `import {expect} from "velar/test"\nimport {exampleContent} from "./index.vel"\n\ndef test_component_content_contract() -> null:\n    expect(exampleContent.title).toBe("Built with VelarScript")\n    expect(exampleContent.body).toContain("checked VelarScript source")\n`],
    ["src/demo.browser.test.vel", `import {expect} from "velar/test"\nimport {browser} from "velar/web-test"\n\nasync def test_component_preview() -> null:\n    await browser.open("/")\n    expect(await browser.text("article h2")).toBe("Built with VelarScript")\n    expect(await browser.text("article p")).toContain("reusable component")\n    const titleId = await browser.attribute("article", "aria-labelledby")\n    expect(titleId != null).toBe(true)\n    if titleId:\n        expect(titleId).toContain("info-card-title-")\n        expect(await browser.attribute("article h2", "id")).toBe(titleId)\n`],
  ]);
  files.set("src/index.vel", `import {border, rgb, rgba} from "velar/look"\n${files.get("src/index.vel")!}`);
  return files;
}

function commonWebFiles(
  name: string,
  displayName: string,
  version: string,
  formatVersion: number,
): readonly (readonly [string, string])[] {
  return [
    [".gitignore", "node_modules/\ndist/\n.velar/\n"],
    ...brandPublicFiles(),
    ["package.json", json({
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        check: "velar check",
        format: "velar format",
        "format:check": "velar format --check",
        dev: "velar dev",
        test: "velar test",
        "test:browser": "velar test --browser",
        build: "velar build",
        verify: "velar verify",
        preview: "velar preview",
        "verify:deployment": "velar verify-deployment",
        validate: "npm run format:check && npm run check && npm test && npm run build && npm run verify",
      },
      dependencies: { "@velarscript/web": version },
      devDependencies: { "@velarscript/cli": version },
    })],
    ["velar.json", json({
      formatVersion,
      entry: "src/main.vel",
      outDir: "dist",
      publicDir: "public",
      extensions: ["@velarscript/web"],
      web: {
        title: displayName,
        base: "/",
        publicConfig: {},
        build: { sourceMaps: false },
        security: { contentSecurityPolicy: true, connectSources: [], imageSources: [] },
        deployment: { spaFallback: true },
      },
    })],
    ["src/main.vel", `import {App} from "./app.vel"\n\nmount(<App />, "#app")\n`],
  ];
}

const VELARSCRIPT_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="85 113 346 290" role="img" aria-labelledby="title">
  <title id="title">VelarScript</title>
  <g fill="#181818">
    <path d="M97 128C98 126 99 125 102 125h94c9 0 15 4 19 13l42 81c6 10 16 17 27 24 12 9 18 21 17 35 0 8-4 16-9 24l-55 81L98 134c-2-3-2-5-1-6Z"/>
    <path d="M271 180c3-11 10-22 17-29l17-17c6-6 11-9 19-9h95l-86 153c1-9-1-19-6-27-4-7-12-14-19-20l-25-22c-10-8-14-18-12-29Z"/>
    <path d="m237 383 82-81-46 84c-5 4-11 5-18 5s-13-3-18-8Z"/>
  </g>
</svg>
`;

function brandPublicFiles(): readonly (readonly [string, string])[] {
  return [["public/velarscript-mark.svg", VELARSCRIPT_MARK_SVG]];
}

function packageName(value: string): string {
  const normalized = value.toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 214);
  if (!normalized || normalized === "node_modules" || normalized === "favicon.ico") return "velar-app";
  return normalized;
}

function applicationIdentifier(value: string): string {
  return value.toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63) || "app";
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeVelarString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
