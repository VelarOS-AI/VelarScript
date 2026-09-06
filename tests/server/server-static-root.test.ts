import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { velarNodeCompilerExtension } from "../../packages/node/src/compiler.ts";
import { nodeProjectIdentity, velarNodeServeProjectConfig } from "../../packages/node/src/project-config.ts";
import { velarCompilerExtension as velarServerCompilerExtension } from "../../packages/server/src/compiler.ts";
import { runVelarProject } from "../support/velar-project.ts";

/**
 * D114 SV-X1: a Server project's relative static root means what a Node
 * project's does, because it is one rule reached through one code path.
 *
 * F7-node-b item 2 and F9-node-cli item NO-D1 gave `velar/serve` two facts only
 * a build knows — `__velarServeProjectRootOffset`, the way back from the
 * directory the emitted entry landed in to the project root, and
 * `__velarServeProjectIdentity`, who the project standing there has to be — and
 * wired them for `@velarscript/node` alone, at both ends:
 *
 *  - `standardModuleSource` hands each extension only the slice of the
 *    project's extension config filed under **that extension's own id**, and a
 *    Server project's extension list is `[@velarscript/server]`. The slice the
 *    build wrote under `@velarscript/node` was never read.
 *  - `@velarscript/server`'s `modules.source` answered every specifier that is
 *    not `velar/server` out of its static table, which holds Node's
 *    *unparameterized* `velar/serve`. Even the right slice would have gone
 *    nowhere.
 *
 * So a Server project baked `""` for both, and a relative static root resolved
 * against the emitted entry's own directory: `<project>/.velar/<prefix>-XXXX/`
 * under `velar run`, `velar dev` and `velar test`, and the output directory
 * under `velar build`. The author's `public/` is in none of them. The `node`
 * create template is a Server project whose `src/app.vel` ends in
 * `...staticFiles("/", root="public", fallback="index.html")`, so the template
 * tripped this on the first request it ever served.
 *
 * The fix moves both halves to where every extension set reaches them:
 * `velarNodeServeProjectConfig` files the facts under the id of whichever
 * extension carries `velar/serve`, and Server composes Node's own
 * `modules.source` the way it already composes Node's parser, analyzer and
 * emitter. The behaviour asserted below is `tests/node/node-static-root.test.ts`
 * asserted again on the surface that composes it — which is the point: neither
 * file describes a Server rule, because there is not one.
 */

const cli = resolve("packages/cli/src/cli.ts");

/**
 * The Server surface's own probe manifest, written over the Node one
 * `runVelarProject` starts from. `server.configuration` is required of every
 * Server project, and nothing in the file it names matters here.
 */
const serverManifest = `${JSON.stringify({
  formatVersion: 2,
  kind: "application",
  entry: "src/main.vel",
  outDir: "dist",
  extensions: ["@velarscript/server"],
  surfaces: { core: "0.8", server: "0.15" },
  server: { configuration: "application.yml" },
}, null, 2)}\n`;

/**
 * `public/` and `assets/` both sit in the project root and neither is copied
 * into a sandbox or a build output, so an answer from either one can only have
 * travelled through the offset this item is about.
 */
const projectFiles = {
  "velar.json": serverManifest,
  "application.yml": "server:\n  host: 127.0.0.1\n  port: 0\n  maxBodyBytes: 16777216\n",
  "public/asset.txt": "public-from-the-project-root\n",
  "assets/asset.txt": "assets-from-the-project-root\n",
} as const;

/** A program that serves its own project's directories and reports what it got. */
const prober = `import {ServeApp, file, serve, staticFiles} from "velar/serve"
import {http} from "velar/http"

server api:
    @get public(p"/public") => file("/asset.txt", root="public")
    @get assets(p"/assets") => file("/asset.txt", root="assets")
    ...staticFiles("/static", root="assets")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    try:
        for name in ["public", "assets", "static/asset.txt"]:
            try:
                const body = await http.get(f"http://127.0.0.1:{server.port}/{name}").text()
                print(f"{name}={body.trim()}")
            catch failure:
                print(f"{name}-failed={failure.name}")
    finally: await server.stop()
`;

/** The same server, kept running and reporting its port, for `velar dev` and a build. */
const server = `import {ServeApp, file, run, serve, staticFiles} from "velar/serve"
import {terminal} from "velar/terminal"

server api:
    @get asset(p"/asset") => file("/asset.txt", root="assets")
    ...staticFiles("/static", root="assets")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    await terminal.write(f"port={server.port}\\n")
    await run(server)
`;

/** The port a spawned server reported on its own stdout, or the output that explains why not. */
async function reportedPort(child: ChildProcess): Promise<number> {
  assert.ok(child.stdout && child.stderr);
  let output = "";
  let error = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { error += chunk; });
  child.stdout.setEncoding("utf8");
  return await new Promise<number>((resolvePort, rejectPort) => {
    const deadline = setTimeout(() => rejectPort(new Error(`no port was reported\n${output}\n${error}`)), 60_000);
    child.stdout!.on("data", (chunk: string) => {
      output += chunk;
      const match = /^port=(\d+)$/mu.exec(output);
      if (match) { clearTimeout(deadline); resolvePort(Number(match[1])); }
    });
    child.once("exit", (code) => { clearTimeout(deadline); rejectPort(new Error(`the server exited with ${code}\n${output}\n${error}`)); });
  });
}

/** Ends a spawned server and waits for it, so no test leaves a process behind. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGKILL");
  await exited;
}

/**
 * The same for `velar dev`, which owns a child of its own: it is asked to stop
 * rather than killed, because a killed launcher would leave the application it
 * started running with nobody holding its port.
 */
async function stopDevelopment(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settled = await Promise.race([
    exited.then(() => "exited" as const),
    new Promise<"stuck">((done) => { timer = setTimeout(() => done("stuck"), 15_000); }),
  ]);
  if (timer !== null) clearTimeout(timer);
  if (settled === "stuck") {
    child.kill("SIGKILL");
    await exited;
    assert.fail("velar dev did not stop when asked");
  }
}

test("velar run serves a Server project's own directories, started from anywhere else", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-server-static-root-cwd-"));
  try {
    const run = await runVelarProject(
      { ...projectFiles, "src/main.vel": prober },
      { prefix: "velar-server-static-root-", cwd: elsewhere },
    );
    const report = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 0, report);
    assert.match(run.stdout, /^public=public-from-the-project-root$/mu, report);
    assert.match(run.stdout, /^assets=assets-from-the-project-root$/mu, report);
    assert.match(run.stdout, /^static\/asset\.txt=assets-from-the-project-root$/mu, "one rule, both transports");
  } finally {
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("velar test serves a Server project's own directories, started from anywhere else", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-server-static-root-test-cwd-"));
  try {
    const run = await runVelarProject({
      ...projectFiles,
      "src/main.vel": prober,
      "src/static.test.vel": `import {ServeApp, file, serve, staticFiles} from "velar/serve"
import {http} from "velar/http"
import {expect} from "velar/test"

server api:
    @get asset(p"/asset") => file("/asset.txt", root="assets")
    ...staticFiles("/static", root="assets")

test "a relative static root is the project's own":
    const app: ServeApp = api
    const server = await serve(app, 0)
    try:
        const direct = await http.get(f"http://127.0.0.1:{server.port}/asset").text()
        expect(direct.trim()).toBe("assets-from-the-project-root")
        const composed = await http.get(f"http://127.0.0.1:{server.port}/static/asset.txt").text()
        expect(composed.trim()).toBe("assets-from-the-project-root")
    finally: await server.stop()
`,
    }, { command: "test", prefix: "velar-server-static-root-test-", cwd: elsewhere });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /a relative static root is the project's own/u, run.stdout);
  } finally {
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("velar dev serves a Server project's own directories, started from anywhere else", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-server-static-root-dev-cwd-"));
  const project = await runVelarProject(
    { ...projectFiles, "src/main.vel": server },
    { command: "check", keep: true, prefix: "velar-server-static-root-dev-" },
  );
  assert.equal(project.status, 0, `${project.stdout}\n${project.stderr}`);
  // `velar dev` compiles into `<project>/.velar/dev-XXXX/` and starts the app
  // with its own stdio, so the port the program reports arrives here.
  const running = spawn(process.execPath, [cli, "dev", project.root], { cwd: elsewhere, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await reportedPort(running);
    const direct = await fetch(`http://127.0.0.1:${port}/asset`);
    assert.equal(direct.status, 200, "a relative root under velar dev is the project's own");
    assert.equal(await direct.text(), "assets-from-the-project-root\n");
    const composed = await fetch(`http://127.0.0.1:${port}/static/asset.txt`);
    assert.equal(composed.status, 200, "one rule, both transports");
    assert.equal(await composed.text(), "assets-from-the-project-root\n");
  } finally {
    await stopDevelopment(running);
    await rm(project.root, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("a Server build bakes the offset and the identity, and a relocated copy serves what travelled with it", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-server-static-build-cwd-"));
  const moved = await mkdtemp(join(tmpdir(), "velar-server-static-build-moved-"));
  const built = await runVelarProject(
    { ...projectFiles, "src/main.vel": server },
    {
      command: "build",
      extraArguments: ["--mode", "readable"],
      keep: true,
      prefix: "velar-server-static-build-",
    },
  );
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    // GA-U4 for the Server surface: the two lines only a build knows, named
    // rather than watched from a distance by `output-fingerprint.lock`.
    const emitted = await readFile(join(built.root, "dist", "node_modules", "velar", "serve.js"), "utf8");
    assert.match(emitted, /^const __velarServeProjectRootOffset = "\.\.";$/mu, "a directory build sits one level below its project");
    assert.match(emitted, /^const __velarServeProjectIdentity = "entry:src\/main\.vel";$/mu);

    const inTree = spawn(process.execPath, [join(built.root, "dist", "main.js")], { cwd: elsewhere, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const port = await reportedPort(inTree);
      const response = await fetch(`http://127.0.0.1:${port}/asset`);
      assert.equal(response.status, 200, "the built Server app serves the project it was built from");
      assert.equal(await response.text(), "assets-from-the-project-root\n");
    } finally {
      await stop(inTree);
    }

    // The same output, carried away from the project it was built in, with an
    // `assets/` of its own travelling beside the entry — nothing copies the
    // project's in, which is what makes this directory the sharp one. The
    // offset names a directory that is not there, so what stands beside the
    // entry is what the application serves.
    await cp(join(built.root, "dist"), join(moved, "app"), { recursive: true });
    await mkdir(join(moved, "app", "assets"), { recursive: true });
    await writeFile(join(moved, "app", "assets", "asset.txt"), "beside-the-entry\n", "utf8");
    const relocated = spawn(process.execPath, [join(moved, "app", "main.js")], { cwd: elsewhere, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const port = await reportedPort(relocated);
      const response = await fetch(`http://127.0.0.1:${port}/asset`);
      assert.equal(response.status, 200, "a relocated Server output serves the assets that travelled with it");
      assert.equal(await response.text(), "beside-the-entry\n");
    } finally {
      await stop(relocated);
    }
  } finally {
    await rm(built.root, { recursive: true, force: true });
    await rm(moved, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("a Server project's static root that climbs out of the project is refused by the build", async () => {
  const checked = await runVelarProject({
    ...projectFiles,
    "src/main.vel": `import {ServeApp, file, serve, staticFiles} from "velar/serve"

server api:
    @get escape(p"/escape") => file("/asset.txt", root="../shared")
    ...staticFiles("/static", root="assets/../../shared")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    await server.stop()
`,
  }, { command: "check", prefix: "velar-server-static-escape-" });
  assert.notEqual(checked.status, 0, checked.stdout);
  for (const root of ["../shared", "assets/../../shared"]) {
    assert.match(
      checked.stderr,
      new RegExp(`error VEL4001: A relative static root names a directory inside the project; '${root.replaceAll(".", "\\.").replaceAll("/", "\\/")}' leaves it`, "u"),
      checked.stderr,
    );
  }
});

/**
 * The rule the two ends now share, stated once: the facts go to whichever
 * extension will be asked for `velar/serve`, and to no other. That is derived
 * from the extension's own module table rather than from a list of package
 * names, so an extension set that does not carry the module — Desktop's, whose
 * Node side grants capability modules and serves nothing, and Web's — bakes
 * nothing, because nothing in it would read the facts.
 */
test("the project root offset and identity are filed under the extension that carries velar/serve", () => {
  const identity = nodeProjectIdentity(null, "src/main.vel");
  assert.equal(identity, "entry:src/main.vel");

  for (const extension of [velarNodeCompilerExtension, velarServerCompilerExtension]) {
    assert.ok(extension.modules?.sources.has("velar/serve"), `${extension.id} carries velar/serve`);
    const configured = velarNodeServeProjectConfig(new Map(), [extension], "../..", identity);
    assert.deepEqual([...configured.keys()], [extension.id]);
    assert.deepEqual(configured.get(extension.id), {
      projectRootOffset: "../..",
      projectIdentity: "entry:src/main.vel",
    });
    // The slice a Server build already writes — `velar/server`'s artifact
    // configuration path — is merged rather than replaced.
    const beside = velarNodeServeProjectConfig(
      new Map([[extension.id, { configuration: "application.yml" }]]),
      [extension],
      "..",
      identity,
    );
    assert.deepEqual(beside.get(extension.id), {
      configuration: "application.yml",
      projectRootOffset: "..",
      projectIdentity: "entry:src/main.vel",
    });
  }

  assert.equal(velarNodeServeProjectConfig(new Map(), [], "..", identity).size, 0, "no carrier, nothing to bake");
  // Only an output *inside* its project bakes an offset, so two builds of one
  // project write the same bytes wherever either one runs.
  assert.equal(velarNodeServeProjectConfig(new Map(), [velarServerCompilerExtension], "../elsewhere", identity).size, 0);
});
