import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
 *
 * The write side is the same rule. `Upload.save(path, root)` names a directory
 * the way `file()` and `staticFiles()` do, and it read that name against the
 * process working directory for as long as they did; the last two tests here
 * are the read tests above, run through a save. One resolver answers both —
 * `velar/serve`'s `__velarServeApplicationRoot` — and only the check that
 * chooses between its two candidates differs, because the upload path can ask
 * `velar/fs` whether a directory is there and a `fileResponse` value, which is
 * data crossing to the privileged host, cannot.
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

/**
 * The write side's routes, shared by both upload tests: a relative root, an
 * absolute one, and a path that tries to climb out of the root it was handed.
 * `store` answers in text so a refusal arrives as the sentence the runtime
 * wrote — which is what makes the `..` case readable when it goes red.
 */
const uploadRoutes = `
async def store(image: Upload, root: string, path: string) -> ServeResponse:
    try:
        await image.save(path, root)
        return text("saved")
    catch failure:
        return text(f"refused: {failure.message}")

server files:
    @post relative(p"/relative", image=input.upload("image")) => store(image, "uploads", "cover.txt")
    @post absolute(p"/absolute", image=input.upload("image")) => store(image, ABSOLUTE, "cover.txt")
    @post escape(p"/escape", image=input.upload("image")) => store(image, "uploads", "../escaped.txt")
`;

const UPLOAD_BOUNDARY = "velar-upload-boundary";
const uploadContentType = `multipart/form-data; boundary=${UPLOAD_BOUNDARY}`;
const uploadBody = [
  `--${UPLOAD_BOUNDARY}`,
  'Content-Disposition: form-data; name="image"; filename="cover.txt"',
  "Content-Type: text/plain",
  "",
  "pixels",
  `--${UPLOAD_BOUNDARY}--`,
  "",
].join("\r\n");

/** One upload posted to a route of the application under test, as text. */
async function saveUpload(port: number, route: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/${route}`, {
    method: "POST",
    headers: { "content-type": uploadContentType },
    body: uploadBody,
  });
  assert.equal(response.status, 200, `POST /${route} answered ${response.status}`);
  return await response.text();
}

test("a directory build saves an upload under its own project, and a relocated copy beside itself", async () => {
  const outside = await mkdtemp(join(tmpdir(), "velar-upload-root-absolute-"));
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-upload-root-cwd-"));
  const moved = await mkdtemp(join(tmpdir(), "velar-upload-root-moved-"));
  const built = await runVelarProject({
    "src/main.vel": `import {ServeApp, ServeResponse, Upload, input, run, serve, text} from "velar/serve"
import {terminal} from "velar/terminal"
${uploadRoutes.replace("ABSOLUTE", JSON.stringify(outside))}
@main:
    const app: ServeApp = files
    const server = await serve(app, 0)
    await terminal.write(f"port={server.port}\\n")
    await run(server)
`,
    // Nothing copies this into `dist`, so a save that lands here can only have
    // resolved through the offset the build baked — and the working directory
    // the server is started from has no `uploads/` at all.
    "uploads/.keep": "",
  }, { command: "build", extraArguments: ["--mode", "readable"], keep: true, prefix: "velar-upload-root-" });
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);

    const server = await serveBuiltApp(join(built.root, "dist"), elsewhere);
    try {
      assert.equal(await saveUpload(server.port, "relative"), "saved");
      assert.equal(await readFile(join(built.root, "uploads", "cover.txt"), "utf8"), "pixels",
        "a relative root writes into the project directory, not the working directory");

      assert.equal(await saveUpload(server.port, "absolute"), "saved");
      assert.equal(await readFile(join(outside, "cover.txt"), "utf8"), "pixels", "an absolute root is used as given");

      // Resolving the root elsewhere cannot open a way out of it. The refusal is
      // the one it always was, it still names what the caller wrote rather than
      // where the root turned out to be, and nothing is written.
      assert.equal(await saveUpload(server.port, "escape"),
        "refused: Upload.save path escapes its root: it has a '..' segment");
      await assert.rejects(readFile(join(built.root, "escaped.txt"), "utf8"), "a refused save left a file outside the root");
    } finally {
      server.stop();
    }

    // The same output, carried away from the project it was built in, with an
    // `uploads/` of its own travelling beside the entry. The offset now names a
    // directory that is not there, so the save lands in the one that is.
    await cp(join(built.root, "dist"), join(moved, "app"), { recursive: true });
    await mkdir(join(moved, "app", "uploads"), { recursive: true });
    const relocated = await serveBuiltApp(join(moved, "app"), elsewhere);
    try {
      assert.equal(await saveUpload(relocated.port, "relative"), "saved");
      assert.equal(await readFile(join(moved, "app", "uploads", "cover.txt"), "utf8"), "pixels",
        "a relocated output saves beside the entry that travelled with it");
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

test("velar run saves an upload into the author's own directory, started from anywhere else", async () => {
  const outside = await mkdtemp(join(tmpdir(), "velar-upload-root-sandbox-absolute-"));
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-upload-root-sandbox-cwd-"));
  const part = uploadBody.replaceAll("\r\n", "\\r\\n").replaceAll('"', '\\"');
  const files = {
    "src/main.vel": `import {ServeApp, ServeResponse, Upload, input, serve, text} from "velar/serve"
import {http} from "velar/http"
${uploadRoutes.replace("ABSOLUTE", JSON.stringify(outside))}
@main:
    const app: ServeApp = files
    const server = await serve(app, 0)
    const headers = Map([["content-type", "${uploadContentType}"]])
    try:
        for name in ["relative", "absolute", "escape"]:
            const answer = await http.post(f"http://127.0.0.1:{server.port}/{name}", {headers: headers, body: "${part}"}).text()
            print(f"{name}={answer}")
    finally: await server.stop()
`,
    // `velar run` compiles into `<project>/.velar/run-XXXX/`, and nothing copies
    // `uploads/` in there, so the sandbox cannot answer this on its own.
    "uploads/.keep": "",
  };
  const run = await runVelarProject(files, { prefix: "velar-upload-root-sandbox-", cwd: elsewhere, keep: true });
  const report = `${run.stdout}\n${run.stderr}`;
  try {
    assert.equal(run.status, 0, report);
    assert.match(run.stdout, /^relative=saved$/mu, report);
    assert.match(run.stdout, /^absolute=saved$/mu, report);
    assert.match(run.stdout, /^escape=refused: Upload\.save path escapes its root: it has a '\.\.' segment$/mu, report);
    assert.equal(await readFile(join(run.root, "uploads", "cover.txt"), "utf8"), "pixels",
      "the sandboxed program saves into the project directory it was compiled from");
    assert.equal(await readFile(join(outside, "cover.txt"), "utf8"), "pixels", "an absolute root is used as given");
    await assert.rejects(readFile(join(run.root, "escaped.txt"), "utf8"), "a refused save left a file outside the root");
  } finally {
    await rm(run.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});
