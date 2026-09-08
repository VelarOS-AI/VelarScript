import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { velarNodeCompilerExtension } from "../../packages/node/src/compiler.ts";
import { velarNodeServeSource } from "../../packages/node/src/modules/serve.ts";
import { MAX_PROJECT_NAME_LENGTH, nodeProjectIdentity, velarNodeServeProjectConfig } from "../../packages/node/src/project-config.ts";
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

/**
 * The built application, started from a directory that is not its own.
 * `stderr()` is everything the program has written there so far, for the one
 * case `velar/serve` reports rather than answers — a project standing at the
 * offset that is somebody else's.
 */
async function serveBuiltApp(entryDirectory: string, cwd: string): Promise<{ readonly port: number; stderr(): string; stop(): void }> {
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

/**
 * D114 F9-node-cli, audit NO-D1: the offset names a *place*, and a place is not
 * an identity.
 *
 * Item 13's rule chose between "the project root the build knew" and "beside
 * the entry" by which of the two directories existed, and existence proves
 * nothing about ownership: a `dist/` copied into a `deploy/` that already held
 * a stranger's `deploy/public/` served the stranger's files as this
 * application's assets — including `secret.txt`, a file the application never
 * published — through both transports, with no diagnostic anywhere. The build
 * bakes the project's identity now, and the project-root candidate holds only
 * when the `velar.json` actually standing at that offset says it is this
 * project's.
 *
 * The three cases below are the three answers: the manifest that matches, a
 * stranger's manifest, and no manifest at all.
 */
test("a relocated output serves the project directory beside it only when that project is its own", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-static-identity-cwd-"));
  const built = await runVelarProject({
    "src/main.vel": application.trimStart().replace("ABSOLUTE", JSON.stringify(elsewhere)),
    "public/asset.txt": "from-the-project-root\n",
    "secret.txt": "secret\n",
  }, { command: "build", extraArguments: ["--mode", "readable"], keep: true, prefix: "velar-static-identity-" });
  const deploy = await mkdtemp(join(tmpdir(), "velar-static-identity-deploy-"));
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    // The stranger's assets, one directory above where the output will stand.
    await mkdir(join(deploy, "public"), { recursive: true });
    await writeFile(join(deploy, "public", "asset.txt"), "FOREIGN-sibling-asset\n", "utf8");
    await writeFile(join(deploy, "public", "secret.txt"), "FOREIGN-SECRET\n", "utf8");
    await cp(join(built.root, "dist"), join(deploy, "app"), { recursive: true });
    await writeFile(join(deploy, "app", "public", "asset.txt"), "OWN-app-asset\n", "utf8");

    for (const [manifest, expected] of [
      [null, "no velar.json at the offset"],
      ['{"formatVersion": 2, "kind": "application", "entry": "src/other.vel"}\n', "a stranger's velar.json at the offset"],
    ] as const) {
      if (manifest === null) await rm(join(deploy, "velar.json"), { force: true });
      else await writeFile(join(deploy, "velar.json"), manifest, "utf8");
      const server = await serveBuiltApp(join(deploy, "app"), elsewhere);
      try {
        const base = `http://127.0.0.1:${server.port}`;
        const own = await fetch(`${base}/asset`);
        assert.equal(await own.text(), "OWN-app-asset\n", `${expected}: the output serves the assets that travelled with it`);
        const composed = await fetch(`${base}/static/asset.txt`);
        assert.equal(await composed.text(), "OWN-app-asset\n", `${expected}: one rule, both transports`);
        const secret = await fetch(`${base}/static/secret.txt`);
        assert.equal(secret.status, 404, `${expected}: a file the application never published stays unpublished`);
      } finally {
        server.stop();
      }
    }

    // And the project it really was built from, wherever that project stands:
    // the manifest matches, so the project root answers and the copy of
    // `public/` inside the output is the one that goes unread (NO-U1).
    const inTree = await serveBuiltApp(join(built.root, "dist"), elsewhere);
    try {
      await writeFile(join(built.root, "dist", "public", "asset.txt"), "from-the-output-directory\n", "utf8");
      const response = await fetch(`http://127.0.0.1:${inTree.port}/asset`);
      assert.equal(await response.text(), "from-the-project-root\n");
    } finally {
      inTree.stop();
    }
  } finally {
    await rm(built.root, { recursive: true, force: true });
    await rm(deploy, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

/**
 * D114 F9-node-cli residual 1, ruled for 0.31.0: the case NO-D1 left open.
 *
 * Without a name the baked identity is the project-relative entry, and
 * `src/main.vel` is what every scaffolded project declares — so two Node
 * projects that both took the default entry were one project as far as an
 * output could tell, and a `dist/` dropped into the second one went on
 * publishing the second one's `public/`. `velar.json`'s optional `name` is what
 * separates them, and this is the test that only it can pass: the entry at the
 * offset is identical, so the name is the whole of the disagreement.
 *
 * Disagreeing is also the one case `velar/serve` says something about. The
 * output is standing inside somebody else's project and every relative root it
 * was written against now means a directory beside the entry, which is a fact
 * about the deployment that no request can report.
 */
test("a relocated output refuses a project that shares its entry but not its name", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-static-name-cwd-"));
  const built = await runVelarProject({
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      name: "storefront",
      kind: "application",
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/node"],
      surfaces: { core: "0.9", node: "0.17" },
    }, null, 2)}\n`,
    "src/main.vel": application.trimStart().replace("ABSOLUTE", JSON.stringify(elsewhere)),
    "public/asset.txt": "from-the-storefront-project\n",
    "secret.txt": "secret\n",
  }, { command: "build", extraArguments: ["--mode", "readable"], keep: true, prefix: "velar-static-name-" });
  const deploy = await mkdtemp(join(tmpdir(), "velar-static-name-deploy-"));
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    assert.match(
      await readFile(join(built.root, "dist", "node_modules", "velar", "serve.js"), "utf8"),
      /^const __velarServeProjectIdentity = "name:storefront";$/mu,
      "a manifest that names itself is baked as its name",
    );

    // The neighbour: the same entry, its own assets, and a different name.
    await mkdir(join(deploy, "public"), { recursive: true });
    await writeFile(join(deploy, "public", "asset.txt"), "WAREHOUSE-sibling-asset\n", "utf8");
    await writeFile(join(deploy, "public", "secret.txt"), "WAREHOUSE-SECRET\n", "utf8");
    await writeFile(join(deploy, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      name: "warehouse",
      kind: "application",
      entry: "src/main.vel",
    }, null, 2)}\n`, "utf8");
    await cp(join(built.root, "dist"), join(deploy, "app"), { recursive: true });
    await writeFile(join(deploy, "app", "public", "asset.txt"), "OWN-app-asset\n", "utf8");

    const server = await serveBuiltApp(join(deploy, "app"), elsewhere);
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const own = await fetch(`${base}/asset`);
      assert.equal(await own.text(), "OWN-app-asset\n", "the entries match and the names do not, so the entry directory answers");
      const composed = await fetch(`${base}/static/asset.txt`);
      assert.equal(await composed.text(), "OWN-app-asset\n", "one rule, both transports");
      const secret = await fetch(`${base}/static/secret.txt`);
      assert.equal(secret.status, 404, "a file the application never published stays unpublished");
      assert.match(
        server.stderr(),
        /^velar\/serve: \S+velar\.json belongs to a different project \(name:warehouse, not name:storefront\), so relative static and upload roots resolve beside \S+ instead; rebuild this output if that manifest is its project's$/mu,
        `the mismatch is reported once, and names both projects: ${server.stderr()}`,
      );
    } finally {
      server.stop();
    }

    // And the project that really did name itself `storefront`: the identities
    // agree, so the project root answers and the copy of `public/` inside the
    // output goes unread.
    const inTree = await serveBuiltApp(join(built.root, "dist"), elsewhere);
    try {
      await writeFile(join(built.root, "dist", "public", "asset.txt"), "from-the-output-directory\n", "utf8");
      const response = await fetch(`http://127.0.0.1:${inTree.port}/asset`);
      assert.equal(await response.text(), "from-the-storefront-project\n");
      assert.equal(inTree.stderr(), "", "an identity that agrees is not worth a sentence");
    } finally {
      inTree.stop();
    }
  } finally {
    await rm(built.root, { recursive: true, force: true });
    await rm(deploy, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

/**
 * GA-U4: the two lines only a build knows, named by a test rather than watched
 * from a distance by `output-fingerprint.lock`.
 *
 * `projectRootOffset` had no test anywhere in `tests/` that named it: its
 * behaviour was pinned as a black box above and the constant itself only by the
 * fingerprint, which says a byte changed without saying which fact moved.
 */
test("velar/serve bakes the project root offset and the project identity a build knows", () => {
  const none = velarNodeServeSource();
  assert.match(none, /^const __velarServeProjectRootOffset = "";$/mu, "no config bakes no offset");
  assert.match(none, /^const __velarServeProjectIdentity = "";$/mu, "and no identity to check it against");

  // D114 F10-node, audit NO-D1: a manifest that declares no `name` is
  // identified by the SHA-256 of its own text, so no two manifests share an
  // identity by taking the same default entry.
  const digest = createHash("sha256").update('{"formatVersion": 2}\n', "utf8").digest("hex");
  const config = velarNodeServeProjectConfig(new Map(), [velarNodeCompilerExtension], "../..", nodeProjectIdentity(null, digest));
  const configured = config.get("@velarscript/node") as { readonly projectRootOffset: string; readonly projectIdentity: string };
  assert.equal(configured.projectRootOffset, "../..", "the velar run sandbox sits two directories below its project");
  assert.equal(configured.projectIdentity, `manifest:${digest}`);
  const source = velarNodeServeSource(configured);
  assert.match(source, /^const __velarServeProjectRootOffset = "\.\.\/\.\.";$/mu);
  assert.match(source, new RegExp(`^const __velarServeProjectIdentity = "manifest:${digest}";$`, "mu"));
  // One definition, two referees: the emitted module carries the compiled
  // source of the same function the build derived its identity from.
  assert.match(source, /^const __velarServeProjectIdentityOf = function nodeProjectIdentity\(/mu);

  // Only an output *inside* its project bakes an offset, so two builds of one
  // project write the same bytes wherever either one runs.
  assert.equal(velarNodeServeProjectConfig(new Map(), [velarNodeCompilerExtension], "../elsewhere", `manifest:${digest}`).size, 0);

  // D114 F9-node-cli residual 1: the identity's other spelling. A manifest that
  // names itself is identified by that name rather than by its bytes, so it can
  // be edited without the output it was built into losing its own project.
  assert.equal(nodeProjectIdentity("storefront", digest), "name:storefront");
  const named = velarNodeServeProjectConfig(new Map(), [velarNodeCompilerExtension], "..", nodeProjectIdentity("storefront", digest));
  assert.match(
    velarNodeServeSource(named.get("@velarscript/node")),
    /^const __velarServeProjectIdentity = "name:storefront";$/mu,
  );

  // NO-I9: one bound, both referees. A name past it is not a name this
  // toolchain accepts, so the identity derivation does not accept one either.
  assert.equal(MAX_PROJECT_NAME_LENGTH, 100);
  assert.equal(nodeProjectIdentity("\u{1F680}".repeat(50), digest), `name:${"\u{1F680}".repeat(50)}`, "100 UTF-16 code units is a name");
  assert.equal(nodeProjectIdentity(`${"\u{1F680}".repeat(50)}a`, digest), `manifest:${digest}`, "101 is not, and the digest answers instead");
});

/**
 * D114 F9-node-cli, audit NO-U2: a root that leaves the project.
 *
 * `root="../shared-public"` passed `velar check` and served files the project
 * does not contain, while every other part of this toolchain refuses source
 * that leaves the project. A literal is refused by the build, which is the
 * first thing that can see it; the runtime refuses whatever reaches it, so a
 * computed root is refused too — `staticFiles` while the application is still
 * being assembled, and `file`/`fileResponse` when a route reaches them.
 */
test("a static root that climbs out of the project is refused by the build and by the runtime", async () => {
  const checked = await runVelarProject({
    "src/main.vel": `
import {ServeApp, file, serve, staticFiles} from "velar/serve"

server api:
    @get escape(p"/escape") => file("/asset.txt", root="../shared")
    ...staticFiles("/static", root="assets/../../shared")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    await server.stop()
`.trimStart(),
  }, { command: "check", prefix: "velar-static-escape-" });
  assert.notEqual(checked.status, 0, checked.stdout);
  // NO-I6: the refusal names the caller and the directory the root would leave,
  // in the sentence the runtime uses for the same root.
  for (const [caller, root] of [["file", "../shared"], ["staticFiles", "assets/../../shared"]] as const) {
    assert.match(
      checked.stderr,
      new RegExp(`error VEL4001: ${caller} root '${root.replaceAll(".", "\\.").replaceAll("/", "\\/")}' leaves the project directory that holds velar\\.json: a relative root names a directory inside it, and a directory outside it is named by an absolute path`, "u"),
      checked.stderr,
    );
  }
  assert.equal(checked.stderr.match(/error VEL4001/gu)?.length, 2, `one report per root: ${checked.stderr}`);

  // NO-I6: a root that normalizes back inside the project is not an escape, and
  // was refused as one. The build accepts it and the runtime serves through it.
  const inside = await runVelarProject({
    "src/main.vel": `
import {ServeApp, file, serve} from "velar/serve"
import {http} from "velar/http"

server api:
    @get long(p"/long") => file("/asset.txt", root="public/../public")
    @get here(p"/here") => file("/asset.txt", root=".")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    try:
        for name in ["long", "here"]:
            print(f"{name}=" + (await http.get(f"http://127.0.0.1:{server.port}/{name}").text()).trim())
    finally: await server.stop()
`.trimStart(),
    "public/asset.txt": "the-long-way-round\n",
    "asset.txt": "beside-velar-json\n",
  }, { prefix: "velar-static-normalized-" });
  assert.equal(inside.status, 0, `${inside.stdout}\n${inside.stderr}`);
  assert.match(inside.stdout, /^long=the-long-way-round$/mu, inside.stdout);
  assert.match(inside.stdout, /^here=beside-velar-json$/mu, "the default root names the project directory itself");

  // NO-I5: the runtime refuses what a build could not see — naming both the
  // root as written and the directory it would have climbed out of — and does
  // it on the next microtask, so the failure reaches the process as an uncaught
  // program error rather than as a module that failed to evaluate.
  const run = await runVelarProject({
    "src/main.vel": `
import {ServeApp, serve, staticFiles} from "velar/serve"

@main:
    const climb = ["..", "shared"].join("/")
    const app: ServeApp = staticFiles("/static", climb)
    const server = await serve(app, 0)
    await server.stop()
`.trimStart(),
  }, { prefix: "velar-static-escape-run-" });
  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
  assert.match(
    run.stderr,
    /^TypeError: staticFiles root '\.\.\/shared' leaves the project at \S+: a relative root names a directory inside it, and a directory outside it is named by an absolute path$/mu,
    run.stderr,
  );
  assert.match(run.stderr, /^ {4}at <anonymous> \(\S+src\/main\.vel:\d+:\d+\)$/mu, `velar run keeps the author's own frame: ${run.stderr}`);
});

/**
 * D114 F9-node-cli, audit NO-U3: a root that is not there.
 *
 * It was a request-time 404 and never anything else, so `root="pubic"` and "the
 * file is missing" were one event. Every root the application declares before
 * it serves is audited once when the server starts; the answer a request gets
 * is unchanged.
 */
test("a static root that names no directory is reported once at startup, and the server still serves", async () => {
  const run = await runVelarProject({
    "src/main.vel": `
import {ServeApp, serve, staticFiles} from "velar/serve"
import {http} from "velar/http"

server api:
    ...staticFiles("/static", root="pubic")

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    try:
        for attempt in [1, 2]:
            try:
                await http.get(f"http://127.0.0.1:{server.port}/static/asset.txt").text()
                print(f"attempt{attempt}=served")
            catch failure:
                print(f"attempt{attempt}={failure.name}")
    finally: await server.stop()
`.trimStart(),
  }, { prefix: "velar-static-missing-root-" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const reports = run.stderr.split("\n").filter((line) => line.includes("static root 'pubic'"));
  assert.equal(reports.length, 1, `one report, at startup, not one per request: ${run.stderr}`);
  assert.match(reports[0]!, /^velar\/serve: static root 'pubic' does not name a directory \(\S+\); requests for it answer 404 until it exists$/u);
  assert.match(run.stdout, /^attempt1=HttpResponseError$/mu, "the request answer is the 404 it always was");
  assert.match(run.stdout, /^attempt2=HttpResponseError$/mu);
});
