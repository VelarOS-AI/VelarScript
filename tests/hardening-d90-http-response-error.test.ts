import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject as compileProjectCore } from "../packages/cli/src/project.ts";
import { standardModuleApi, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension as velarDesktopCompilerExtension } from "../packages/desktop/src/compiler.ts";
import { velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// HTTP 客户端失败和服务端问题分别使用 HttpResponseError 与 HttpProblem。
// 代理路由会同时使用二者，因此这里锁定两个概念不会重新混成同名异常。
async function compileNode(source: string): Promise<{
  readonly failures: readonly { readonly message: string }[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
  readonly code: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "velar-http-response-error-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, source, "utf8");
  const project = await compileProjectCore(entry, new Map(), { extensions: [velarNodeCompilerExtension] });
  return {
    failures: project.failures,
    diagnostics: project.modules.flatMap((module) => module.result.diagnostics),
    code: project.modules[0]?.result.code ?? "",
  };
}

test("a proxy route holds velar/http's HttpResponseError and velar/serve's HttpProblem at once", async () => {
  const proxy = await compileNode(`
import {http, HttpResponseError} from "velar/http"
import {HttpProblem} from "velar/serve"

async def proxy(target: string) -> string:
    const request = http.get(target)
    try:
        return await request.text()
    catch error:
        if error is HttpResponseError:
            throw HttpProblem({status: 502, code: "upstream.failed", title: "Upstream request failed", detail: error.url})
        throw HttpProblem({status: 500, code: "proxy.failed", title: "Proxy request failed"})
`.trimStart());
  assert.deepEqual(proxy.failures, []);
  assert.deepEqual(proxy.diagnostics, [], "the two names no longer collide, so VEL3004 must not fire");
  assert.match(proxy.code, /import \{ http, HttpResponseError \} from "velar\/http";/u);
  assert.match(proxy.code, /import \{ HttpProblem \} from "velar\/serve";/u);
  assert.match(proxy.code, /if \(error instanceof HttpResponseError\) \{/u);
});

test("velar/http exports HttpResponseError while velar/serve exports HttpProblem", async () => {
  const nodeApi = standardModuleApi([velarNodeCompilerExtension]);
  assert.deepEqual(nodeApi.modules["velar/http"], [
    "HttpAbortError",
    "HttpResponseError",
    "HttpTransportError",
    "HttpTransportPhase",
    "http",
    "secretHeader",
  ]);
  assert.ok(nodeApi.modules["velar/serve"]?.includes("HttpProblem"), "velar/serve declares the structured problem contract");
  assert.equal(nodeApi.modules["velar/serve"]?.includes("HttpError"), false);
  assert.equal(nodeApi.modules["velar/serve"]?.includes("HttpResponseError"), false);

  const webApi = standardModuleApi([velarCompilerExtension]);
  assert.deepEqual(webApi.modules["velar/http"], [
    "HttpAbortError",
    "HttpResponseError",
    "HttpTransportError",
    "HttpTransportPhase",
    "formBody",
    "http",
  ]);

  // D90 R22: no version of this language was ever published, so there is nobody
  // to migrate off the old spelling. Importing it is an ordinary missing export.
  const stale = await compileNode(`
import {HttpError} from "velar/http"
`.trimStart());
  assert.deepEqual(stale.failures.map((failure) => failure.message), [
    "Module 'velar/http' has no export named 'HttpError'",
  ]);
});

// Desktop inherits Node's velar/http module interface but ships its own runtime
// source, so a rename that reaches the interface and stops there promises an
// export the module does not have: the compiler accepts the import and the
// program fails to load. Every target that publishes velar/http is checked here,
// interface and runtime together, which is the pairing the runtime-boundary gate
// enforces repository-wide.
test("every target emits the renamed class, throws it from the same site, and declares it", () => {
  for (const [extensions, thrower] of [
    [[velarNodeCompilerExtension], /throw new HttpResponseError\("HTTP " \+ wrapped\.status/u],
    [[velarCompilerExtension], /throw new HttpResponseError\("HTTP " \+ wrapped\.status/u],
    [[velarDesktopCompilerExtension], /throw new HttpResponseError\("HTTP " \+ response\.status/u],
  ] as const) {
    const source = standardModuleSource("velar/http", {}, extensions) ?? "";
    assert.match(source, /export class HttpResponseError extends/u);
    assert.match(source, /this\.name = "HttpResponseError";/u);
    assert.match(source, thrower);
    assert.doesNotMatch(source, /\bHttpError\b/u, "no velar/http surface may still spell the old name");
    const api = standardModuleApi(extensions);
    assert.ok(api.modules["velar/http"]?.includes("HttpResponseError"), "the module interface declares the renamed class");
    assert.equal(api.modules["velar/http"]?.includes("HttpError"), false, "no module interface still declares the old name");
  }
});

test("a web module narrows a client failure through HttpResponseError", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-http-response-error-web-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {http, HttpResponseError} from "velar/http"

async def describe(target: string) -> string:
    try:
        return await http.get(target).text()
    catch error:
        if error is HttpResponseError:
            return f"http {error.status} from {error.url}"
        return "unknown"
`.trimStart(), "utf8");
  const project = await compileProjectCore(entry, new Map(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.match(project.modules[0]?.result.code ?? "", /if \(error instanceof HttpResponseError\) \{/u);
});
