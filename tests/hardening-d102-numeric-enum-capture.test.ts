import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { nodeModuleDependencies, nodeModuleSources, velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";

// ---------------------------------------------------------------------------
// D102 ruling 2 — a numeric-wire enum as a route capture.
//
// Ruling 1 gave an enum member an integer wire value and taught OpenAPI to say
// so. A capture typed by such an enum then documented
// {"type":"integer","enum":[1,2]} and refused every request that matched it:
// the URL segment is text, and the membership check compares text against
// numbers. The ruling is to decode first — with the number capture's own rule,
// not a new one — and then check membership. What a {n:number} capture accepts
// is exactly what a numeric-wire enum capture accepts, which is what the
// mirrored matrix below asserts rather than restates.
// ---------------------------------------------------------------------------

type Capture = {
  readonly name: string;
  readonly wireName: string;
  readonly explicitWireName: boolean;
  readonly typeName: string;
  readonly optional: boolean;
  readonly kind: "string" | "number" | "bool" | "enum";
  readonly check: (value: unknown) => boolean;
  readonly schema: Readonly<Record<string, unknown>>;
};

type Bridge = {
  createPattern(source: Record<string, unknown>): unknown;
  createRoute(method: string, pattern: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
  createApp(name: string, items: readonly unknown[]): unknown;
};

type ServeRuntime = {
  readonly ServeApp: object;
  serve(app: unknown, port: number): Promise<{ readonly port: number; stop(): Promise<null> }>;
};

after(async () => {
  await removeTemporaryDirectories();
});

async function serveRuntime(): Promise<ServeRuntime> {
  const source = nodeModuleSources.get("velar/serve");
  assert.ok(source);
  const directory = await mkdtemp(join(tmpdir(), "velar-d102-capture-"));
  const dependencies = new Set<string>();
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit("velar/serve");
  const root = join(directory, "node_modules", "velar");
  await mkdir(root, { recursive: true });
  const exports_: Record<string, string> = {};
  for (const dependency of dependencies) {
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), moduleSource, "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "velar", private: true, type: "module", exports: exports_ }), "utf8");
  const path = join(directory, "serve.mjs");
  await writeFile(path, source, "utf8");
  const loaded = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as ServeRuntime;
  await rm(directory, { recursive: true, force: true });
  return loaded;
}

/** A capture built exactly as the compiler emits one, so a runtime probe is not a fiction about the compiler. */
function capture(name: string, kind: Capture["kind"], typeName: string, check: (value: unknown) => boolean, schema: Readonly<Record<string, unknown>>): Capture {
  return { name, wireName: name, explicitWireName: false, typeName, optional: false, kind, check, schema };
}

async function compiledCaptureSchema(source: string, label: string): Promise<string> {
  const path = join(tmpdir(), `velar-d102-${label}.vel`);
  const project = await compileProject(path, new Map([[path, source]]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  return project.modules[0]?.result.code ?? "";
}

// ---------------------------------------------------------------------------
// What the compiler emits: the capture's kind stays `enum`, and the schema is
// the wire-value schema ruling 1 established. Nothing here is new — it is the
// fact the runtime now reads.
// ---------------------------------------------------------------------------

test("[D102-2] a capture's schema states the enum's wire values", async () => {
  const numeric = await compiledCaptureSchema(`
enum Proto:
    v1 = 1
    v2 = 2

server api:
    @get(p"/f/{protocol:Proto}" as path) => {protocol: path.params.protocol}
`.trimStart(), "numeric");
  assert.match(numeric, /name:"protocol"[^\n]*kind:"enum"[^\n]*schema:\{"type":"integer","enum":\[1,2\]\}/u);

  const textual = await compiledCaptureSchema(`
enum Visibility:
    public = "published"
    private = "restricted"

server api:
    @get(p"/v/{visibility:Visibility}" as path) => {visibility: str(path.params.visibility)}
`.trimStart(), "textual");
  assert.match(textual, /name:"visibility"[^\n]*kind:"enum"[^\n]*schema:\{"type":"string","enum":\["published","restricted"\]\}/u);

  // A mixed enum states its values and no type, because no single type is true
  // of all of them. That absence is exactly what keeps it on the text path.
  const mixed = await compiledCaptureSchema(`
enum Mode:
    fast = 1
    slow = "slow"

server api:
    @get(p"/m/{mode:Mode}" as path) => {mode: str(path.params.mode)}
`.trimStart(), "mixed");
  assert.match(mixed, /name:"mode"[^\n]*kind:"enum"[^\n]*schema:\{"enum":\[1,"slow"\]\}/u);
});

// ---------------------------------------------------------------------------
// What the runtime does with it. The number capture is in the same table as the
// numeric-wire enum so "mirrors the number rule precisely" is a machine-checked
// claim: every raw string is sent to both, and the decode verdicts must agree.
// ---------------------------------------------------------------------------

test("[D102-2] a numeric-wire enum capture decodes exactly as a number capture does", async () => {
  const runtime = await serveRuntime();
  const bridge = Object.getOwnPropertyDescriptor(runtime.ServeApp, "__velarCompilerBridge")?.value as Bridge | undefined;
  assert.ok(bridge);

  const protocol = capture("protocol", "enum", "Proto", (value) => value === 1 || value === 2, { type: "integer", enum: [1, 2] });
  const count = capture("count", "number", "number", (value) => typeof value === "number", { type: "number" });
  const visibility = capture("visibility", "enum", "Visibility", (value) => value === "published" || value === "restricted", { type: "string", enum: ["published", "restricted"] });
  const mode = capture("mode", "enum", "Mode", (value) => value === 1 || value === "slow", { enum: [1, "slow"] });

  const route = (prefix: string, item: Capture): unknown => bridge.createRoute(
    "GET",
    bridge.createPattern({
      definition: `/${prefix}/{${item.name}:${item.typeName}}`,
      pathname: `/${prefix}/{${item.name}:${item.typeName}}`,
      path: [item],
      query: [],
    }),
    [],
    async (path: { readonly params: Record<string, unknown> }) => ({ value: path.params[item.name] }),
  );
  const app = bridge.createApp("d102", [route("f", protocol), route("n", count), route("v", visibility), route("m", mode)]);
  const server = await runtime.serve(app, 0);
  const read = async (prefix: string, raw: string): Promise<{ status: number; value?: unknown }> => {
    const response = await fetch(`http://127.0.0.1:${server.port}/${prefix}/${encodeURIComponent(raw)}`);
    return response.status === 200 ? { status: 200, value: (await response.json() as { value: unknown }).value } : { status: response.status };
  };

  try {
    // Decode: whatever the number capture refuses, the enum capture refuses for
    // the same reason and with the same 422 — and whatever it decodes, the enum
    // capture decodes to the identical value before checking membership. The
    // pairing is asserted, so the two can never drift apart silently.
    const decoded: readonly (readonly [string, number | null])[] = [
      ["1", 1], ["2", 2], ["3", 3], ["-1", -1],
      // "1.0" and "1e0" are values of the number capture's own grammar and
      // decode to 1; "01", "+1", "0x1", " 1", "v1", and "" are not, and never were.
      ["1.0", 1], ["1e0", 1],
      ["01", null], ["+1", null], ["0x1", null], [" 1", null], ["v1", null], ["", null],
    ];
    for (const [raw, expected] of decoded) {
      const number = await read("n", raw);
      const enumeration = await read("f", raw);
      if (expected === null) {
        assert.equal(number.status, 422, `a number capture must refuse ${JSON.stringify(raw)}`);
        assert.equal(enumeration.status, 422, `a numeric-wire enum capture must refuse ${JSON.stringify(raw)}`);
        continue;
      }
      assert.deepEqual(number, { status: 200, value: expected }, `a number capture decodes ${JSON.stringify(raw)}`);
      // Membership is the second half, and it is the enum's own: a decoded
      // number that is not a member is refused with the same 422 a bad decode
      // gets, which is what keeps a capture from admitting 3 or -1 as a Proto.
      const member = expected === 1 || expected === 2;
      assert.deepEqual(
        enumeration,
        member ? { status: 200, value: expected } : { status: 422 },
        `a numeric-wire enum capture ${member ? "accepts" : "refuses"} ${JSON.stringify(raw)}`,
      );
    }

    // A string-wire enum is untouched: its members still match the raw text,
    // and nothing else does.
    assert.deepEqual(await read("v", "published"), { status: 200, value: "published" });
    assert.deepEqual(await read("v", "restricted"), { status: 200, value: "restricted" });
    assert.equal((await read("v", "other")).status, 422);
    assert.equal((await read("v", "1")).status, 422);

    // A mixed enum has no single wire type, so it keeps the text path exactly
    // as it has: its string members match, and its integer members are not
    // reachable through a capture at all. Stated here rather than left to be
    // discovered — a mixed enum is a poor route-capture type, and the refusal
    // is the honest answer until a ruling says otherwise.
    assert.deepEqual(await read("m", "slow"), { status: 200, value: "slow" });
    assert.equal((await read("m", "1")).status, 422);
    assert.equal((await read("m", "fast")).status, 422);
  } finally {
    await server.stop();
  }
});

// ---------------------------------------------------------------------------
// The whole toolchain, once: a real project, compiled and served by `velar
// test`, driven through `velar/server-test`. The probes above are precise; this
// is the one that proves the compiler's schema and the runtime's reading of it
// are the same fact.
// ---------------------------------------------------------------------------

test("[D102-2] a numeric-wire enum capture answers end to end", { timeout: 300_000 }, async () => {
  const directory = await makeTemporaryDirectory("velar-d102-endtoend-");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(repositoryRoot, "packages", "server"), join(directory, "node_modules", "@velarscript", "server"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    kind: "application",
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/server"],
    server: { configuration: "application.yml" },
  }), "utf8");
  await writeFile(join(directory, "application.yml"), "server:\n  host: 127.0.0.1\n  port: 3000\n", "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
export enum Proto:
    v1 = 1
    v2 = 2

export enum Visibility:
    public = "published"
    private = "restricted"

export server api:
    @get(p"/f/{protocol:Proto}" as path) => {protocol: path.params.protocol}
    @get(p"/v/{visibility:Visibility}" as path) => {visibility: str(path.params.visibility)}
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "main.test.vel"), `
import {client} from "velar/server-test"
import {expect} from "velar/test"
import {api} from "./main.vel"

test "an integer-wire enum capture decodes and then checks membership":
    const service = await client(api)
    try:
        const first = await service.get("/f/1")
        expect(first.status).toBe(200)
        expect(await first.text()).toContain("1")

        const second = await service.get("/f/2")
        expect(second.status).toBe(200)

        // Decoded, and then refused by the enum itself.
        expect((await service.get("/f/3")).status).toBe(422)
        // Never decoded at all — the number capture's grammar refuses these too.
        expect((await service.get("/f/0x1")).status).toBe(422)
        expect((await service.get("/f/v1")).status).toBe(422)
    finally: await service.close()

test "a string-wire enum capture still matches the raw text":
    const service = await client(api)
    try:
        expect((await service.get("/v/published")).status).toBe(200)
        expect((await service.get("/v/restricted")).status).toBe(200)
        expect((await service.get("/v/public")).status).toBe(422)
    finally: await service.close()
`.trimStart(), "utf8");

  const execution = spawnSync(process.execPath, [join(repositoryRoot, "packages", "cli", "src", "cli.ts"), "test", directory], {
    encoding: "utf8",
    timeout: 300_000,
  });
  const output = `${String(execution.stdout)}${String(execution.stderr)}`;
  assert.equal(execution.status, 0, output);
  assert.match(output, /2 passed/u);
});
