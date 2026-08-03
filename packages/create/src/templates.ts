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
    ["README.md", `# ${displayName}\n\nA Velar Web application.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nAfter bootstrap, use \`npm exec velar -- add <package>\`, \`remove\`, and \`update\` for project-aware dependency changes. Before sharing a production build, run \`npm run validate\`.\n`],
    ["src/app.vel", `import {Head} from "velar/web"\n\nexport const appName = "${escapeVelarString(displayName)}"\n\nexport type Feature:\n    title: string\n    detail: string\n\nexport const features: List<Feature> = [\n    {title: "Velar source", detail: "Readable components, state, and styles in one language."},\n    {title: "Web framework", detail: "Routing, forms, HTTP, storage, and browser APIs are built in."},\n    {title: "Verified output", detail: "Production builds carry a deterministic integrity manifest."},\n]\n\ncomponent FeatureCard(feature: Feature):\n    return <article class="feature-card"><h2>{feature.title}</h2><p>{feature.detail}</p></article>\n\nexport component App:\n    state count = 0\n\n    def increment():\n        count += 1\n\n    style global:\n        :root {\n            color-scheme: light;\n            font-family: Inter, ui-sans-serif, system-ui, sans-serif;\n            color: #111216;\n            background: #f7f5f0;\n        }\n\n        * {\n            box-sizing: border-box;\n        }\n\n        body {\n            margin: 0;\n        }\n\n        button {\n            font: inherit;\n        }\n\n    style:\n        .page {\n            display: grid;\n            gap: 32px;\n            width: min(1040px, calc(100% - 40px));\n            margin: 0 auto;\n            padding: 72px 0;\n        }\n\n        .eyebrow {\n            color: #447b9f;\n            font-weight: 700;\n            letter-spacing: 0.08em;\n            text-transform: uppercase;\n        }\n\n        h1 {\n            max-width: 760px;\n            margin: 0;\n            font-size: clamp(3rem, 9vw, 7rem);\n            line-height: 0.92;\n            letter-spacing: -0.07em;\n        }\n\n        .features {\n            display: grid;\n            grid-template-columns: repeat(3, minmax(0, 1fr));\n            gap: 12px;\n        }\n\n        .feature-card {\n            padding: 20px;\n            border: 1px solid rgba(17, 18, 22, 0.14);\n            border-radius: 12px;\n            background: #fbfaf7;\n        }\n\n        button {\n            justify-self: start;\n            padding: 10px 16px;\n            border: 0;\n            border-radius: 999px;\n            color: #fbfaf7;\n            background: #111216;\n            cursor: pointer;\n        }\n\n        @media (max-width: 720px) {\n            .features {\n                grid-template-columns: 1fr;\n            }\n        }\n\n    return <main class="page">\n        <Head title={appName} description="A Velar Web application" themeColor="#f7f5f0" />\n        <header>\n            <p class="eyebrow">Built with Velar</p>\n            <h1>{appName}</h1>\n        </header>\n        <section class="features" aria-label="Velar features">\n            {features.map(feature => <FeatureCard key={feature.title} feature={feature} />)}\n        </section>\n        <button type="button" on:click={increment}>Count: {count}</button>\n    </main>\n`],
    ["src/app.test.vel", `import {expect} from "velar/test"\nimport {appName, features} from "./app.vel"\n\ndef test_application_contract():\n    expect(appName).toBe("${escapeVelarString(displayName)}")\n    expect(features).toHaveLength(3)\n`],
    ["src/app.browser.test.vel", `import {expect} from "velar/test"\nimport {browser} from "velar/web-test"\n\nasync def test_home_page():\n    await browser.open("/")\n    expect(await browser.text("h1")).toBe("${escapeVelarString(displayName)}")\n    await browser.click("button")\n    await browser.waitForText("button", "Count: 1")\n`],
  ]);
}

function docsTemplate(name: string, displayName: string, version: string, formatVersion: number): ReadonlyMap<string, string> {
  return new Map([
    ...commonWebFiles(name, displayName, version, formatVersion),
    ["README.md", `# ${displayName}\n\nA routed documentation site written in Velar.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nAfter bootstrap, use \`npm exec velar -- add <package>\`, \`remove\`, and \`update\` for project-aware dependency changes. Edit the navigation and page metadata in \`src/content.vel\`.\n`],
    ["src/content.vel", `export type DocPage:\n    path: string\n    label: string\n    title: string\n    summary: string\n\nexport const pages: List<DocPage> = [\n    {path: "/", label: "Overview", title: "${escapeVelarString(displayName)}", summary: "A documentation site built entirely with Velar."},\n    {path: "/guide", label: "Guide", title: "Guide", summary: "Start with one component, then grow through typed modules and the Web framework."},\n]\n\nexport def pageTitle(path: string) -> string:\n    for page in pages:\n        if page.path == path:\n            return page.title\n    return "Page not found"\n`],
    ["src/pages/home.vel", `import {Head, Link} from "velar/web"\nimport {pages} from "../content.vel"\n\nexport component Home:\n    const page = pages[0]\n\n    return <main class="document">\n        <Head title={page.title} description={page.summary} themeColor="#f7f5f0" />\n        <p class="eyebrow">Velar documentation</p>\n        <h1>{page.title}</h1>\n        <p class="lead">{page.summary}</p>\n        <Link to="/guide">Read the guide</Link>\n    </main>\n`],
    ["src/pages/guide.vel", `import {Head} from "velar/web"\nimport {pages} from "../content.vel"\n\nconst example = "export component Hello(name: string):\\n    return <h1>Hello {name}</h1>"\n\nexport component Guide:\n    const page = pages[1]\n\n    return <main class="document">\n        <Head title={page.title} description={page.summary} themeColor="#f7f5f0" />\n        <p class="eyebrow">Guide</p>\n        <h1>{page.title}</h1>\n        <p class="lead">{page.summary}</p>\n        <pre><code>{example}</code></pre>\n    </main>\n`],
    ["src/app.vel", `import {NavLink, RouteContext, Router, route} from "velar/web"\nimport {pages} from "./content.vel"\nimport {Home} from "./pages/home.vel"\nimport {Guide} from "./pages/guide.vel"\n\ncomponent NotFound(route: RouteContext):\n    return <main class="document"><p class="eyebrow">404</p><h1>Page not found</h1><p>No document matches {route.path}.</p></main>\n\nconst routes = [route("/", Home), route("/guide", Guide)]\n\nexport component App:\n    style global:\n        :root {\n            color-scheme: light;\n            font-family: Inter, ui-sans-serif, system-ui, sans-serif;\n            color: #111216;\n            background: #f7f5f0;\n        }\n\n        * {\n            box-sizing: border-box;\n        }\n\n        body {\n            margin: 0;\n        }\n\n        a {\n            color: #315f7d;\n        }\n\n        .document {\n            display: grid;\n            gap: 18px;\n            max-width: 760px;\n            padding: 72px 32px;\n        }\n\n        .document h1, .document p {\n            margin: 0;\n        }\n\n        .document h1 {\n            font-size: clamp(3rem, 8vw, 6rem);\n            line-height: 0.96;\n            letter-spacing: -0.06em;\n        }\n\n        .eyebrow {\n            color: #447b9f;\n            font-weight: 700;\n            text-transform: uppercase;\n            letter-spacing: 0.08em;\n        }\n\n        .lead {\n            color: #5e6066;\n            font-size: 1.2rem;\n            line-height: 1.65;\n        }\n\n        pre {\n            overflow: auto;\n            padding: 20px;\n            border: 1px solid rgba(17, 18, 22, 0.14);\n            border-radius: 12px;\n            background: #fbfaf7;\n        }\n\n    style:\n        .shell {\n            display: grid;\n            grid-template-columns: 240px minmax(0, 1fr);\n            min-height: 100vh;\n        }\n\n        nav {\n            display: grid;\n            align-content: start;\n            gap: 8px;\n            padding: 28px 20px;\n            border-right: 1px solid rgba(17, 18, 22, 0.14);\n            background: #fbfaf7;\n        }\n\n        nav strong {\n            margin-bottom: 16px;\n        }\n\n        nav a {\n            padding: 8px 10px;\n            border-radius: 8px;\n            color: #5e6066;\n            text-decoration: none;\n        }\n\n        nav a[aria-current="page"] {\n            color: #111216;\n            background: rgba(68, 123, 159, 0.12);\n        }\n\n        @media (max-width: 720px) {\n            .shell {\n                grid-template-columns: 1fr;\n            }\n\n            nav {\n                grid-auto-flow: column;\n                justify-content: start;\n                border-right: 0;\n                border-bottom: 1px solid rgba(17, 18, 22, 0.14);\n            }\n\n            nav strong {\n                margin: 8px 12px 0 0;\n            }\n        }\n\n    return <div class="shell">\n        <nav aria-label="Documentation">\n            <strong>${escapeVelarString(displayName)}</strong>\n            {pages.map(page => <NavLink key={page.path} to={page.path} exact={true}>{page.label}</NavLink>)}\n        </nav>\n        <Router routes={routes} fallback={NotFound} />\n    </div>\n`],
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
    [".gitignore", "node_modules/\ndist/\n"],
    ["package.json", json(packageManifest)],
    ["velar.json", json({
      formatVersion,
      entry: "src/index.vel",
      outDir: "dist",
      publicDir: "public",
      extensions: [],
    })],
    ["README.md", `# ${displayName}\n\nA reusable Velar source library.\n\n\`\`\`sh\nnpm install\nnpm run validate\n\`\`\`\n\nAfter bootstrap, use \`npm exec velar -- add <package>\`, \`remove\`, and \`update\` for project-aware dependency changes. The package is private by default. Remove \`private\` only after choosing a public package name, license, and release policy.\n`],
    ["src/index.vel", `import {trim} from "velar/text"\n\nexport type Greeting:\n    message: string\n    recipient: string\n\nexport def greet(name: string) -> Greeting:\n    const recipient = trim(name)\n    assert recipient != "", "A greeting requires a name"\n    return {message: f"Hello, {recipient}!", recipient: recipient}\n`],
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
    [".gitignore", "node_modules/\ndist/\n"],
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
    ["README.md", `# ${displayName}\n\nA reusable Velar Web component source package.\n\n\`\`\`sh\nnpm install\nnpm run validate\nnpm run test:browser\n\`\`\`\n\nThe published package entry is \`src/index.vel\`; \`src/demo.vel\` is the local preview application. The package is private by default. Remove \`private\` only after choosing a public package name, license, and release policy.\n`],
    ["src/index.vel", `import {domId} from "velar/web"\n\nexport type CardContent:\n    title: string\n    body: string\n\nexport const exampleContent: CardContent = {title: "Built with Velar", body: "A reusable component ships as checked Velar source."}\n\nexport component InfoCard(content: CardContent):\n    const titleId = domId("info-card-title")\n\n    style:\n        .card {\n            display: grid;\n            gap: 10px;\n            padding: 20px;\n            border: 1px solid rgba(17, 18, 22, 0.14);\n            border-radius: 14px;\n            background: #fbfaf7;\n        }\n\n        h2, p {\n            margin: 0;\n        }\n\n        p {\n            color: #5e6066;\n            line-height: 1.6;\n        }\n\n    return <article class="card" aria-labelledby={titleId}><h2 id={titleId}>{content.title}</h2><p>{content.body}</p></article>\n`],
    ["src/demo.vel", `import {InfoCard, exampleContent} from "./index.vel"\n\nmount(<main><InfoCard content={exampleContent} /></main>, "#app")\n`],
    ["src/index.test.vel", `import {expect} from "velar/test"\nimport {exampleContent} from "./index.vel"\n\ndef test_component_content_contract():\n    expect(exampleContent.title).toBe("Built with Velar")\n    expect(exampleContent.body).toContain("checked Velar source")\n`],
    ["src/demo.browser.test.vel", `import {expect} from "velar/test"\nimport {browser} from "velar/web-test"\n\nasync def test_component_preview():\n    await browser.open("/")\n    expect(await browser.text("article h2")).toBe("Built with Velar")\n    expect(await browser.text("article p")).toContain("reusable component")\n    const titleId = await browser.attribute("article", "aria-labelledby")\n    expect(titleId != none).toBe(true)\n    if titleId:\n        expect(titleId).toContain("info-card-title-")\n        expect(await browser.attribute("article h2", "id")).toBe(titleId)\n`],
  ]);
}

function commonWebFiles(
  name: string,
  displayName: string,
  version: string,
  formatVersion: number,
): readonly (readonly [string, string])[] {
  return [
    [".gitignore", "node_modules/\ndist/\n"],
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
