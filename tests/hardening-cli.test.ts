import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { nodeModuleDependencies, nodeModuleSources } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

interface RuntimeRequest {
  readonly method: string;
  readonly path: string;
}

interface RuntimeServer {
  readonly port: number;
  stop(): Promise<null>;
}

interface ServeRuntime {
  serve(
    handler: (request: RuntimeRequest) => unknown | Promise<unknown>,
    port: number,
    host?: string,
  ): Promise<RuntimeServer>;
  fileResponse(root: string, path: string, fallback?: string | null): unknown;
}

test("hardening #7 rejects unsafe and checked relative JavaScript imports before emission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-hardening-js-import-"));
  try {
    const entry = join(directory, "main.vel");
    await writeFile(join(directory, "helper.js"), "export function answer() { return 42; }\n", "utf8");
    await writeFile(entry, 'import js unsafe {answer} from "./helper.js"\nprint(answer())\n', "utf8");

    const relative = await compileProject(entry);
    assert.ok(relative.failures.some((failure) => failure.message
      === "Relative JavaScript import target './helper.js' cannot be emitted; move the JavaScript module into a package and import it by package name"));
    const checked = spawnSync(process.execPath, [cliPath, "check", entry], { encoding: "utf8" });
    assert.equal(checked.status, 1, checked.stderr);
    assert.match(checked.stderr, /Relative JavaScript import target '\.\/helper\.js' cannot be emitted/u);

    const checkedEntry = join(directory, "checked.vel");
    await writeFile(checkedEntry, `
extern module "./helper.js":
    export def answer() -> number

import js {answer} from "./helper.js"
print(answer())
`.trimStart(), "utf8");
    const checkedRelative = await compileProject(checkedEntry);
    assert.ok(checkedRelative.failures.some((failure) => failure.message
      === "Relative JavaScript import target './helper.js' cannot be emitted; move the JavaScript module into a package and import it by package name"));
    const checkedCommand = spawnSync(process.execPath, [cliPath, "check", checkedEntry], { encoding: "utf8" });
    assert.equal(checkedCommand.status, 1, checkedCommand.stderr);
    assert.match(checkedCommand.stderr, /Relative JavaScript import target '\.\/helper\.js' cannot be emitted/u);

    const inlineEntry = join(directory, "inline.vel");
    // D90 R17: an undeclared inline export is unknown and cannot be called,
    // so the clean inline case references it without calling.
    await writeFile(inlineEntry, 'unsafe js`\nexport function answer(){return 42}\n`\nprint(answer == null)\n', "utf8");
    const inline = await compileProject(inlineEntry);
    assert.deepEqual(inline.failures, []);
    assert.deepEqual(inline.modules.flatMap((module) => module.result.diagnostics), []);

    // BRG-U2: bare specifiers resolve at check time now, so the sanctioned
    // package form is exercised against an installed package.
    await mkdir(join(directory, "node_modules", "checked-sdk"), { recursive: true });
    await writeFile(join(directory, "node_modules", "checked-sdk", "package.json"), JSON.stringify({ name: "checked-sdk", type: "module", exports: "./index.js" }), "utf8");
    await writeFile(join(directory, "node_modules", "checked-sdk", "index.js"), "export function answer() { return 42; }\n", "utf8");
    const packageEntry = join(directory, "package.vel");
    await writeFile(packageEntry, `
extern module "checked-sdk":
    export def answer() -> number

import js {answer} from "checked-sdk"
print(answer())
`.trimStart(), "utf8");
    const packageImport = await compileProject(packageEntry);
    assert.deepEqual(packageImport.failures, []);
    assert.deepEqual(packageImport.modules.flatMap((module) => module.result.diagnostics), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hardening #31 serves a real request through an IPv6 loopback binding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-hardening-ipv6-"));
  let server: RuntimeServer | null = null;
  try {
    const runtime = await loadServeRuntime(directory);
    let handled = 0;
    server = await runtime.serve((request) => {
      handled += 1;
      return { status: 200, text: request.path };
    }, 0, "::1");

    assert.ok(server.port > 0, "velar/serve must expose the actual IPv6-bound port");
    const response = await get("::1", server.port, "/ipv6-ready");
    assert.equal(response.status, 200);
    assert.equal(response.body, "/ipv6-ready");
    assert.equal(handled, 1, "the IPv6 request must reach the VelarScript handler");
  } finally {
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("hardening #33 names an imported reactive binding and the owning-module change that fixes it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-hardening-reactive-import-"));
  try {
    const store = join(directory, "store.vel");
    const entry = join(directory, "main.vel");
    await writeFile(store, "export state limit = 1\n\nexport computed doubled = limit * 2\n", "utf8");
    await writeFile(entry, `
import {limit as importedLimit, doubled} from "./store.vel"

importedLimit = 2
doubled = 9

def local_control():
    const importedLimit = 3
    importedLimit = 4
`.trimStart(), "utf8");

    const project = await compileProject(entry, new Map(), { extensions: [velarCompilerExtension] });
    assert.deepEqual(project.failures, []);
    const diagnostics = project.modules.find((module) => module.inputPath === entry)?.result.diagnostics ?? [];
    // D71 rule 184 publishes an exported `computed` through `reactiveExports`
    // under the same `"state"` marker an exported `state` gets, so that marker
    // cannot be rendered as a noun: doing so called a derived value a "state
    // binding" and offered it a mutator it can never have. This message names
    // only what the marker establishes.
    assert.ok(diagnostics.some((item) => item.code === "VEL3002"
      && item.message === "Cannot assign to imported reactive binding 'importedLimit'; it is read-only here. Export an action from the owning module that changes it and call that instead"),
      JSON.stringify(diagnostics));
    assert.ok(!diagnostics.some((item) => /state binding|mutator/u.test(item.message)),
      "no diagnostic may print the reactive marker as a source-language noun");
    // The derived half is answered by the Web analyzer, which knows which word
    // was written and can be sharper than the module-graph rewrite ever could.
    assert.ok(diagnostics.some((item) => item.code === "VEL5063"
      && item.message.startsWith("'doubled' is a computed value derived in the module it comes from")),
      JSON.stringify(diagnostics));
    assert.ok(diagnostics.some((item) => item.code === "VEL3002"
      && item.message === "Cannot assign to const binding 'importedLimit'"), "a shadowing local const must keep the ordinary diagnostic");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hardening #38 decodes ServeRequest.path exactly once before application routing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-hardening-request-path-"));
  let server: RuntimeServer | null = null;
  try {
    const runtime = await loadServeRuntime(directory);
    const site = join(directory, "site");
    await mkdir(join(site, "a"), { recursive: true });
    await mkdir(join(site, "private"));
    await writeFile(join(site, "café"), "coffee", "utf8");
    await writeFile(join(site, "a", "b"), "nested", "utf8");
    await writeFile(join(site, "100%.txt"), "percent", "utf8");
    await writeFile(join(site, "private", "secret.txt"), "secret", "utf8");
    server = await runtime.serve((request) => request.path.startsWith("/private/")
      ? { status: 403, text: "blocked" }
      : runtime.fileResponse(site, request.path), 0);

    const unicode = await get("127.0.0.1", server.port, "/caf%C3%A9");
    assert.deepEqual(unicode, { status: 200, body: "coffee" });
    const encodedSlash = await get("127.0.0.1", server.port, "/a%2Fb");
    assert.deepEqual(encodedSlash, { status: 400, body: "Bad request" }, "encoded path separators must not create a second routing segment");
    const percent = await get("127.0.0.1", server.port, "/100%25.txt");
    assert.deepEqual(percent, { status: 200, body: "percent" }, "fileResponse must not decode an already-decoded request path twice");
    const guarded = await get("127.0.0.1", server.port, "/%70rivate/secret.txt");
    assert.deepEqual(guarded, { status: 403, body: "blocked" });
  } finally {
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("velar/serve releases a backpressured stream when its client disconnects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-serve-disconnect-"));
  let server: RuntimeServer | null = null;
  let streamError: unknown = null;
  let settleStream: (() => void) | null = null;
  const streamSettled = new Promise<void>((resolve) => { settleStream = resolve; });
  try {
    const runtime = await loadServeRuntime(directory);
    const chunk = "x".repeat(1024 * 1024);
    server = await runtime.serve(() => ({
      status: 200,
      stream: async (write: (value: string) => Promise<null>) => {
        try {
          while (true) await write(chunk);
        } catch (error) {
          streamError = error;
          settleStream?.();
        }
        return null;
      },
    }), 0);

    await new Promise<void>((resolveRequest, rejectRequest) => {
      const request = httpRequest({ host: "127.0.0.1", port: server!.port, path: "/stream", method: "GET" }, (response) => {
        response.pause();
        response.destroy();
        resolveRequest();
      });
      request.setTimeout(5_000, () => request.destroy(new Error("Timed out opening the stream")));
      request.once("error", rejectRequest);
      request.end();
    });

    await Promise.race([
      streamSettled,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Backpressured stream did not observe the client disconnect")), 2_000)),
    ]);
    assert.match(String(streamError), /client connection is closed/u);
  } finally {
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

async function loadServeRuntime(directory: string): Promise<ServeRuntime> {
  const source = nodeModuleSources.get("velar/serve");
  assert.ok(source);
  const packageRoot = join(directory, "node_modules", "velar");
  await mkdir(packageRoot, {recursive: true});
  const exports_: Record<string, string> = {};
  const dependencies = new Set<string>();
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit("velar/serve");
  for (const dependency of dependencies) {
    // A Node runtime module may depend on a compiler-owned Core runtime module
    // (D50 rule 89 put the nameable capability error classes there).
    const dependencySource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(dependencySource, `missing Node runtime dependency ${dependency}`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(packageRoot, `${name}.js`), dependencySource, "utf8");
  }
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
  const modulePath = join(directory, "serve.mjs");
  await writeFile(modulePath, source, "utf8");
  return await import(`${pathToFileURL(modulePath).href}?case=${Date.now()}`) as ServeRuntime;
}

function get(host: string, port: number, path: string): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host, port, path, method: "GET", family: host.includes(":") ? 6 : 4 }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(5_000, () => request.destroy(new Error(`Timed out requesting ${host}:${port}${path}`)));
    request.once("error", reject);
    request.end();
  });
}
