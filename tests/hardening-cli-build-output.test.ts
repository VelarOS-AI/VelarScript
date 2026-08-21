import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, win32 } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatSource } from "@velarscript/compiler";
import { formatSourceChecked } from "../packages/cli/src/format-guard.ts";
import { verifyProductionBuild } from "../packages/cli/src/production-verifier.ts";
import { verifyRemoteDeployment } from "../packages/cli/src/deployment-verifier.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));
const webPackageRoot = fileURLToPath(new URL("../packages/web", import.meta.url));

interface Execution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
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

function runCli(cwd: string, arguments_: readonly string[], environment: Readonly<Record<string, string>> = {}): Execution {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, ...environment },
  });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

async function linkWebExtension(root: string): Promise<void> {
  const scope = join(root, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(webPackageRoot, join(scope, "web"), "dir");
}

async function writeWebProject(root: string, files: Readonly<Record<string, string>> = {}): Promise<void> {
  await linkWebExtension(root);
  await writeTree(root, {
    "src/main.vel": 'component App:\n    return <main><h1>Static Velar</h1></main>\n\nmount(<App />, "#app")\n',
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

test("[CLI-1] velar build refuses an output directory it does not own", async () => {
  const root = await temporaryRoot("velar-build-output-guard");
  try {
    await writeTree(root, {
      "main.vel": 'print("ok")\n',
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist" })}\n`,
      "victim/thesis.txt": "my thesis\n",
      "victim/notes/a.md": "important\n",
    });

    const refused = runCli(root, ["build", "--out-dir", "victim"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /refusing to replace .*victim': it is not empty and was not produced by velar build \(pass --force to overwrite\)/u);
    assert.equal(await readFile(join(root, "victim", "thesis.txt"), "utf8"), "my thesis\n");
    assert.equal(await readFile(join(root, "victim", "notes", "a.md"), "utf8"), "important\n");

    // `--out-dir .` used to delete its own source; the guard sees an ordinary
    // non-empty directory and refuses it like any other.
    const dot = runCli(root, ["build", "--out-dir", "."]);
    assert.notEqual(dot.status, 0);
    assert.equal(await readFile(join(root, "main.vel"), "utf8"), 'print("ok")\n');

    const forced = runCli(root, ["build", "--out-dir", "victim", "--force"]);
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);
    assert.deepEqual((await readdir(join(root, "victim"))).sort(), ["main.js", "main.js.map"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-1] velar build accepts an empty, an absent, a declared, and a previously built output", async () => {
  const root = await temporaryRoot("velar-build-output-accepts");
  try {
    await writeTree(root, {
      "main.vel": 'print("ok")\n',
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist" })}\n`,
      "prior/velar-build.json": `${JSON.stringify({ formatVersion: 3, kind: "velar-framework-build" })}\n`,
      "prior/index.html": "<!doctype html>\n",
    });
    await mkdir(join(root, "empty"), { recursive: true });

    const absent = runCli(root, ["build", "--out-dir", "absent"]);
    assert.equal(absent.status, 0, absent.stdout + absent.stderr);
    const empty = runCli(root, ["build", "--out-dir", "empty"]);
    assert.equal(empty.status, 0, empty.stdout + empty.stderr);
    const prior = runCli(root, ["build", "--out-dir", "prior"]);
    assert.equal(prior.status, 0, prior.stdout + prior.stderr);

    // The project manifest's own `outDir` declares the directory velar owns, so
    // the ordinary repeated build keeps working without --force.
    assert.equal(runCli(root, ["build"]).status, 0);
    const repeated = runCli(root, ["build"]);
    assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr);
    assert.deepEqual((await readdir(join(root, "dist"))).sort(), ["main.js", "main.js.map"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-1] velar build refuses a symbolic link as its output directory", async () => {
  const root = await temporaryRoot("velar-build-output-symlink");
  try {
    await writeTree(root, {
      "main.vel": 'print("ok")\n',
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist" })}\n`,
      "real/keep.txt": "keep\n",
    });
    await symlink(join(root, "real"), join(root, "link"), "dir");
    const refused = runCli(root, ["build", "--out-dir", "link"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /refusing to replace .*link': it is a symbolic link/u);
    const forced = runCli(root, ["build", "--out-dir", "link", "--force"]);
    assert.notEqual(forced.status, 0);
    assert.equal(await readFile(join(root, "real", "keep.txt"), "utf8"), "keep\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-5] public/assets collides with the build's immutable namespace and is refused", async () => {
  const root = await temporaryRoot("velar-public-assets-reserved");
  try {
    await writeWebProject(root, { "public/assets/logo.svg": "<svg/>\n" });
    const refused = runCli(root, ["build"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /public asset 'assets' is reserved by the VelarScript production builder/u);
    assert.match(refused.stderr, /one-year immutable cache rule; put it under public\/static\/ instead/u);

    await rm(join(root, "public", "assets"), { recursive: true, force: true });
    await writeTree(root, { "public/static/logo.svg": "<svg/>\n" });
    const built = runCli(root, ["build"]);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const manifest = JSON.parse(await readFile(join(root, "dist", "velar-build.json"), "utf8")) as {
      assets: readonly { path: string }[];
    };
    assert.ok(manifest.assets.some((asset) => asset.path === "static/logo.svg"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-21] a nested file named like a generated one stays in the inventory", async () => {
  const root = await temporaryRoot("velar-nested-reserved-name");
  try {
    await writeWebProject(root, {
      "public/docs/velar-build.json": '{"kind":"documentation"}\n',
      "public/docs/.velar-build-staging.json": '{"kind":"documentation"}\n',
    });
    const built = runCli(root, ["build"]);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const manifest = JSON.parse(await readFile(join(root, "dist", "velar-build.json"), "utf8")) as {
      assets: readonly { path: string }[];
    };
    const paths = manifest.assets.map((asset) => asset.path);
    assert.ok(paths.includes("docs/velar-build.json"));
    assert.ok(paths.includes("docs/.velar-build-staging.json"));
    // The two names stay reserved at the root of the output, where the build
    // actually writes them.
    assert.equal(paths.includes("velar-build.json"), false);
    const verified = runCli(root, ["verify", "dist"]);
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);

    // The same two names at the root of `public/` would land at the root of the
    // output, where the walk does skip them: the build refuses them up front
    // instead of shipping a file `velar verify` reports as undeclared.
    for (const name of ["velar-build.json", ".velar-build-staging.json"]) {
      await writeTree(root, { [`public/${name}`]: '{"kind":"documentation"}\n' });
      const refused = runCli(root, ["build"]);
      assert.notEqual(refused.status, 0, name);
      assert.match(refused.stderr, new RegExp(`public asset '${name.replaceAll(".", "\\.")}' is reserved`, "u"));
      await rm(join(root, "public", name), { force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-22] the asset inventory is sorted on the relative paths the verifier compares", async () => {
  const root = await temporaryRoot("velar-inventory-order");
  try {
    await writeWebProject(root, {
      "public/icons/a.png": "a\n",
      "public/icons512.png": "b\n",
    });
    const built = runCli(root, ["build"]);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const manifest = JSON.parse(await readFile(join(root, "dist", "velar-build.json"), "utf8")) as {
      assets: readonly { path: string }[];
    };
    const declared = manifest.assets.map((asset) => asset.path);
    assert.deepEqual(declared, [...declared].sort());
    assert.ok(declared.includes("icons/a.png") && declared.includes("icons512.png"));

    // The same walk on a host whose separator is '\': keying the sort on the
    // relative path is what keeps the producer and the verifier in agreement.
    const outputDirectory = "C:\\proj\\dist";
    const files = ["assetsZ.js", "assets/main-AAAA.js", "icons512.png", "icons/a.png"];
    const byRelativePath = files
      .map((file) => ({
        relativePath: win32.relative(outputDirectory, win32.join(outputDirectory, file)).replaceAll("\\", "/"),
        absolutePath: win32.join(outputDirectory, file),
      }))
      .sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)
      .map((pair) => pair.relativePath);
    const byAbsolutePath = files
      .map((file) => win32.join(outputDirectory, file))
      .sort()
      .map((path) => win32.relative(outputDirectory, path).replaceAll("\\", "/"));
    const expected = [...byRelativePath].sort();
    assert.deepEqual(byRelativePath, expected);
    assert.notDeepEqual(byAbsolutePath, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-6] the manifest package order does not follow the machine's collation", async () => {
  const root = await temporaryRoot("velar-manifest-package-order");
  try {
    await writeWebProject(root, {
      "src/main.vel": 'import {first} from "aa"\nimport {second} from "z"\n\ncomponent App:\n    return <main>{first()}{second()}</main>\n\nmount(<App />, "#app")\n',
    });
    for (const name of ["aa", "z"]) {
      await writeTree(root, {
        [`node_modules/${name}/package.json`]: `${JSON.stringify({
          name,
          version: "1.0.0",
          velar: { entry: "src/index.vel", targets: ["web"], requires: { capabilities: ["web"] } },
        })}\n`,
        [`node_modules/${name}/src/index.vel`]: `export def ${name === "aa" ? "first" : "second"}() -> string:\n    return "${name}"\n`,
      });
    }
    const packageOrder = (locale: string): readonly string[] => {
      const built = runCli(root, ["build", "--out-dir", "dist", "--force"], { LC_ALL: locale, LANG: locale });
      assert.equal(built.status, 0, built.stdout + built.stderr);
      const manifest = JSON.parse(
        readFileSync(join(root, "dist", "velar-build.json"), "utf8"),
      ) as { modules: { packages: readonly { name: string }[] } };
      return manifest.modules.packages.map((item) => item.name);
    };
    const english = packageOrder("en_US.UTF-8");
    const danish = packageOrder("da_DK.UTF-8");
    assert.deepEqual(english, ["aa", "z"]);
    assert.deepEqual(danish, english);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-7] the deployment manifest states the document rule verify-deployment enforces", async () => {
  const root = await temporaryRoot("velar-deployment-document-rule");
  const served: { close: (() => Promise<void>) | null } = { close: null };
  try {
    await writeWebProject(root);
    const built = runCli(root, ["build"]);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const directory = join(root, "dist");
    const deployment = JSON.parse(await readFile(join(directory, "velar-deploy.json"), "utf8")) as {
      headers: readonly { path: string; values: Record<string, string> }[];
    };
    const wildcard = deployment.headers.findIndex((rule) => rule.path === "/*" && rule.values["Cache-Control"] === "no-cache");
    const assets = deployment.headers.findIndex((rule) => rule.path === "/assets/*");
    assert.ok(wildcard >= 0, "the manifest carries a base-wildcard no-cache rule");
    assert.ok(wildcard < assets, "the wildcard rule precedes the assets rule so last-match-wins keeps the immutable year");

    const verified = await verifyProductionBuild(directory);
    const server = await startManifestOnlyServer(verified.directory, deployment.headers, verified.deployment.spaFallback?.source ?? null);
    served.close = server.close;
    const remote = await verifyRemoteDeployment(verified, server.origin);
    assert.equal(remote.buildId, verified.manifest.buildId);
    assert.equal(remote.checkedRoutes, 3);
  } finally {
    if (served.close) await served.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-x5] velar format leaves a file the formatter cannot stabilize untouched", async () => {
  const root = await temporaryRoot("velar-format-fixed-point");
  try {
    const source = "def f():\n   raw  x\n";
    await writeTree(root, {
      "main.vel": source,
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["velar-unstable-format"] })}\n`,
      "node_modules/velar-unstable-format/package.json": `${JSON.stringify({
        name: "velar-unstable-format",
        version: "1.0.0",
        type: "module",
        exports: { "./compiler": "./compiler.js" },
        velar: { extension: { kind: "language", apiVersion: "1.0" } },
      })}\n`,
      // The scan claims its region only at an even offset, so re-indenting the
      // line flips the claim and the second pass produces different bytes.
      "node_modules/velar-unstable-format/compiler.js": [
        'export const velarCompilerExtension = {',
        '  id: "velar-unstable-format",',
        '  contract: { protocolVersion: 1, apiVersion: "1.0", kind: "language", extends: {} },',
        '  formatting: {',
        '    scanOpaqueSource(source, start) {',
        '      if (!source.startsWith("raw", start) || start % 2 !== 0) return null;',
        '      const end = source.indexOf("\\n", start);',
        '      return { end: end === -1 ? source.length : end, attachedToPrevious: false };',
        '    },',
        '  },',
        '};',
        '',
      ].join("\n"),
    });

    const formatted = runCli(root, ["format", "main.vel"]);
    assert.notEqual(formatted.status, 0);
    assert.match(formatted.stderr, /main\.vel: the formatter did not reach a fixed point; the file was left unchanged/u);
    assert.equal(await readFile(join(root, "main.vel"), "utf8"), source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-x5] formatSourceChecked reports a fixed point for ordinary source", () => {
  const source = "def f( a , b ):\n    return a+b\n";
  const checked = formatSourceChecked(source);
  assert.equal(checked.stable, true);
  assert.equal(checked.text, formatSource(source));
  assert.equal(formatSource(checked.text), checked.text);
});

test("[CLI-x16] the project stylesheet carries each generated rule once", async () => {
  const root = await temporaryRoot("velar-look-rule-dedup");
  try {
    await writeWebProject(root, {
      "src/main.vel": [
        'import {Left} from "./left.vel"',
        'import {Right} from "./right.vel"',
        "",
        "component App:",
        "    return <main><Left /><Right /></main>",
        "",
        'mount(<App />, "#app")',
        "",
      ].join("\n"),
      "src/left.vel": 'export component Left:\n    return <p look:color="red">left</p>\n',
      "src/right.vel": 'export component Right:\n    return <p look:color="red">right</p>\n',
    });
    const built = runCli(root, ["build"]);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const manifest = JSON.parse(await readFile(join(root, "dist", "velar-build.json"), "utf8")) as {
      stylesheet: string | null;
    };
    assert.ok(manifest.stylesheet);
    const stylesheet = await readFile(join(root, "dist", manifest.stylesheet), "utf8");
    const rules = stylesheet.split("}").filter((part) => part.includes("data-velar-look"));
    assert.ok(rules.length > 0);
    assert.equal(new Set(rules).size, rules.length, stylesheet);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const mediaTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serves a production build applying the deployment manifest's header rules and
 * nothing else — the projection a provider that reads `velar-deploy.json`
 * literally produces. `velar preview` adds a document Cache-Control of its own,
 * which is exactly what used to hide the missing rule from the round trip.
 */
async function startManifestOnlyServer(
  directory: string,
  headers: readonly { path: string; values: Record<string, string> }[],
  spaFallback: string | null,
): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      let body: Buffer | null = null;
      let servedPath = relativePath;
      try {
        body = await readFile(join(directory, relativePath));
      } catch {
        if (spaFallback && extname(relativePath) === "") {
          servedPath = spaFallback;
          body = await readFile(join(directory, spaFallback));
        }
      }
      if (!body) {
        response.writeHead(404).end("Not found");
        return;
      }
      for (const rule of headers) {
        const matches = rule.path.endsWith("*") ? pathname.startsWith(rule.path.slice(0, -1)) : pathname === rule.path;
        if (!matches) continue;
        for (const [name, value] of Object.entries(rule.values)) response.setHeader(name, value);
      }
      response.setHeader("Content-Type", mediaTypes[extname(servedPath).toLowerCase()] ?? "application/octet-stream");
      response.setHeader("Content-Length", String(body.byteLength));
      response.writeHead(200).end(body);
    })();
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    },
  };
}
