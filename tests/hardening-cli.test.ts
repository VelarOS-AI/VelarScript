import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileProject } from "../packages/cli/src/project.ts";
import { localPlatformModuleSources } from "../packages/cli/src/local-platform-modules.ts";
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
    await writeFile(inlineEntry, 'import js unsafe {answer} from "data:text/javascript,export function answer(){return 42}"\nprint(answer())\n', "utf8");
    const inline = await compileProject(inlineEntry);
    assert.deepEqual(inline.failures, []);
    assert.deepEqual(inline.modules.flatMap((module) => module.result.diagnostics), []);

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

test("hardening #33 names imported reactive state and its owning-module mutator fix", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-hardening-reactive-import-"));
  try {
    const store = join(directory, "store.vel");
    const entry = join(directory, "main.vel");
    await writeFile(store, "export state limit = 1\n", "utf8");
    await writeFile(entry, `
import {limit as importedLimit} from "./store.vel"

importedLimit = 2

def local_control():
    const importedLimit = 3
    importedLimit = 4
`.trimStart(), "utf8");

    const project = await compileProject(entry, new Map(), { extensions: [velarCompilerExtension] });
    assert.deepEqual(project.failures, []);
    const diagnostics = project.modules.find((module) => module.inputPath === entry)?.result.diagnostics ?? [];
    assert.ok(diagnostics.some((item) => item.code === "VEL3002"
      && item.message === "Cannot assign to imported state binding 'importedLimit'; it is read-only here. Export a mutator from the owning module and call it instead"));
    assert.ok(diagnostics.some((item) => item.code === "VEL3002"
      && item.message === "Cannot assign to const binding 'importedLimit'"), "a shadowing local const must keep the ordinary diagnostic");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hardening #38 decodes ServeRequest.path before application routing", async () => {
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
    assert.deepEqual(encodedSlash, { status: 200, body: "nested" });
    const percent = await get("127.0.0.1", server.port, "/100%25.txt");
    assert.deepEqual(percent, { status: 200, body: "percent" }, "fileResponse must not decode an already-decoded request path twice");
    const guarded = await get("127.0.0.1", server.port, "/%70rivate/secret.txt");
    assert.deepEqual(guarded, { status: 403, body: "blocked" });
  } finally {
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

async function loadServeRuntime(directory: string): Promise<ServeRuntime> {
  const source = localPlatformModuleSources.get("velar/serve");
  assert.ok(source);
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
