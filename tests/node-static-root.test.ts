import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runVelarProject } from "./velar-project-harness.ts";

/**
 * D114 P6 item 13 (audit SV-U2): a relative static `root` is the application's
 * own directory.
 *
 * It used to be the process working directory, and nothing said so: the same
 * build answered every `/assets/...` request with 404 when it was started from
 * the repository root and 200 when it was started from the project directory,
 * and no part of the request or the response said which of the two had
 * happened. The directory the emitted entry module sits in is a fact about the
 * build; the directory an operator happened to be standing in is not.
 *
 * Absolute roots are unchanged, and so is everything the privileged host does
 * once it has a root: it still resolves, realpaths and contains the target, so
 * a request path carrying `..` is refused exactly as before.
 */

/** The built application, started from a directory that is not its own. */
async function serveBuiltApp(root: string, cwd: string): Promise<{ readonly port: number; stop(): void }> {
  const child = spawn(process.execPath, [join(root, "dist", "main.js")], { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
  return { port, stop: () => { child.kill("SIGKILL"); } };
}

test("a relative static root resolves against the application's own directory, whatever the working directory is", async () => {
  const outside = await mkdtemp(join(tmpdir(), "velar-static-root-absolute-"));
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-static-root-cwd-"));
  await writeFile(join(outside, "asset.txt"), "absolute-root\n", "utf8");
  const built = await runVelarProject({
    "src/main.vel": `
import {ServeApp, file, run, serve, staticFiles} from "velar/serve"
import {terminal} from "velar/terminal"

server api:
    @get asset(p"/asset") => file("/asset.txt", root="assets")
    @get absolute(p"/absolute") => file("/asset.txt", root=${JSON.stringify(outside)})
    @get escape(p"/escape") => file("/../secret.txt", root="assets")
    ...staticFiles("/static", root="assets")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    await terminal.write(f"port={server.port}\\n")
    await run(server)
`.trimStart(),
  }, { command: "build", extraArguments: ["--mode", "readable"], keep: true, prefix: "velar-static-root-" });
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    // The assets ship beside the emitted entry, which is what "the
    // application's own directory" means for a built Node application.
    await mkdir(join(built.root, "dist", "assets"), { recursive: true });
    await writeFile(join(built.root, "dist", "assets", "asset.txt"), "relative-root\n", "utf8");
    // A file the root must never reach, one directory above it.
    await writeFile(join(built.root, "dist", "secret.txt"), "secret\n", "utf8");

    const server = await serveBuiltApp(built.root, elsewhere);
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const relative = await fetch(`${base}/asset`);
      assert.equal(relative.status, 200, "a relative root serves from the application directory, not the working directory");
      assert.equal(await relative.text(), "relative-root\n");

      const composed = await fetch(`${base}/static/asset.txt`);
      assert.equal(composed.status, 200, "staticFiles resolves its root the same way file() does");
      assert.equal(await composed.text(), "relative-root\n");

      const absolute = await fetch(`${base}/absolute`);
      assert.equal(absolute.status, 200, "an absolute root is used as given");
      assert.equal(await absolute.text(), "absolute-root\n");

      // The containment rules are the ones they were: a `..` segment in the
      // request path is refused before it can leave the root.
      const escaped = await fetch(`${base}/escape`);
      assert.equal(escaped.status, 404);
      assert.equal((await escaped.json() as { code: string }).code, "static.not_found", "the refusal is the framework's own problem document");
    } finally {
      server.stop();
    }
  } finally {
    await rm(built.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("the same program run from its own project directory answers the same way", async () => {
  const run = await runVelarProject({
    "src/main.vel": `
import {ServeApp, file, serve} from "velar/serve"
import {http} from "velar/http"

server api:
    @get asset(p"/asset") => file("/asset.txt", root="assets")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    try:
        try:
            const body = await http.get(f"http://127.0.0.1:{server.port}/asset").text()
            print(f"asset={body}")
        catch failure:
            print(f"asset-failed={failure.name}")
    finally: await server.stop()
`.trimStart(),
  }, { prefix: "velar-static-root-sandbox-" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  // `velar run` compiles into a sandbox under `<project>/.velar/`, so the
  // application's own directory is that sandbox and the author's `assets/` is
  // not in it. The request is refused rather than silently reading whichever
  // directory the process happened to start in — which is the whole point of
  // the rule, and the reason a served asset belongs beside the emitted entry.
  assert.match(run.stdout, /^asset-failed=HttpResponseError$/mu);
});
