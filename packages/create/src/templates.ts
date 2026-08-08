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
  if (template === "library") return libraryTemplate(name, displayName, dependencyVersion, formatVersion);
  if (template === "component") return componentTemplate(name, displayName, dependencyVersion, formatVersion);
  return template === "docs"
    ? docsTemplate(name, displayName, dependencyVersion, formatVersion)
    : webTemplate(name, displayName, dependencyVersion, formatVersion);
}

function webTemplate(name: string, displayName: string, version: string, formatVersion: number): ReadonlyMap<string, string> {
  return new Map([
    ...commonWebFiles(name, displayName, version, formatVersion),
    ["README.md", `# ${displayName}\n\nA VelarScript Web application.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nAfter bootstrap, use \`npm exec velar -- add <package>\`, \`remove\`, and \`update\` for project-aware dependency changes. Before sharing a production build, run \`npm run validate\`.\n`],
    ["src/app.vel", `import {Head} from "velar/web"\n\nexport const appName = "${escapeVelarString(displayName)}"\n\nexport type Feature:\n    title: string\n    detail: string\n\nexport const features: List<Feature> = [\n    {title: "VelarScript source", detail: "Readable components, direct state, and controlled Look values in one language."},\n    {title: "Web framework", detail: "Routing, forms, HTTP, storage, and browser APIs are built in."},\n    {title: "Verified output", detail: "Production builds carry a deterministic integrity manifest."},\n]\n\nconst ink = rgb(17, 18, 22)\nconst paper = rgb(247, 245, 240)\nconst paperPure = rgb(251, 250, 247)\nconst sea = rgb(68, 123, 159)\nconst rule = rgba(17, 18, 22, 0.14)\n\nconst featureCardLook = look:\n    padding = 20px\n    border = border(1px, rule)\n    borderRadius = 12px\n    background = paperPure\n\nconst featureTitleLook = look:\n    margin = 0\n\nconst featureTextLook = look:\n    marginBottom = 0\n    lineHeight = 1.6\n\ncomponent FeatureCard(feature: Feature):\n    return <article class="feature-card" look={featureCardLook}><h2 look={featureTitleLook}>{feature.title}</h2><p look={featureTextLook}>{feature.detail}</p></article>\n\nconst pageLook = look:\n    display = "grid"\n    gap = 32px\n    width = 100%\n    minHeight = 100vh\n    maxWidth = 1080px\n    marginInline = "auto"\n    padding = spacing(72px, 20px)\n    color = ink\n    background = paper\n    fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif"\n\nconst eyebrowLook = look:\n    margin = 0\n    color = sea\n    fontWeight = 700\n    letterSpacing = 0.08em\n    textTransform = "uppercase"\n\nconst titleLook = look:\n    maxWidth = 760px\n    margin = 0\n    fontSize = clamp(3rem, 9vw, 7rem)\n    lineHeight = 0.92\n    letterSpacing = -0.07em\n\nconst featuresLook = look:\n    display = "grid"\n    gridTemplateColumns = repeat(3, minmax(0px, 1fr))\n    gap = 12px\n\n    if viewport.width <= 720px:\n        gridTemplateColumns = tracks(1fr)\n\nconst buttonLook = look:\n    justifySelf = "start"\n    padding = spacing(10px, 16px)\n    border = border(0px, color("transparent"))\n    borderRadius = 9999px\n    color = paperPure\n    background = ink\n    fontWeight = 700\n    cursor = "pointer"\n\nexport component App:\n    state count = 0\n\n    def increment():\n        count += 1\n\n    return <main class="page" look={pageLook}>\n        <Head title={appName} description="A VelarScript Web application" themeColor="#f7f5f0" />\n        <header>\n            <p class="eyebrow" look={eyebrowLook}>Built with VelarScript</p>\n            <h1 look={titleLook}>{appName}</h1>\n        </header>\n        <section class="features" look={featuresLook} aria-label="VelarScript features">\n            {features.map(feature => <FeatureCard key={feature.title} feature={feature} />)}\n        </section>\n        <button look={buttonLook} type="button" on:click={increment}>Count: {count}</button>\n    </main>\n`],
    ["src/app.test.vel", `import {expect} from "velar/test"\nimport {appName, features} from "./app.vel"\n\ndef test_application_contract():\n    expect(appName).toBe("${escapeVelarString(displayName)}")\n    expect(features).toHaveLength(3)\n`],
    ["src/app.browser.test.vel", `import {expect} from "velar/test"\nimport {browser} from "velar/web-test"\n\nasync def test_home_page():\n    await browser.open("/")\n    expect(await browser.text("h1")).toBe("${escapeVelarString(displayName)}")\n    await browser.click("button")\n    await browser.waitForText("button", "Count: 1")\n`],
  ]);
}

function docsTemplate(name: string, displayName: string, version: string, formatVersion: number): ReadonlyMap<string, string> {
  return new Map([
    ...commonWebFiles(name, displayName, version, formatVersion),
    ["README.md", `# ${displayName}\n\nA routed documentation site written in VelarScript.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nAfter bootstrap, use \`npm exec velar -- add <package>\`, \`remove\`, and \`update\` for project-aware dependency changes. Edit the navigation and page metadata in \`src/content.vel\`.\n`],
    ["src/content.vel", `export type DocPage:\n    path: string\n    label: string\n    title: string\n    summary: string\n\nexport const pages: List<DocPage> = [\n    {path: "/", label: "Overview", title: "${escapeVelarString(displayName)}", summary: "A documentation site built entirely with VelarScript."},\n    {path: "/guide", label: "Guide", title: "Guide", summary: "Start with one component, then grow through typed modules and the Web framework."},\n]\n\nexport def pageTitle(path: string) -> string:\n    for page in pages:\n        if page.path == path:\n            return page.title\n    return "Page not found"\n`],
    ["src/styles.vel", `export const ink = rgb(17, 18, 22)\nexport const inkSoft = rgb(94, 96, 102)\nexport const paper = rgb(247, 245, 240)\nexport const paperPure = rgb(251, 250, 247)\nexport const sea = rgb(68, 123, 159)\nexport const seaSoft = rgba(68, 123, 159, 0.12)\nexport const rule = rgba(17, 18, 22, 0.14)\n\nexport const documentLook = look:\n    display = "grid"\n    gap = 18px\n    width = 100%\n    maxWidth = 824px\n    padding = spacing(72px, 32px)\n\nexport const eyebrowLook = look:\n    margin = 0\n    color = sea\n    fontWeight = 700\n    textTransform = "uppercase"\n    letterSpacing = 0.08em\n\nexport const titleLook = look:\n    margin = 0\n    fontSize = clamp(3rem, 8vw, 6rem)\n    lineHeight = 0.96\n    letterSpacing = -0.06em\n\nexport const leadLook = look:\n    margin = 0\n    color = inkSoft\n    fontSize = 1.2rem\n    lineHeight = 1.65\n\nexport const linkLook = look:\n    color = sea\n    fontWeight = 700\n\nexport const codeLook = look:\n    overflow = "auto"\n    padding = 20px\n    border = border(1px, rule)\n    borderRadius = 12px\n    background = paperPure\n`],
    ["src/pages/home.vel", `import {Head, Link} from "velar/web"\nimport {pages} from "../content.vel"\nimport {documentLook, eyebrowLook, leadLook, linkLook, titleLook} from "../styles.vel"\n\nexport component Home:\n    const page = pages[0]\n\n    return <main class="document" look={documentLook}>\n        <Head title={page.title} description={page.summary} themeColor="#f7f5f0" />\n        <p class="eyebrow" look={eyebrowLook}>VelarScript documentation</p>\n        <h1 look={titleLook}>{page.title}</h1>\n        <p class="lead" look={leadLook}>{page.summary}</p>\n        <Link to="/guide" look={linkLook}>Read the guide</Link>\n    </main>\n`],
    ["src/pages/guide.vel", `import {Head} from "velar/web"\nimport {pages} from "../content.vel"\nimport {codeLook, documentLook, eyebrowLook, leadLook, titleLook} from "../styles.vel"\n\nconst example = "export component Hello(name: string):\\n    return <h1>Hello {name}</h1>"\n\nexport component Guide:\n    const page = pages[1]\n\n    return <main class="document" look={documentLook}>\n        <Head title={page.title} description={page.summary} themeColor="#f7f5f0" />\n        <p class="eyebrow" look={eyebrowLook}>Guide</p>\n        <h1 look={titleLook}>{page.title}</h1>\n        <p class="lead" look={leadLook}>{page.summary}</p>\n        <pre look={codeLook}><code>{example}</code></pre>\n    </main>\n`],
    ["src/app.vel", `import {NavLink, RouteContext, Router, route} from "velar/web"\nimport {pages} from "./content.vel"\nimport {documentLook, eyebrowLook, ink, inkSoft, paper, paperPure, rule, seaSoft, titleLook} from "./styles.vel"\nimport {Home} from "./pages/home.vel"\nimport {Guide} from "./pages/guide.vel"\n\ncomponent NotFound(route: RouteContext):\n    return <main class="document" look={documentLook}><p class="eyebrow" look={eyebrowLook}>404</p><h1 look={titleLook}>Page not found</h1><p>No document matches {route.path}.</p></main>\n\nconst routes = [route("/", Home), route("/guide", Guide)]\n\nconst shellLook = look:\n    display = "grid"\n    gridTemplateColumns = tracks(240px, minmax(0px, 1fr))\n    minHeight = 100vh\n    color = ink\n    background = paper\n    fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif"\n\n    if viewport.width <= 720px:\n        gridTemplateColumns = tracks(1fr)\n\nconst navLook = look:\n    display = "grid"\n    alignContent = "start"\n    gap = 8px\n    padding = spacing(28px, 20px)\n    borderRight = border(1px, rule)\n    background = paperPure\n\n    if viewport.width <= 720px:\n        flexDirection = "column"\n        justifyContent = "start"\n        borderRight = border(0px, color("transparent"))\n        borderBottom = border(1px, rule)\n\nconst brandLook = look:\n    marginBottom = 16px\n\n    if viewport.width <= 720px:\n        margin = spacing(8px, 12px, 0px, 0px)\n\nconst navLinkLook = look:\n    padding = spacing(8px, 10px)\n    borderRadius = 8px\n    color = inkSoft\n    textDecoration = "none"\n\n    if @current:\n        color = ink\n        background = seaSoft\n\nexport component App:\n    return <div class="shell" look={shellLook}>\n        <nav look={navLook} aria-label="Documentation">\n            <strong look={brandLook}>${escapeVelarString(displayName)}</strong>\n            {pages.map(page => <NavLink key={page.path} to={page.path} exact={true} look={navLinkLook}>{page.label}</NavLink>)}\n        </nav>\n        <Router routes={routes} fallback={NotFound} />\n    </div>\n`],
    ["src/content.test.vel", `import {expect} from "velar/test"\nimport {pageTitle, pages} from "./content.vel"\n\ndef test_documentation_navigation():\n    expect(pages).toHaveLength(2)\n    expect(pageTitle("/guide")).toBe("Guide")\n    expect(pageTitle("/missing")).toBe("Page not found")\n`],
    ["src/app.browser.test.vel", `import {expect} from "velar/test"\nimport {browser} from "velar/web-test"\n\nasync def test_guide_route():\n    await browser.open("/guide")\n    expect(await browser.text("h1")).toBe("Guide")\n    expect(await browser.text("nav")).toContain("Overview")\n`],
  ]);
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
    ["src/index.test.vel", `import {expect} from "velar/test"\nimport {greet} from "./index.vel"\n\ndef test_greeting():\n    const greeting = greet("Velar")\n    expect(greeting.message).toBe("Hello, Velar!")\n    expect(greeting.recipient).toBe("Velar")\n\ndef test_greeting_rejects_blank_names():\n    expect(() => greet("   ")).toThrow()\n`],
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
  return new Map([
    [".gitignore", "node_modules/\ndist/\n.velar/\n"],
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
    ["src/index.test.vel", `import {expect} from "velar/test"\nimport {exampleContent} from "./index.vel"\n\ndef test_component_content_contract():\n    expect(exampleContent.title).toBe("Built with VelarScript")\n    expect(exampleContent.body).toContain("checked VelarScript source")\n`],
    ["src/demo.browser.test.vel", `import {expect} from "velar/test"\nimport {browser} from "velar/web-test"\n\nasync def test_component_preview():\n    await browser.open("/")\n    expect(await browser.text("article h2")).toBe("Built with VelarScript")\n    expect(await browser.text("article p")).toContain("reusable component")\n    const titleId = await browser.attribute("article", "aria-labelledby")\n    expect(titleId != null).toBe(true)\n    if titleId:\n        expect(titleId).toContain("info-card-title-")\n        expect(await browser.attribute("article h2", "id")).toBe(titleId)\n`],
  ]);
}

function commonWebFiles(
  name: string,
  displayName: string,
  version: string,
  formatVersion: number,
): readonly (readonly [string, string])[] {
  return [
    [".gitignore", "node_modules/\ndist/\n.velar/\n"],
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

function packageName(value: string): string {
  const normalized = value.toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 214);
  if (!normalized || normalized === "node_modules" || normalized === "favicon.ico") return "velar-app";
  return normalized;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeVelarString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r");
}
