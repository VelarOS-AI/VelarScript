import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../../packages/cli/src/project.ts";
import { nodeModuleSources, velarNodeCompilerExtension } from "../../packages/node/src/compiler.ts";
import { VELAR_NODE_HOST_WORKER_SOURCE } from "../../packages/node/src/runtime-sources.generated.ts";
import { routePattern, runtime } from "../support/node-runtime.ts";
import { registerRuntimeType } from "../support/runtime-type-registry.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is what `velar/serve` accepts from the wire: the strict
 * owned-data boundary its types and JSON stay on, the containment root
 * `Upload.save` demands, the bounded multipart and URL-encoded bodies its form
 * and upload inputs parse, and the one aggregate byte budget it enforces over
 * all of them.
 */

test("Upload.save requires its containment root at the call site", async () => {
  const entry = join(tmpdir(), "velar-node-upload-save", "main.vel");
  // The root is a required argument, not an option: an upload that is written
  // without naming the directory it belongs in cannot be checked at all, so the
  // omission has to be a compile error rather than a runtime default.
  const source = (call: string): string => `
import {Upload} from "velar/serve"

async def store(image: Upload) -> string:
    ${call}
    return image.filename
`.trimStart();

  const contained = await compileProject(entry, new Map([[entry, source(`await image.save(image.filename, "uploads")`)]]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(contained.failures, []);
  assert.deepEqual(contained.modules.flatMap((module) => module.result.diagnostics), [], "a rooted save compiles");

  const unrooted = await compileProject(entry, new Map([[entry, source("await image.save(image.filename)")]]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(unrooted.failures, []);
  const diagnostics = unrooted.modules.flatMap((module) => module.result.diagnostics);
  assert.equal(diagnostics.length, 1, "omitting the root is the only reported problem");
  assert.equal(diagnostics[0]?.code, "VEL4001");
  assert.match(diagnostics[0]?.message ?? "", /Expected 2 arguments but received 1/u);
});

test("Node serve types and JSON stay on the strict owned-data boundary", async () => {
  const serveRuntime = await runtime<{
    readonly ServeRequest: { is(value: unknown): boolean };
    readonly ServeResponse: { is(value: unknown): boolean };
    readonly Server: { is(value: unknown): boolean };
    readonly serve: (
      handler: (request: {
        readonly path: string;
        json(maxBytes?: number): Promise<unknown>;
        parse<T>(target: { parse(value: unknown): T }, maxBytes?: number): Promise<T>;
      }) => Promise<Record<string, unknown>>,
      port: number,
      host?: string,
    ) => Promise<{ readonly port: number; stop(): Promise<null> }>;
  }>("velar/serve");

  let requestReads = 0;
  const hostileRequest = {
    path: "/",
    query: new Map(),
    headers: new Map(),
    text: async () => "",
    bytes: async () => new Uint8Array(),
    json: async () => null,
    parse: async () => null,
  };
  Object.defineProperty(hostileRequest, "method", {
    enumerable: true,
    get() { requestReads += 1; return "GET"; },
  });
  assert.equal(serveRuntime.ServeRequest.is(hostileRequest), false);
  assert.equal(requestReads, 0);
  assert.equal(serveRuntime.ServeRequest.is({
    method: "GET",
    path: `/${"a".repeat(4097)}`,
    query: new Map(),
    headers: new Map(),
    text: async () => "",
    bytes: async () => new Uint8Array(),
    json: async () => null,
    parse: async () => null,
  }), false);
  assert.equal(serveRuntime.ServeRequest.is({
    method: "GET",
    path: "/",
    query: new Map(),
    headers: new Map(),
    text: async () => "",
    bytes: async () => new Uint8Array(),
    json: async () => null,
    parse: async () => null,
  }), true);

  let serverReads = 0;
  const hostileServer = { stop: async () => null };
  Object.defineProperty(hostileServer, "port", {
    enumerable: true,
    get() { serverReads += 1; return 80; },
  });
  assert.equal(serveRuntime.Server.is(hostileServer), false);
  assert.equal(serverReads, 0);

  let responseReads = 0;
  const hostileResponse = { json: { ok: true } };
  Object.defineProperty(hostileResponse, "status", {
    enumerable: true,
    get() { responseReads += 1; return 200; },
  });
  assert.equal(serveRuntime.ServeResponse.is(hostileResponse), false);
  assert.equal(responseReads, 0);

  let listReads = 0;
  const accessorList: unknown[] = [];
  Object.defineProperty(accessorList, "0", {
    enumerable: true,
    configurable: true,
    get() { listReads += 1; return "unsafe"; },
  });
  accessorList.length = 1;
  assert.equal(serveRuntime.ServeResponse.is({ status: 200, json: accessorList }), false);
  assert.equal(listReads, 0);
  const extraFieldList = ["safe"] as unknown[] & { extra?: string };
  extraFieldList.extra = "not JSON List data";
  assert.equal(serveRuntime.ServeResponse.is({ status: 200, json: extraFieldList }), false);
  assert.equal(serveRuntime.ServeResponse.is({ status: 200, json: { value: Number.POSITIVE_INFINITY } }), false);
  assert.equal(serveRuntime.ServeResponse.is({ status: 200, json: { value: 1 } }), true);

  // D90 fr-6: registry membership alone no longer admits a value; a Type must
  // still present the surface its caller invokes, so `is` is answered here the
  // way every Type the compiler emits answers it.
  const User = registerRuntimeType(Object.freeze({
    is(value: unknown): boolean { return !!value && typeof value === "object" && (value as { name?: unknown }).name === "Ada"; },
    parse(value: unknown): { name: string } {
      if (!value || typeof value !== "object" || (value as { name?: unknown }).name !== "Ada") throw new TypeError("invalid User");
      return value as { name: string };
    },
  }));
  const forgedType = Object.freeze({ parse: (value: unknown) => value });
  const server = await serveRuntime.serve(async (request) => {
    if (request.path === "/typed") {
      try {
        const parsed = await request.parse(User, 64);
        return { status: 200, json: parsed };
      } catch (error) {
        return { status: 400, text: error instanceof Error ? error.message : "invalid" };
      }
    }
    if (request.path === "/forged") {
      try {
        await request.parse(forgedType, 1);
        return { status: 200, text: "unexpected" };
      } catch (error) {
        return { status: 400, text: error instanceof Error ? error.message : "invalid" };
      }
    }
    try {
      await request.json();
      return { status: 200, json: { ok: true } };
    } catch {
      return { status: 400, text: "invalid" };
    }
  }, 0);
  try {
    const lossy = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body: "1e400" });
    assert.equal(lossy.status, 400);
    assert.equal(await lossy.text(), "invalid");
    const valid = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body: "{\"value\":1}" });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { ok: true });
    const typed = await fetch(`http://127.0.0.1:${server.port}/typed`, { method: "POST", body: "{\"name\":\"Ada\"}" });
    assert.equal(typed.status, 200);
    assert.deepEqual(await typed.json(), { name: "Ada" });
    const mismatched = await fetch(`http://127.0.0.1:${server.port}/typed`, { method: "POST", body: "{\"name\":\"Grace\"}" });
    assert.equal(mismatched.status, 400);
    assert.equal(await mismatched.text(), "invalid User");
    const forged = await fetch(`http://127.0.0.1:${server.port}/forged`, { method: "POST", body: "{}" });
    assert.equal(forged.status, 400);
    assert.match(await forged.text(), /compiler-known VelarScript runtime type/u);
  } finally {
    await server.stop();
  }
});

test("Node form and upload inputs parse bounded multipart and URL-encoded bodies", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly input: {
      form(type: object): unknown;
      upload(name?: string, maxBytes?: number): unknown;
    };
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createPattern(source: Record<string, unknown>): unknown;
    createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
    createApp(name: string, items: readonly unknown[]): unknown;
  };
  const Metadata = registerRuntimeType(Object.freeze({
    is(value: unknown): boolean { return !!value && typeof value === "object" && typeof (value as {title?: unknown}).title === "string" && typeof (value as {public?: unknown}).public === "boolean"; },
    parse(value: unknown): {title: string; public: boolean} {
      if (!value || typeof value !== "object" || typeof (value as {title?: unknown}).title !== "string" || typeof (value as {public?: unknown}).public !== "boolean") throw new TypeError("invalid metadata");
      return value as {title: string; public: boolean};
    },
  }));
  const RepeatedFields = registerRuntimeType(Object.freeze({
    is(value: unknown): boolean { return !!value && typeof value === "object" && Array.isArray((value as {tag?: unknown}).tag); },
    parse(value: unknown): {tag: string[]} {
      if (!value || typeof value !== "object" || !Array.isArray((value as {tag?: unknown}).tag) || !(value as {tag: unknown[]}).tag.every((item) => typeof item === "string")) throw new TypeError("invalid repeated fields");
      return value as {tag: string[]};
    },
  }));
  let escapedUpload: {text(): Promise<string>} | null = null;
  const parameters = [
    {name: "metadata", source: "form", kind: "data", required: true, check: () => true, schema: {type: "object", properties: {title: {type: "string"}, public: {type: "boolean"}}, required: ["title", "public"]}, input: serveRuntime.input.form(Metadata)},
    {name: "image", source: "upload", kind: "upload", required: true, check: () => true, input: serveRuntime.input.upload("image", 32)},
  ];
  const upload = bridge.createRoute("POST", routePattern(bridge, "/files"), parameters, async (_path: unknown, metadata: {title: string; public: boolean}, image: {filename: string; size: number; text(): Promise<string>}) => { escapedUpload = image; return {title: metadata.title, public: metadata.public, filename: image.filename, size: image.size, text: await image.text()}; });
  const formOnly = bridge.createRoute("POST", routePattern(bridge, "/form"), [parameters[0]!], async (_path: unknown, metadata: unknown) => metadata);
  const repeatedForm = bridge.createRoute("POST", routePattern(bridge, "/repeated-form"), [
    {name: "input", source: "form", kind: "data", required: true, check: () => true, schema: {type: "object", properties: {tag: {type: "array", items: {type: "string"}}}, required: ["tag"]}, input: serveRuntime.input.form(RepeatedFields)},
  ], async (_path: unknown, input: unknown) => input);
  const server = await serveRuntime.serve(bridge.createApp("forms", [upload, formOnly, repeatedForm]), 0);
  try {
    const body = new FormData();
    body.set("title", "cover");
    body.set("public", "true");
    body.set("image", new Blob(["pixels"], {type: "text/plain"}), "cover.txt");
    const response = await fetch(`http://127.0.0.1:${server.port}/files`, {method: "POST", body});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {title: "cover", public: true, filename: "cover.txt", size: 6, text: "pixels"});
    let lifetimeEnded = false;
    const lifetimeDeadline = Date.now() + 1000;
    while (!lifetimeEnded && Date.now() < lifetimeDeadline) {
      try { await escapedUpload!.text(); }
      catch (error) { assert.match(String(error), /lifetime ended with its request/u); lifetimeEnded = true; }
      if (!lifetimeEnded) await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(lifetimeEnded, true, "request cleanup must revoke upload views promptly");

    const encoded = await fetch(`http://127.0.0.1:${server.port}/form`, {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body: "title=plain&public=false"});
    assert.equal(encoded.status, 200);
    assert.deepEqual(await encoded.json(), {title: "plain", public: false});
    const repeated = await fetch(`http://127.0.0.1:${server.port}/repeated-form`, {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body: "tag=one&tag=two"});
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), {tag: ["one", "two"]});
    const duplicateScalar = await fetch(`http://127.0.0.1:${server.port}/form`, {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body: "title=one&title=two&public=false"});
    assert.equal(duplicateScalar.status, 422);
    const duplicateProblem = await duplicateScalar.json() as {code: string; parameter: string};
    assert.equal(duplicateProblem.code, "request.duplicate.parameter");
    assert.equal(duplicateProblem.parameter, "title");

    const oversized = new FormData();
    oversized.set("title", "large");
    oversized.set("public", "true");
    oversized.set("image", new Blob(["x".repeat(33)]), "large.txt");
    const refused = await fetch(`http://127.0.0.1:${server.port}/files`, {method: "POST", body: oversized});
    assert.equal(refused.status, 413);
    const oversizedProblem = await refused.json() as {code: string; parameter: string};
    assert.equal(oversizedProblem.code, "request.upload.too.large");
    assert.equal(oversizedProblem.parameter, "image");
  } finally {
    await server.stop();
  }
  assert.match(VELAR_NODE_HOST_WORKER_SOURCE, /postMessage\(message, \[data\.buffer\]\)/u, "request bytes cross the Host boundary by ownership transfer");
  assert.match(nodeModuleSources.get("velar/serve") ?? "", /__velarServeUint8Subarray/u, "multipart files use request-buffer views until request cleanup");
});

test("Node serve enforces one aggregate byte budget and releases ownership after completion", async () => {
  const serveRuntime = await runtime<{
    fileResponse(root: string, path: string, fallback?: string | null): Record<string, unknown>;
    serve(
      handler: (request: {readonly path: string; text(maxBytes?: number): Promise<string>}) => Promise<Record<string, unknown>>,
      port: number,
    ): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>(
    "velar/serve",
    source => source,
    (name, source) => name === "velar/node-host-v1"
      ? source.replace("const maxServeAggregateBytes = 128 * 1024 * 1024;", "const maxServeAggregateBytes = 128 * 1024;")
      : source,
  );
  const directory = await mkdtemp(join(tmpdir(), "velar-node-serve-aggregate-"));
  let releaseHeld = (): void => {};
  let markHeldReady = (): void => {};
  const heldReady = new Promise<void>(resolveReady => { markHeldReady = resolveReady; });
  const heldRelease = new Promise<void>(resolveRelease => { releaseHeld = resolveRelease; });
  try {
    await writeFile(join(directory, "large.txt"), "f".repeat(128 * 1024 + 1), "utf8");
    const server = await serveRuntime.serve(async request => {
      if (request.path === "/held") {
        await request.text();
        markHeldReady();
        await heldRelease;
        return {status: 200, text: ""};
      }
      if (request.path === "/competing") {
        try { await request.text(); return {status: 200, text: ""}; }
        catch { return {status: 503, text: ""}; }
      }
      if (request.path === "/large-response") return {status: 200, text: "r".repeat(128 * 1024 + 1)};
      if (request.path === "/large-file") return serveRuntime.fileResponse(directory, "/large.txt");
      return {status: 200, text: "ok"};
    }, 0);
    try {
      // A buffered body owns the chunks it has received and, for the instant
      // that assembles them, the contiguous copy as well: a declared
      // Content-Length is a claim and buys no reservation, so the held body
      // stays under half the budget while it waits. The competing body is
      // sized so that it fits on its own and only the held body's retained
      // ownership pushes it past the budget.
      const held = fetch(`http://127.0.0.1:${server.port}/held`, {method: "POST", body: "h".repeat(32 * 1024)});
      await heldReady;
      const competing = await fetch(`http://127.0.0.1:${server.port}/competing`, {method: "POST", body: "c".repeat(56 * 1024)});
      assert.equal(competing.status, 503);
      assert.equal(await competing.text(), "");
      releaseHeld();
      const heldResponse = await held;
      assert.equal(heldResponse.status, 200);
      assert.equal(await heldResponse.text(), "");

      // Exhausting the aggregate budget is a load condition, not a server fault,
      // so it answers the way admission already answers it — 503 with the header
      // a load balancer and a client can both act on — rather than the opaque
      // 500 every other late failure gets.
      const largeResponse = await fetch(`http://127.0.0.1:${server.port}/large-response`);
      assert.equal(largeResponse.status, 503);
      assert.equal(largeResponse.headers.get("retry-after"), "1");
      assert.deepEqual(await largeResponse.json(), {error: "outbound_budget_exhausted"});
      const largeFile = await fetch(`http://127.0.0.1:${server.port}/large-file`);
      assert.equal(largeFile.status, 200, "static files stream without reserving their full size");
      assert.equal((await largeFile.text()).length, 128 * 1024 + 1);
      const etag = largeFile.headers.get("etag");
      assert.ok(etag);
      const headFile = await fetch(`http://127.0.0.1:${server.port}/large-file`, {method: "HEAD"});
      assert.equal(headFile.headers.get("content-length"), String(128 * 1024 + 1));
      assert.equal(await headFile.text(), "");
      const rangeFile = await fetch(`http://127.0.0.1:${server.port}/large-file`, {headers: {range: "bytes=10-19"}});
      assert.equal(rangeFile.status, 206);
      assert.equal((await rangeFile.text()).length, 10);
      assert.equal(rangeFile.headers.get("content-range"), `bytes 10-19/${128 * 1024 + 1}`);
      const unchanged = await fetch(`http://127.0.0.1:${server.port}/large-file`, {headers: {"if-none-match": etag}});
      assert.equal(unchanged.status, 304);
      const after = await fetch(`http://127.0.0.1:${server.port}/after`);
      assert.equal(after.status, 200);
      assert.equal(await after.text(), "ok");
    } finally {
      releaseHeld();
      await server.stop();
    }
  } finally {
    releaseHeld();
    await rm(directory, {recursive: true, force: true});
  }
});
