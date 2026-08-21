import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { watchDirectoryBranches } from "../packages/cli/src/dev-server.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { importSpecifierSites, moduleOutput } from "../packages/cli/src/module-assets.ts";
import { verifyProductionBuild } from "../packages/cli/src/production-verifier.ts";
import { startProductionPreview } from "../packages/cli/src/preview-server.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));
const webPackageRoot = fileURLToPath(new URL("../packages/web", import.meta.url));

interface RawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

async function temporaryRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

async function linkWebExtension(root: string): Promise<void> {
  const scope = join(root, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(webPackageRoot, join(scope, "web"), "dir");
}

/**
 * `fetch` refuses to set `Host`, and the whole point of the loopback contract is
 * what the server does with a `Host` it did not choose, so these tests speak
 * HTTP directly.
 */
async function rawRequest(
  port: number,
  path: string,
  headers: Readonly<Record<string, string | readonly string[]>> = {},
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolvePromise, reject) => {
    const call = httpRequest({ host: "127.0.0.1", port, path, method: "GET", headers: headers as Record<string, string | string[]> }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolvePromise({
        status: response.statusCode ?? 0,
        headers: Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [name, String(value)])),
        body,
      }));
    });
    call.on("error", reject);
    call.end();
  });
}

interface DevServer {
  readonly child: ChildProcess;
  readonly rebuilds: () => number;
  waitForBanner(): Promise<void>;
}

function startDevServer(directory: string, port: number): DevServer {
  const child = spawn(process.execPath, [cliPath, "dev", directory, "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  return {
    child,
    rebuilds: () => output.match(/VelarScript app rebuilt in/gu)?.length ?? 0,
    async waitForBanner(): Promise<void> {
      const deadline = Date.now() + 30_000;
      while (!/VelarScript dev server:/u.test(output) && Date.now() < deadline) {
        await new Promise((wait) => setTimeout(wait, 10));
      }
      assert.match(output, /VelarScript dev server:/u, output);
    },
  };
}

async function stopDevServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
    child.kill(process.platform === "win32" ? "SIGKILL" : "SIGTERM");
  });
}

/**
 * `fs.watch` with `recursive: true` arms its macOS FSEvents stream on another
 * thread after the dev server has already printed its banner, so a single write
 * can be delivered to nobody. Repeating the write until the server reacts is
 * what makes both the positive and the negative watcher assertions meaningful.
 */
async function changeUntilReported(path: string, contents: (attempt: number) => string, reacted: () => boolean): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    await writeFile(path, contents(attempt), "utf8");
    const retriggerAt = Date.now() + 250;
    while (!reacted() && Date.now() < retriggerAt) await new Promise((wait) => setTimeout(wait, 10));
    if (reacted()) return;
  }
  throw new Error(`the dev server never reported a change to ${path}`);
}

async function webProject(root: string, files: Readonly<Record<string, string>> = {}): Promise<void> {
  await linkWebExtension(root);
  await writeTree(root, {
    "src/main.vel": 'component App:\n    return <main><h1>Dev</h1></main>\n\nmount(<App />, "#app")\n',
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { base: "/", build: { sourceMaps: true }, deployment: { spaFallback: true } },
    }, null, 2)}\n`,
    ...files,
  });
}

test("[cli-2] velar dev answers only requests addressed to a loopback host", async (context) => {
  const directory = await temporaryRoot("velar-dev-host-");
  await webProject(directory);
  const port = 42891;
  const server = startDevServer(directory, port);
  context.after(() => stopDevServer(server.child));
  await server.waitForBanner();

  // The route this protects is real and does carry the project's verbatim
  // source, so the refusal below is not passing for want of a target.
  const map = await rawRequest(port, "/main.js.map", { Host: `127.0.0.1:${port}` });
  assert.equal(map.status, 200);
  assert.match(map.body, /"sourcesContent"/u);
  assert.match(map.body, /component App/u);

  const rebound = await rawRequest(port, "/main.js.map", { Host: "attacker.tld" });
  assert.equal(rebound.status, 403);
  assert.match(rebound.body, /Refused: the request's Host header 'attacker\.tld' is not a loopback host/u);
  assert.doesNotMatch(rebound.body, /sourcesContent/u);

  const named = await rawRequest(port, "/", { Host: `localhost:${port}` });
  assert.equal(named.status, 200);
  const numeric = await rawRequest(port, "/", { Host: `127.0.0.1:${port}` });
  assert.equal(numeric.status, 200);

  const crossSite = await rawRequest(port, "/", { Host: `127.0.0.1:${port}`, "Sec-Fetch-Site": "cross-site" });
  assert.equal(crossSite.status, 403);
  assert.match(crossSite.body, /Sec-Fetch-Site header 'cross-site'/u);
  const sameSite = await rawRequest(port, "/", { Host: `127.0.0.1:${port}`, "Sec-Fetch-Site": "same-site" });
  assert.equal(sameSite.status, 403);
  const sameOrigin = await rawRequest(port, "/", { Host: `127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" });
  assert.equal(sameOrigin.status, 200);

  const foreignOrigin = await rawRequest(port, "/__velar/status", { Host: `127.0.0.1:${port}`, Origin: "http://evil.test" });
  assert.equal(foreignOrigin.status, 403);
  assert.match(foreignOrigin.body, /Origin header 'http:\/\/evil\.test'/u);
  const ownOrigin = await rawRequest(port, "/__velar/status", { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` });
  assert.equal(ownOrigin.status, 200);

  // A loopback host is not by itself this server: another server on the same
  // machine holds a different port and is a different origin.
  const otherPort = await rawRequest(port, "/__velar/status", { Host: `127.0.0.1:${port}`, Origin: "http://localhost:9999" });
  assert.equal(otherPort.status, 403);
  assert.match(otherPort.body, /Origin header 'http:\/\/localhost:9999'/u);
  const otherScheme = await rawRequest(port, "/__velar/status", { Host: `127.0.0.1:${port}`, Origin: `https://127.0.0.1:${port}` });
  assert.equal(otherScheme.status, 403);
  // The spelling of the host is not the origin either way round: same port, and
  // `localhost` and `127.0.0.1` name the same server.
  const spelledOrigin = await rawRequest(port, "/__velar/status", { Host: `127.0.0.1:${port}`, Origin: `http://localhost:${port}` });
  assert.equal(spelledOrigin.status, 200);

  // Node joins a repeated header, and the joined value has to fail the test
  // rather than match neither refused spelling.
  const repeatedSite = await rawRequest(port, "/", { Host: `127.0.0.1:${port}`, "Sec-Fetch-Site": ["none", "cross-site"] });
  assert.equal(repeatedSite.status, 403);
  assert.match(repeatedSite.body, /Sec-Fetch-Site header 'none, cross-site'/u);
});

test("[cli-14] velar dev percent-decodes the request path before it reaches a public asset", async (context) => {
  const directory = await temporaryRoot("velar-dev-encoded-");
  await webProject(directory, {
    "public/my file.txt": "spaced\n",
    "public/图片.txt": "encoded\n",
  });
  const port = 42892;
  const server = startDevServer(directory, port);
  context.after(() => stopDevServer(server.child));
  await server.waitForBanner();

  const spaced = await rawRequest(port, "/my%20file.txt", { Host: `127.0.0.1:${port}` });
  assert.equal(spaced.status, 200);
  assert.equal(spaced.body, "spaced\n");
  const encoded = await rawRequest(port, `/${encodeURIComponent("图片.txt")}`, { Host: `127.0.0.1:${port}` });
  assert.equal(encoded.status, 200);
  assert.equal(encoded.body, "encoded\n");

  const malformed = await rawRequest(port, "/%E0%A4%A", { Host: `127.0.0.1:${port}` });
  assert.equal(malformed.status, 400);
  const traversal = await rawRequest(port, "/%2e%2e/velar.json", { Host: `127.0.0.1:${port}` });
  assert.equal(traversal.status, 404);
});

test("[cli-13] the dev watcher exclusions apply on every platform", async (context) => {
  const directory = await temporaryRoot("velar-dev-watch-");
  await webProject(directory);
  const main = join(directory, "src", "main.vel");
  const port = 42893;
  const server = startDevServer(directory, port);
  context.after(() => stopDevServer(server.child));
  await server.waitForBanner();

  // Arm the operating-system watch: until one notification has been delivered a
  // negative assertion below would hold for the wrong reason.
  await changeUntilReported(
    main,
    (attempt) => `component App:\n    return <main><h1>Armed ${attempt}</h1></main>\n\nmount(<App />, "#app")\n`,
    () => server.rebuilds() >= 1,
  );
  const armed = server.rebuilds();

  await writeTree(directory, {
    "dist/velar-build.json": '{"x":1}\n',
    ".velar/dev-deps/library/meta.json": '{"x":1}\n',
    "node_modules/library/index.json": '{"x":1}\n',
    // The same directories one level down: an `npm install` inside a workspace
    // package storms exactly as one at the root does.
    "packages/ui/node_modules/dep/package.json": '{"x":1}\n',
    "tools/.git/objects/thing.json": '{"x":1}\n',
    "packages/ui/.velar/dev-deps/dep/meta.json": '{"x":1}\n',
  });
  await new Promise((wait) => setTimeout(wait, 750));
  assert.equal(server.rebuilds(), armed, "a write under dist/, .velar/ or node_modules/ at any depth must not rebuild the app");

  await changeUntilReported(
    main,
    (attempt) => `component App:\n    return <main><h1>Live ${attempt}</h1></main>\n\nmount(<App />, "#app")\n`,
    () => server.rebuilds() > armed,
  );
  assert.ok(server.rebuilds() > armed, "a write to a project module must still rebuild the app");
});

test("[cli-8][cli-20] the revision query reaches every import and no string literal", async () => {
  const directory = await temporaryRoot("velar-dev-revision-");
  await writeTree(directory, {
    "src/widget.vel": "export const widget = 1\n",
    "src/page.vel": 'export const label = "Page"\n',
    "src/main.vel": [
      'import {widget} from "./widget.vel"',
      "",
      "export const sample = \"import './widget.js'\"",
      "export const other = \"from './widget.js'\"",
      'export const pattern = "/*"',
      "",
      'const page = await import("./page.vel")',
      "export const label = page.label",
      "export const total = widget",
      "",
    ].join("\n"),
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`,
  });
  const entry = join(directory, "src", "main.vel");
  const project = await compileProject(entry, new Map(), { projectRoot: directory });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const served = moduleOutput(project, "/main.js", "7")?.body ?? "";
  assert.match(served, /from "\.\/widget\.js\?velar=7"/u);
  // The defect: `\bimport\s+["']` cannot match `import("`, so a lazily imported
  // module kept its pre-edit URL for the whole session.
  assert.match(served, /import\("\.\/page\.js\?velar=7"\)/u);
  assert.doesNotMatch(served, /import\("\.\/page\.js"\)/u);
  // The same regex rewrote import-looking text inside the program's own data.
  assert.match(served, /export const sample = "import '\.\/widget\.js'";/u);
  assert.match(served, /export const other = "from '\.\/widget\.js'";/u);
  assert.doesNotMatch(served, /widget\.js\?velar=7'/u);

  const unrevised = moduleOutput(project, "/main.js", null)?.body ?? "";
  const compiled = project.modules.find((module) => module.relativePath === "main.vel")?.result.code ?? "";
  assert.ok(compiled.length > 0);
  assert.ok(unrevised.startsWith(compiled), "an unrevised module is the compiler's own emit");
  const stringLiterals = (source: string): readonly string[] => source
    .split("\n")
    .filter((line) => line.startsWith("export const sample") || line.startsWith("export const other") || line.startsWith("export const pattern"));
  assert.deepEqual(stringLiterals(served), stringLiterals(compiled));
});

test("[cli-8][cli-20] only a specifier in real import position is a rewrite site", () => {
  const sourcesOf = (code: string): readonly string[] => importSpecifierSites(code).map((site) => site.source);

  assert.deepEqual(sourcesOf('import "./a.js";'), ["./a.js"]);
  assert.deepEqual(sourcesOf('import {a} from "./a.js";'), ["./a.js"]);
  assert.deepEqual(sourcesOf('import * as a from "./a.js";'), ["./a.js"]);
  assert.deepEqual(sourcesOf('export * from "./a.js";'), ["./a.js"]);
  assert.deepEqual(sourcesOf('export {a} from "./a.js";'), ["./a.js"]);
  assert.deepEqual(sourcesOf('const a = await import("./a.js");'), ["./a.js"]);
  assert.deepEqual(sourcesOf('const a = lazy(() => import("./a.js"));'), ["./a.js"]);
  assert.deepEqual(sourcesOf('const a = `${await import("./a.js")}`;'), ["./a.js"]);
  assert.deepEqual(sourcesOf('import\n  "./a.js";'), ["./a.js"]);
  assert.deepEqual(sourcesOf('import /* here */ "./a.js";'), ["./a.js"]);

  assert.deepEqual(sourcesOf('const s = "import \'./a.js\'";'), []);
  assert.deepEqual(sourcesOf('const s = "from \'./a.js\'";'), []);
  assert.deepEqual(sourcesOf("const s = `import './a.js'`;"), []);
  assert.deepEqual(sourcesOf('// import "./a.js"\n'), []);
  assert.deepEqual(sourcesOf('/* import "./a.js" */'), []);
  assert.deepEqual(sourcesOf('const re = /import "\\.\\/a\\.js"/gu;'), []);
  assert.deepEqual(sourcesOf('const s = registry.import("./a.js");'), []);
  assert.deepEqual(sourcesOf('const s = Array.from("./a.js");'), []);
  assert.deepEqual(sourcesOf('const s = import.meta.url; const t = "import \'./a.js\'";'), []);

  // A regular expression holding a quote, and a division that must not be read
  // as one: either misreading derails the scan into a phantom string and loses
  // the real import that follows.
  assert.deepEqual(sourcesOf('const q = text.replace(/["\']/gu, ""); import "./a.js";'), ["./a.js"]);
  assert.deepEqual(sourcesOf('const ratio = (total) / 2; const s = "import \'./a.js\'"; import "./b.js";'), ["./b.js"]);
  assert.deepEqual(sourcesOf('const s = "he said \\"import \'./a.js\'\\""; import "./b.js";'), ["./b.js"]);
});

test("[cli-2][cli-7] velar preview refuses rebound hosts and states its caching in the manifest", async (context) => {
  const directory = await temporaryRoot("velar-preview-guard-");
  await webProject(directory);
  const execution = spawnSync(process.execPath, [cliPath, "build"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);

  const deployment = JSON.parse(await readFile(join(directory, "dist", "velar-deploy.json"), "utf8")) as {
    readonly headers: readonly { readonly path: string; readonly values: Readonly<Record<string, string>> }[];
    readonly caching: { readonly documents: string };
  };
  // The preview server no longer supplies this out of band, so the manifest a
  // third-party provider projects has to state it.
  assert.ok(
    deployment.headers.some((rule) => rule.path === "/*" && rule.values["Cache-Control"] === deployment.caching.documents),
    JSON.stringify(deployment.headers),
  );
  const previewSource = await readFile(resolve("packages/cli/src/preview-server.ts"), "utf8");
  assert.doesNotMatch(previewSource, /caching\.documents/u);

  const verified = await verifyProductionBuild(join(directory, "dist"));
  const preview = await startProductionPreview(verified, 0);
  context.after(() => preview.close());
  const port = Number(new URL(preview.origin).port);

  const rebound = await rawRequest(port, "/", { Host: "attacker.tld", Accept: "text/html" });
  assert.equal(rebound.status, 403);
  assert.match(rebound.body, /Host header 'attacker\.tld' is not a loopback host/u);
  const crossSite = await rawRequest(port, "/", { Host: `127.0.0.1:${port}`, Accept: "text/html", "Sec-Fetch-Site": "cross-site" });
  assert.equal(crossSite.status, 403);

  const named = await rawRequest(port, "/", { Host: `localhost:${port}`, Accept: "text/html" });
  assert.equal(named.status, 200);
  assert.equal(named.headers["cache-control"], "no-cache");
  const deep = await rawRequest(port, "/board/123", { Host: `127.0.0.1:${port}`, Accept: "text/html" });
  assert.equal(deep.status, 200);
  assert.equal(deep.headers["cache-control"], "no-cache");
});

test("[cli-13] the per-directory watcher never allocates a watch inside an excluded tree", async (context) => {
  const directory = await temporaryRoot("velar-dev-branches-");
  await writeTree(directory, {
    "src/pages/home.vel": "export const home = 1\n",
    "dist/velar-build.json": '{"x":1}\n',
    ".velar/dev-deps/library/meta.json": '{"x":1}\n',
    "node_modules/library/index.json": '{"x":1}\n',
    "packages/ui/node_modules/dep/package.json": '{"x":1}\n',
    "tools/.git/objects/thing.json": '{"x":1}\n',
  });
  const reported: string[] = [];
  const watcher = watchDirectoryBranches(
    directory,
    (_event, fileName) => { if (fileName !== null) reported.push(fileName); },
    new Set([join(directory, "dist"), join(directory, ".velar")]),
  );
  context.after(() => watcher.close());

  // The exclusion is structural on this branch: an excluded tree costs no watch
  // at all, which is what keeps Linux from spending its inotify budget on
  // `node_modules` before a single event has been filtered.
  const watched = watcher.watchedDirectories();
  assert.deepEqual(watched, [
    directory,
    join(directory, "packages"),
    join(directory, "packages", "ui"),
    join(directory, "src"),
    join(directory, "src", "pages"),
    join(directory, "tools"),
  ].sort());

  const waitFor = async (predicate: () => boolean): Promise<boolean> => {
    const deadline = Date.now() + 10_000;
    while (!predicate() && Date.now() < deadline) await new Promise((wait) => setTimeout(wait, 10));
    return predicate();
  };
  await writeFile(join(directory, "src", "pages", "home.vel"), "export const home = 2\n", "utf8");
  assert.ok(await waitFor(() => reported.includes("src/pages/home.vel")), reported.join(","));

  // A directory that appears after the walk has to be watched too, or the
  // branch watcher would go blind on every new folder.
  reported.length = 0;
  await mkdir(join(directory, "src", "widgets"), { recursive: true });
  assert.ok(await waitFor(() => watcher.watchedDirectories().includes(join(directory, "src", "widgets"))));
  await writeFile(join(directory, "src", "widgets", "card.vel"), "export const card = 1\n", "utf8");
  assert.ok(await waitFor(() => reported.includes("src/widgets/card.vel")), reported.join(","));

  // A directory that arrives already populated: the files exist before the
  // watch can attach, so the walk has to report them itself.
  reported.length = 0;
  const staged = await temporaryRoot("velar-dev-staged-");
  await writeTree(staged, { "panel/list.vel": "export const list = 1\n" });
  await rename(join(staged, "panel"), join(directory, "src", "panel"));
  assert.ok(await waitFor(() => reported.includes("src/panel/list.vel")), reported.join(","));

  // And one that leaves gives its watches back rather than leaking them.
  await rm(join(directory, "src", "panel"), { recursive: true, force: true });
  assert.ok(await waitFor(() => !watcher.watchedDirectories().includes(join(directory, "src", "panel"))));

  reported.length = 0;
  await writeFile(join(directory, "node_modules", "library", "index.json"), '{"x":2}\n', "utf8");
  await writeFile(join(directory, "packages", "ui", "node_modules", "dep", "package.json"), '{"x":2}\n', "utf8");
  await writeFile(join(directory, "dist", "velar-build.json"), '{"x":2}\n', "utf8");
  await new Promise((wait) => setTimeout(wait, 500));
  assert.deepEqual(reported, []);
});
