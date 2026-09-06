import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runVelarProject } from "../support/velar-project.ts";

/**
 * D114 P6 item 13 (audit SV-U2), refined by F7-node-b item 2: a relative static
 * `root` is relative to the **project root the build knew**.
 *
 * It used to be the process working directory, and nothing said so: the same
 * build answered every `/assets/...` request with 404 when it was started from
 * the repository root and 200 when it was started from the project directory,
 * and no part of the request or the response said which of the two had
 * happened. Where the build put the entry is a fact about the build; the
 * directory an operator happened to be standing in is not.
 *
 * Item 13 answered that with the emitted entry's own directory, which is the
 * project root for neither of the two ways a Node application is built:
 * `velar run` compiles into `<project>/.velar/run-XXXX/` and a directory build
 * writes into `--out-dir`, so an author's `public/` sat one or two directories
 * above whatever the rule pointed at. The build knows that offset, bakes it
 * into the emitted `velar/serve`, and a relative root resolves through it —
 * with the entry's own directory kept as the answer for an output that was
 * copied away from the project it was built in and carries its assets
 * alongside.
 *
 * Absolute roots are unchanged, and so is everything the privileged host does
 * once it has a root: it still resolves, realpaths and contains the target, so
 * a request path carrying `..` is refused exactly as before.
 */

const application = `
import {ServeApp, file, run, serve, staticFiles} from "velar/serve"
import {terminal} from "velar/terminal"

server api:
    @get asset(p"/asset") => file("/asset.txt", root="public")
    @get absolute(p"/absolute") => file("/asset.txt", root=ABSOLUTE)
    @get escape(p"/escape") => file("/../secret.txt", root="public")
    ...staticFiles("/static", root="public")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    await terminal.write(f"port={server.port}\\n")
    await run(server)
`;

/** The built application, started from a directory that is not its own. */
async function serveBuiltApp(entryDirectory: string, cwd: string): Promise<{ readonly port: number; stop(): void }> {
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
  return { port, stop: () => { child.kill("SIGKILL"); } };
}

test("a directory build serves its project's own public/, and a relocated copy serves what is beside it", async () => {
  const outside = await mkdtemp(join(tmpdir(), "velar-static-root-absolute-"));
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-static-root-cwd-"));
  const moved = await mkdtemp(join(tmpdir(), "velar-static-root-moved-"));
  await writeFile(join(outside, "asset.txt"), "absolute-root\n", "utf8");
  const built = await runVelarProject({
    "src/main.vel": application.trimStart().replace("ABSOLUTE", JSON.stringify(outside)),
    "public/asset.txt": "from-the-project-root\n",
    // A file the root must never reach, one directory above it.
    "secret.txt": "secret\n",
  }, { command: "build", extraArguments: ["--mode", "readable"], keep: true, prefix: "velar-static-root-" });
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    // The build copies `public/` into the output too, so both candidates exist
    // and only their contents say which one answered. Nothing else in this test
    // could tell them apart, which is exactly why they are made to differ.
    await writeFile(join(built.root, "dist", "public", "asset.txt"), "from-the-output-directory\n", "utf8");

    const server = await serveBuiltApp(join(built.root, "dist"), elsewhere);
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const relative = await fetch(`${base}/asset`);
      assert.equal(relative.status, 200, "a relative root serves from the project directory, not the working directory");
      assert.equal(await relative.text(), "from-the-project-root\n");

      const composed = await fetch(`${base}/static/asset.txt`);
      assert.equal(composed.status, 200, "staticFiles resolves its root the same way file() does");
      assert.equal(await composed.text(), "from-the-project-root\n");

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

    // The same output, carried away from the project it was built in. The
    // offset now names a directory that is not there, so the assets beside the
    // entry are what the application serves.
    await cp(join(built.root, "dist"), join(moved, "app"), { recursive: true });
    await writeFile(join(moved, "app", "public", "asset.txt"), "beside-the-entry\n", "utf8");
    const relocated = await serveBuiltApp(join(moved, "app"), elsewhere);
    try {
      const response = await fetch(`http://127.0.0.1:${relocated.port}/asset`);
      assert.equal(response.status, 200, "a relocated output serves the assets that travelled with it");
      assert.equal(await response.text(), "beside-the-entry\n");
    } finally {
      relocated.stop();
    }
  } finally {
    await rm(built.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
    await rm(moved, { recursive: true, force: true });
  }
});

test("velar run serves the author's own directories, from the project root or anywhere else", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-static-root-sandbox-cwd-"));
  const files = {
    "src/main.vel": `
import {ServeApp, file, serve} from "velar/serve"
import {http} from "velar/http"

server api:
    @get public(p"/public") => file("/asset.txt", root="public")
    @get assets(p"/assets") => file("/asset.txt", root="assets")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    try:
        for name in ["public", "assets"]:
            try:
                const body = await http.get(f"http://127.0.0.1:{server.port}/{name}").text()
                print(f"{name}={body.trim()}")
            catch failure:
                print(f"{name}-failed={failure.name}")
    finally: await server.stop()
`.trimStart(),
    "public/asset.txt": "public-from-the-project-root\n",
    // `velar run` compiles into `<project>/.velar/run-XXXX/`, and nothing copies
    // `assets/` in there — so this one can only be answered through the offset
    // the build baked, which is what makes it the sharp half of this test.
    "assets/asset.txt": "assets-from-the-project-root\n",
  };
  try {
    for (const [where, cwd] of [["its own project root", undefined], ["another directory", elsewhere]] as const) {
      const run = await runVelarProject(files, { prefix: "velar-static-root-sandbox-", ...(cwd === undefined ? {} : { cwd }) });
      const report = `started from ${where}: ${run.stdout}\n${run.stderr}`;
      assert.equal(run.status, 0, report);
      assert.match(run.stdout, /^public=public-from-the-project-root$/mu, report);
      assert.match(run.stdout, /^assets=assets-from-the-project-root$/mu, report);
    }
  } finally {
    await rm(elsewhere, { recursive: true, force: true });
  }
});
