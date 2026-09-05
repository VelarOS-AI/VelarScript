import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runVelarProject } from "./velar-project-harness.ts";

/**
 * PR-D1/PR-D2: a spawn the operating system refuses is an application failure.
 *
 * Every one of these shapes is an ordinary mistake — a typo, a tool that is not
 * installed, a command a person supplied — and every one of them used to answer
 * "Node process worker returned an invalid owned handle" and then refuse every
 * later `run`/`start` in the process with that same sentence. A single request
 * to a long-running server could therefore retire the server's ability to run
 * programs at all, and the failure escaped the MessagePort handler as an
 * uncaught error in programs that had awaited enough times first.
 */

/** A directory holding the three on-disk shapes a refused spawn needs. */
async function refusalFixtures(): Promise<{ readonly plainFile: string; readonly directory: string }> {
  const root = await mkdtemp(join(tmpdir(), "velar-spawn-refusals-"));
  const plainFile = join(root, "not-executable");
  await writeFile(plainFile, "this is not a program\n", "utf8");
  await chmod(plainFile, 0o644);
  const directory = join(root, "a-directory");
  await mkdir(directory);
  return { plainFile, directory };
}

test("every OS-refused spawn shape fails its own call, names the command, and leaves the proxy working", async () => {
  if (process.platform === "win32") return;
  const { plainFile, directory } = await refusalFixtures();
  const run = await runVelarProject({
    "src/main.vel": `
import {run} from "velar/process"

async def report(label: string, command: string):
    try:
        const outcome = await run(command, [])
        print(f"{label}: ran code={outcome.code ?? -1}")
    catch failure:
        print(f"{label}: {failure.message}")

async def legal(label: string):
    const outcome = await run("/bin/echo", [label])
    print(f"{label}: {Json.stringify(outcome.stdout)}")

@main:
    await legal("first")
    await report("missing", "/no/such/velar/binary")
    await legal("after-missing")
    await report("not-executable", ${JSON.stringify(plainFile)})
    await legal("after-not-executable")
    await report("directory", ${JSON.stringify(directory)})
    await legal("after-directory")
    await report("bare-name", "velar-no-such-command")
    await legal("after-bare-name")
    await report("through-a-file", ${JSON.stringify(join(plainFile, "echo"))})
    await legal("after-through-a-file")
    try:
        const outcome = await run("/bin/echo", ["cwd"], {cwd: "/no/such/velar/directory"})
        print(f"bad-cwd: ran code={outcome.code ?? -1}")
    catch failure:
        print(f"bad-cwd: {failure.message}")
    await legal("after-bad-cwd")
    print("main completed")
`.trimStart(),
  }, { prefix: "velar-spawn-refusal-" });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  // The failure names the executable and the errno family, not a handshake.
  assert.match(run.stdout, /^missing: Process could not start '\/no\/such\/velar\/binary': ENOENT \(no such file or directory; check the command path and 'cwd'\)$/mu);
  assert.match(run.stdout, new RegExp(`^not-executable: Process could not start '${plainFile}': EACCES \\(permission denied; the target is not an executable file\\)$`, "mu"));
  assert.match(run.stdout, new RegExp(`^directory: Process could not start '${directory}': EACCES \\(permission denied; the target is not an executable file\\)$`, "mu"));
  assert.match(run.stdout, /^bare-name: Process could not start 'velar-no-such-command': ENOENT \(no such file or directory; check the command path and 'cwd'\)$/mu);
  assert.match(run.stdout, new RegExp(`^through-a-file: Process could not start '${plainFile}/echo': ENOTDIR \\(a path component is not a directory\\)$`, "mu"));
  assert.match(run.stdout, /^bad-cwd: Process could not start '\/bin\/echo': ENOENT \(no such file or directory; check the command path and 'cwd'\)$/mu);
  // Nothing is poisoned: a legal command works again after every one of them.
  for (const label of ["first", "after-missing", "after-not-executable", "after-directory", "after-bare-name", "after-through-a-file", "after-bad-cwd"]) {
    assert.match(run.stdout, new RegExp(`^${label}: "${label}\\\\n"$`, "mu"), run.stdout);
  }
  // PR-D2: the failure lands in the try/catch and nowhere else, so @main runs on.
  assert.match(run.stdout, /^main completed$/mu);
  assert.doesNotMatch(run.stderr, /uncaught error while running/u);
  assert.doesNotMatch(run.stderr, /invalid owned handle/u);
});

test("a route that spawns a missing program returns its 500 and the next request's spawn works", async () => {
  if (process.platform === "win32") return;
  const run = await runVelarProject({
    "src/main.vel": `
import {http} from "velar/http"
import {run as runProcess} from "velar/process"
import {serve} from "velar/serve"

export server app:
    @get good(p"/good"):
        const outcome = await runProcess("/bin/echo", ["from a handler"])
        return {out: outcome.stdout}
    @get bad(p"/bad"):
        const outcome = await runProcess("/no/such/velar/binary", [])
        return {code: outcome.code ?? -1}

@main:
    const server = await serve(app, port=0)
    const base = f"http://127.0.0.1:{server.port}"
    print(f"good: {Json.stringify(await http.get(base + "/good").text())}")
    try:
        const failed = await http.get(base + "/bad").text()
        print(f"bad: unexpected success {failed}")
    catch failure:
        print(f"bad: {failure.message}")
    print(f"good-again: {Json.stringify(await http.get(base + "/good").text())}")
    await server.stop()
`.trimStart(),
  }, { prefix: "velar-spawn-server-" });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^good: "\{\\"out\\":\\"from a handler\\\\n\\"\}"$/mu, run.stdout);
  assert.match(run.stdout, /^bad: HTTP 500 for http:\/\/127\.0\.0\.1:\d+\/bad$/mu, run.stdout);
  // The point of the whole item: the server is not retired by one bad request.
  assert.match(run.stdout, /^good-again: "\{\\"out\\":\\"from a handler\\\\n\\"\}"$/mu, run.stdout);
  assert.match(run.stderr, /Process could not start '\/no\/such\/velar\/binary': ENOENT/u);
});
