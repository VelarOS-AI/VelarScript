import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runVelarProject } from "../support/velar-project.ts";

/**
 * D114 F10-node, audits NO-D1 / NO-U5 / NO-I1 / NO-I5 / NO-I8: what a deployed
 * Node output believes about the directory standing at its project offset, and
 * what it says when it cannot believe it.
 *
 * 0.31.0 closed the relocation attack for a project that declares a `name`, and
 * left it open for every project that does not: the identity fell back to the
 * project-relative entry, which defaults to `src/main.vel` and is what all six
 * templates write — so any stranger's directory holding a `velar.json` was
 * accepted as this application's project, `{}` included, and its files were
 * published as this application's assets. The identity is the SHA-256 of the
 * manifest's own text now, which nothing but that file produces.
 *
 * The same digest makes three silent cases loud, because a manifest that was
 * deleted, corrupted or edited after the build no longer yields the identity
 * the output was built with: each one falls back to the entry's own directory
 * and says so once, on the standard error stream, as a notice about how the
 * output is deployed rather than as an error the program raised.
 */

/** A server whose two transports read the same relative root, and one that names `file`. */
const application = `
import {ServeApp, file, run, serve, staticFiles} from "velar/serve"
import {terminal} from "velar/terminal"

server api:
    @get asset(p"/asset") => file("/asset.txt", root="public")
    ...staticFiles("/static", root="public")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    await terminal.write(f"port={server.port}\\n")
    await run(server)
`;

interface RunningApp {
  readonly port: number;
  stderr(): string;
  stop(): void;
}

/** The built application, started from a directory that is not its own. */
async function serveBuiltApp(entryDirectory: string, cwd: string): Promise<RunningApp> {
  const child = spawn(process.execPath, [join(entryDirectory, "main.js")], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let error = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { error += chunk; });
  child.stdout.setEncoding("utf8");
  const port = await new Promise<number>((resolvePort, rejectPort) => {
    const deadline = setTimeout(() => rejectPort(new Error(`the built application never reported a port\n${output}\n${error}`)), 30_000);
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      const match = /^port=(\d+)$/mu.exec(output);
      if (match) { clearTimeout(deadline); resolvePort(Number(match[1])); }
    });
    child.once("exit", (code) => { clearTimeout(deadline); rejectPort(new Error(`the built application exited with ${code}\n${output}\n${error}`)); });
  });
  return { port, stderr: () => error, stop: () => { child.kill("SIGKILL"); } };
}

test("a nameless project's output refuses a stranger's velar.json, however little it says", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-identity-cwd-"));
  const deploy = await mkdtemp(join(tmpdir(), "velar-identity-deploy-"));
  const built = await runVelarProject({
    "src/main.vel": application.trimStart(),
    "public/asset.txt": "from-the-project-root\n",
  }, { command: "build", extraArguments: ["--mode", "readable"], keep: true, prefix: "velar-identity-" });
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    // The identity a nameless manifest earns is a digest, not a constant.
    assert.match(
      await readServeModule(built.root),
      /^const __velarServeProjectIdentity = "manifest:[0-9a-f]{64}";$/mu,
      "a manifest with no name is identified by its own bytes",
    );

    await mkdir(join(deploy, "public"), { recursive: true });
    await writeFile(join(deploy, "public", "asset.txt"), "FOREIGN-sibling-asset\n", "utf8");
    await writeFile(join(deploy, "public", "secret.txt"), "FOREIGN-SECRET\n", "utf8");
    await cp(join(built.root, "dist"), join(deploy, "app"), { recursive: true });
    await writeFile(join(deploy, "app", "public", "asset.txt"), "OWN-app-asset\n", "utf8");

    // The two manifests the audit found: the empty object, and the one every
    // scaffolded project wrote before 0.32.0.
    for (const manifest of ["{}", '{"formatVersion":2,"kind":"application","entry":"src/main.vel"}\n']) {
      await writeFile(join(deploy, "velar.json"), manifest, "utf8");
      const server = await serveBuiltApp(join(deploy, "app"), elsewhere);
      try {
        const base = `http://127.0.0.1:${server.port}`;
        assert.equal(await (await fetch(`${base}/asset`)).text(), "OWN-app-asset\n", `${manifest}: file() reads the assets that travelled with it`);
        assert.equal(await (await fetch(`${base}/static/asset.txt`)).text(), "OWN-app-asset\n", `${manifest}: one rule, both transports`);
        assert.equal((await fetch(`${base}/static/secret.txt`)).status, 404, `${manifest}: a file this application never published stays unpublished`);
        assert.equal(reportsIn(server.stderr()).length, 1, `${manifest}: one report, not one per request: ${server.stderr()}`);
        assert.match(
          server.stderr(),
          /^velar\/serve: \S+velar\.json belongs to a different project \(manifest:[0-9a-f]{64}, not manifest:[0-9a-f]{64}\), so relative static and upload roots resolve beside \S+ instead; rebuild this output if that manifest is its project's$/mu,
          `${manifest}: the report names both identities: ${server.stderr()}`,
        );
      } finally {
        server.stop();
      }
    }
  } finally {
    await rm(built.root, { recursive: true, force: true });
    await rm(deploy, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

/**
 * NO-U5: the three ways a project's own manifest stops answering for it. Each
 * of them turned the base over to `dist/` in silence, and the silence is what
 * made it a defect — an in-tree `dist/` that starts reading its own
 * `dist/public/` is a deployment fact no request reports.
 */
test("an output whose own manifest changed, vanished or broke falls back and says so once", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-identity-manifest-cwd-"));
  const built = await runVelarProject({
    "src/main.vel": application.trimStart(),
    "public/asset.txt": "PROJECT-public\n",
  }, { command: "build", extraArguments: ["--mode", "readable"], keep: true, prefix: "velar-identity-manifest-" });
  const manifestPath = join(built.root, "velar.json");
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    // Both candidates exist and differ, so only the contents say which answered.
    await writeFile(join(built.root, "dist", "public", "asset.txt"), "DIST-public\n", "utf8");
    const original = `${JSON.stringify({
      formatVersion: 2,
      kind: "application",
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/node"],
      surfaces: { core: "0.10", node: "0.17" },
    }, null, 2)}\n`;

    const untouched = await serveBuiltApp(join(built.root, "dist"), elsewhere);
    try {
      assert.equal(await (await fetch(`http://127.0.0.1:${untouched.port}/asset`)).text(), "PROJECT-public\n",
        "the manifest is the one the build read, so the project root answers");
      assert.equal(reportsIn(untouched.stderr()).length, 0, `an identity that agrees is not worth a sentence: ${untouched.stderr()}`);
    } finally {
      untouched.stop();
    }

    for (const [what, write, expected] of [
      // An edit no field of which is about identity still changes the digest,
      // which is the price a project pays for not declaring a `name`.
      ["edited", async () => { await writeFile(manifestPath, `${original}\n`, "utf8"); },
        /^velar\/serve: \S+velar\.json belongs to a different project \(manifest:[0-9a-f]{64}, not manifest:[0-9a-f]{64}\), so relative static and upload roots resolve beside \S+ instead; rebuild this output if that manifest is its project's$/mu],
      ["deleted", async () => { await rm(manifestPath, { force: true }); },
        /^velar\/serve: \S+velar\.json cannot be read, so manifest:[0-9a-f]{64} cannot be confirmed and relative static and upload roots resolve beside \S+ instead$/mu],
      ["unparsable", async () => { await writeFile(manifestPath, "not json", "utf8"); },
        /^velar\/serve: \S+velar\.json is not a project manifest, so manifest:[0-9a-f]{64} cannot be confirmed and relative static and upload roots resolve beside \S+ instead$/mu],
    ] as const) {
      await write();
      const server = await serveBuiltApp(join(built.root, "dist"), elsewhere);
      try {
        assert.equal(await (await fetch(`http://127.0.0.1:${server.port}/asset`)).text(), "DIST-public\n",
          `${what}: the base falls back to the entry's own directory`);
        assert.equal(reportsIn(server.stderr()).length, 1, `${what}: exactly one report: ${server.stderr()}`);
        assert.match(server.stderr(), expected, `${what}: ${server.stderr()}`);
      } finally {
        server.stop();
      }
    }
  } finally {
    await rm(built.root, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

/**
 * NO-I8: the startup audit reads as the author's own source does.
 *
 * `"pubic"` and `"./pubic"` are one directory; they were audited as two, the
 * second reporting a resolved path with a `/./` in it. And the reports arrived
 * backwards, because the list was drained from its tail.
 */
test("the startup audit normalizes each root, reports one per directory, in declaration order", async () => {
  const run = await runVelarProject({
    "src/main.vel": `
import {ServeApp, serve, staticFiles} from "velar/serve"

server api:
    ...staticFiles("/a", root="pubic")
    ...staticFiles("/b", root="./pubic")
    ...staticFiles("/c", root="pubic")
    ...staticFiles("/d", root="zzz")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    await server.stop()
`.trimStart(),
  }, { prefix: "velar-static-audit-order-" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const reports = run.stderr.split("\n").filter((line) => line.includes("does not name a directory"));
  assert.deepEqual(
    reports.map((line) => /static root '([^']+)'/u.exec(line)?.[1]),
    ["pubic", "zzz"],
    `two roots, in the order the application declared them: ${run.stderr}`,
  );
  assert.doesNotMatch(run.stderr, /\/\.\//u, `a resolved path is a path, not this module's walk: ${run.stderr}`);
});

/**
 * NO-I1: `caller` is the name a refusal has to say — the rule `velar/serve`
 * wrote down and then broke on its own shortest path, because `file()`
 * delegates to `fileResponse()` and delegated the name with it.
 */
test("a refusal earned inside file() says file", async () => {
  const run = await runVelarProject({
    "src/main.vel": `
import {ServeApp, ServeResponse, file, serve, text} from "velar/serve"
import {http} from "velar/http"

def escape(root: string) -> ServeResponse:
    try:
        return file("/asset.txt", root)
    catch failure:
        return text(f"refused: {failure.message}")

server api:
    @get climb(p"/climb") => escape(["..", "shared"].join("/"))

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    try:
        print("answer=" + (await http.get(f"http://127.0.0.1:{server.port}/climb").text()).trim())
    finally: await server.stop()
`.trimStart(),
  }, { prefix: "velar-file-caller-" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(
    run.stdout,
    /^answer=refused: file root '\.\.\/shared' leaves the project at \S+: a relative root names a directory inside it, and a directory outside it is named by an absolute path$/mu,
    run.stdout,
  );
});

/**
 * NO-I5: the same refusal in the shape it is actually deployed in.
 *
 * Thrown out of the declaration it ended module evaluation, and Node.js reports
 * that by printing the source line of the frame the error was created on — in a
 * production build, the minified `velar/serve`: one line twelve thousand
 * columns wide, followed by as many columns of caret padding, with the sentence
 * itself below the fold. The refusal is deferred to the next microtask now, and
 * a trace whose every frame names generated JavaScript is dropped on the way
 * out, because a build with no source maps has no frame the author can act on.
 */
test("a declaration-time refusal in a production build prints its sentence, not a minified line", async () => {
  const built = await runVelarProject({
    "src/main.vel": `
import {ServeApp, run, serve, staticFiles} from "velar/serve"

@main:
    const climb = ["..", "shared"].join("/")
    const app: ServeApp = staticFiles("/static", climb)
    const server = await serve(app, 0)
    await run(server)
`.trimStart(),
  }, { command: "build", keep: true, prefix: "velar-static-escape-built-" });
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    const crash = await new Promise<{ code: number | null; stderr: string }>((resolveCrash) => {
      const child = spawn(process.execPath, [join(built.root, "dist", "main.js")], { cwd: built.root, stdio: ["ignore", "ignore", "pipe"] });
      let error = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { error += chunk; });
      child.once("exit", (code) => resolveCrash({ code, stderr: error }));
    });
    assert.equal(crash.code, 1, crash.stderr);
    assert.match(
      crash.stderr,
      /staticFiles root '\.\.\/shared' leaves the project at \S+: a relative root names a directory inside it, and a directory outside it is named by an absolute path/u,
      crash.stderr,
    );
    const widest = Math.max(...crash.stderr.split("\n").map((line) => line.length));
    assert.ok(widest < 400, `no minified source line: the widest line was ${widest} columns\n${crash.stderr.slice(0, 400)}`);
    assert.doesNotMatch(crash.stderr, /node_modules\/velar\/serve\.js/u,
      `and no frame pointing into the emitted runtime, which is the line that was 12,000 columns wide: ${crash.stderr}`);
  } finally {
    await rm(built.root, { recursive: true, force: true });
  }
});

/**
 * NO-D3: the audit line is a notice about how this application is configured,
 * not an error the program reported. It went to `console.error`, which is the
 * channel `velar test` watches for failures a test never owned, so one missing
 * static root failed every test that started a server.
 */
test("a missing static root does not fail velar test", async () => {
  const run = await runVelarProject({
    "src/main.vel": `
import {ServeApp} from "velar/serve"
import {app} from "./app.vel"

@main:
    const declared: ServeApp = app
    print("ready")
`.trimStart(),
    "src/app.vel": `
import {staticFiles} from "velar/serve"

export server app:
    @get hello(p"/hello") => {message: "hello"}

    ...staticFiles("/static", root="nope")
`.trimStart(),
    "src/app.test.vel": `
import {serve} from "velar/serve"
import {expect} from "velar/test"
import {app} from "./app.vel"

test "a server with a missing static root still starts":
    const server = await serve(app, port=0)
    try:
        expect(server.port > 0).toBe(true)
    finally: await server.stop()
`.trimStart(),
  }, { command: "test", prefix: "velar-static-audit-test-" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^1 passed, 0 failed$/mu, run.stdout);
  assert.match(run.stderr, /static root 'nope' does not name a directory/u, "the notice is still written to stderr");
  assert.doesNotMatch(run.stderr, /unowned error/u, `a notice is not an unowned error: ${run.stderr}`);
});

/** The `velar/serve` a readable directory build emitted. */
async function readServeModule(projectRoot: string): Promise<string> {
  return await readFile(join(projectRoot, "dist", "node_modules", "velar", "serve.js"), "utf8");
}

/** The notice lines `velar/serve` writes about the project standing at its offset. */
function reportsIn(stderr: string): readonly string[] {
  return stderr.split("\n").filter((line) => line.startsWith("velar/serve: ") && line.includes("velar.json"));
}
