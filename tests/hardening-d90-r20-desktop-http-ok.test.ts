import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { velarCompilerExtension } from "../packages/desktop/src/compiler.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import type { ValueType } from "../packages/compiler/src/types.ts";

// D90 R20, the Desktop tail.
//
// Desktop reuses the Node `velar/http` interface verbatim, so the type lost
// `ok` the moment the Node half landed — but the Desktop runtime kept setting
// the field on every response it handed back, which made it undeclared runtime
// residue rather than a field. R20 clause 3 removes it here for the reason it
// removed it there: `response()` throws `HttpResponseError` for every non-2xx
// before an author can hold the value, so a field that is always true is a lie.
//
// The wire-level `ok` stays. `responseOf` validates what the native host handed
// back across the bridge — an integrity check on metadata an author never
// reads — and the frozen transport snapshot it returns is what the 2xx question
// is now asked against.

const bridgeKey = Symbol.for("velar.desktop.bridge.v1");

/** The Desktop `HttpResponse`, reached the way an author reaches it: `http.get(...).response()`. */
function httpResponseType(): ValueType {
  const http = velarCompilerExtension.modules?.interfaces.get("velar/http")?.exports.get("http");
  assert.equal(http?.kind, "object");
  const get = http?.kind === "object" ? http.fields.get("get") : undefined;
  assert.equal(get?.kind, "function");
  const request = get?.kind === "function" ? get.result : undefined;
  assert.equal(request?.kind, "object");
  const response = request?.kind === "object" ? request.fields.get("response") : undefined;
  assert.equal(response?.kind, "function");
  const promised = response?.kind === "function" ? response.result : undefined;
  assert.equal(promised?.kind, "promise");
  const value = promised?.kind === "promise" ? promised.value : undefined;
  assert.equal(value?.kind, "object");
  return value!;
}

interface HttpModule {
  readonly http: {
    get(url: string, options?: Record<string, unknown>): {
      response(): Promise<Record<string, unknown> & { text(): Promise<string> }>;
      text(): Promise<string>;
    };
  };
  readonly HttpResponseError: new (...args: never[]) => Error;
}

/**
 * The Desktop runtime captures the bridge once, at module load, so the fake
 * host is installed before the source is imported and answers by URL for the
 * whole file.
 */
async function httpRuntime(): Promise<HttpModule> {
  const bodies = new Map<number, string>();
  const bridge = Object.freeze({
    async invoke(capability: string, operation: string, args: readonly unknown[]): Promise<unknown> {
      assert.equal(capability, "http");
      if (operation === "request") {
        const handle = args[0] as number;
        const url = args[2] as string;
        if (url.endsWith("/inconsistent-status")) return { ok: true, status: 500, statusText: "Internal Server Error", url, headers: [], body: false };
        if (url.endsWith("/no-ok")) return { status: 200, statusText: "OK", url, headers: [], body: false };
        if (url.endsWith("/gone")) {
          bodies.set(handle, JSON.stringify({ error: "missing" }));
          return { ok: false, status: 500, statusText: "Internal Server Error", url, headers: [["content-type", "application/json"]], body: true };
        }
        bodies.set(handle, "here");
        return { ok: true, status: 200, statusText: "OK", url, headers: [["content-type", "text/plain"]], body: true };
      }
      if (operation === "read") {
        const handle = args[0] as number;
        const text = bodies.get(handle) ?? "";
        bodies.delete(handle);
        return { done: text.length === 0, text };
      }
      if (operation === "cancel") return null;
      throw new Error(`Unexpected Desktop bridge call http.${operation}`);
    },
  });
  Object.defineProperty(globalThis, bridgeKey, { value: bridge, configurable: true });
  const source = velarCompilerExtension.modules?.sources.get("velar/http");
  assert.ok(source, "velar/http must have a Desktop runtime source");
  const directory = await mkdtemp(join(tmpdir(), "velar-d90-r20-desktop-"));
  const path = join(directory, "http.mjs");
  await writeFile(path, source, "utf8");
  return await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as HttpModule;
}

// ---------------------------------------------------------------------------
// The type
// ---------------------------------------------------------------------------

test("[D90 R20] the Desktop HTTP response type has no 'ok'", () => {
  const response = httpResponseType();
  assert.equal(response.kind, "object");
  if (response.kind !== "object") return;
  assert.deepEqual([...response.fields.keys()].sort(), [
    "bytes", "headers", "json", "parse", "status", "statusText", "streamText", "text", "url",
  ]);
  assert.equal(response.fields.has("ok"), false);
});

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

test("[D90 R20] a Desktop response object carries no 'ok' and a non-2xx still throws HttpResponseError", async () => {
  const module = await httpRuntime();

  const response = await module.http.get("https://example.test/found").response();
  assert.equal(Object.hasOwn(response, "ok"), false, "the author-visible response must not publish the retired field");
  assert.equal("ok" in response, false);
  // Everything the type does declare survived the removal.
  assert.equal(response.status, 200);
  assert.equal(response.statusText, "OK");
  assert.equal(response.url, "https://example.test/found");
  assert.equal((response.headers as Map<string, string>).get("content-type"), "text/plain");
  assert.equal(await response.text(), "here");

  // The 2xx question is still asked, just against the transport snapshot.
  let raised: unknown = null;
  try {
    await module.http.get("https://example.test/gone").response();
  } catch (error) {
    raised = error;
  }
  assert.ok(raised instanceof module.HttpResponseError, `a 500 must raise HttpResponseError, received ${String(raised)}`);
  const failure = raised as Error & { status: number; url: string; body: unknown };
  assert.equal(failure.status, 500);
  assert.equal(failure.url, "https://example.test/gone");
  assert.equal(failure.message, "HTTP 500 for https://example.test/gone");
  // The parsed body arrives on a null-prototype record, so its one field is
  // what the assertion reads.
  assert.deepEqual({ ...failure.body as Record<string, unknown> }, { error: "missing" });
});

test("[D90 R20] the Desktop host-boundary check on the wire-level 'ok' is intact", async () => {
  const module = await httpRuntime();
  // A host whose `ok` contradicts its `status` is still refused, and so is one
  // that omits the field. That validates what the native host handed back, not
  // what an author can read, so R20 leaves it standing.
  await assert.rejects(module.http.get("https://example.test/inconsistent-status").response(), /invalid HTTP response metadata/u);
  await assert.rejects(module.http.get("https://example.test/no-ok").response(), /HTTP response is missing field 'ok'/u);
});

test("[D90 R20] the emitted Desktop velar/http source stops assigning 'ok' but keeps the host metadata check", () => {
  const source = velarCompilerExtension.modules?.sources.get("velar/http");
  assert.ok(source, "velar/http must have a Desktop runtime source");
  assert.equal(source.includes("this.ok = response.ok;"), false, "the author-visible response must not carry the retired field");
  assert.match(source, /if \(!snapshot\.ok\) \{/u, "the 2xx question is asked against the transport snapshot");
  assert.match(source, /fields\.ok !== \(fields\.status >= 200 && fields\.status <= 299\)/u);
});

// D90 R22 removed the teaching diagnostic that briefly stood beside the
// removal: no version of this language was ever published, so nobody is
// migrating off `ok`. Reading it on Desktop is an ordinary absent field, the
// same answer every other target gives.

async function desktopDiagnostics(source: string): Promise<readonly string[]> {
  const directory = await mkdtemp(join(tmpdir(), "velar-d90-r20-desktop-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, source.trimStart(), "utf8");
  const project = await compileProject(entry, new Map(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(project.failures.map((item) => item.message), []);
  return project.modules.flatMap((module) => module.result.diagnostics).map((item) => `${item.code} ${item.message.slice(0, 40)}`);
}

test("[D90 R22] reading 'ok' on a Desktop response is an ordinary absent field", async () => {
  const reported = await desktopDiagnostics(`
import {http} from "velar/http"

export async def probe():
    const response = await http.get("https://example.test/health").response()
    if not response.ok:
        print("bad")
`);
  // The read answers `unknown`, so the condition reports on its own behind it.
  assert.equal(reported[0], "VEL4001 Object has no field 'ok'");
});

test("[D90 R22] a record that merely spells the response's field names reads the same answer", async () => {
  const reported = await desktopDiagnostics(`
const decoy = {status: 1, statusText: 2, url: 3, headers: 4, json: 5, text: 6, bytes: 7, streamText: 8}

export def probe() -> number:
    return decoy.ok
`);
  assert.equal(reported.some((item) => item.startsWith("VEL4001 Object has no field 'ok'")), true, reported.join(" | "));
});
