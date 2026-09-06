import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { linkWorkspaceWebExtension } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("CLI builds a real .vel file", async () => {
  const directory = await makeTemporaryDirectory("velar-compiler-");
  const sourcePath = join(directory, "main.vel");
  const outputPath = join(directory, "main.js");
  await writeFile(sourcePath, "const answer = 40 + 2\n", "utf8");

  const execution = spawnSync(process.execPath, [
    "packages/cli/src/cli.ts",
    "build",
    sourcePath,
    "--out",
    outputPath,
    "--mode",
    "readable",
    "--source-maps",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal((await readFile(outputPath, "utf8")).replace(/\/\/ @velarscript\/standalone-output-v2 [A-Za-z0-9_-]+\n$/u, ""), "const answer = (40 + 2);\n//# sourceMappingURL=main.js.map\n");
  const map = JSON.parse(await readFile(`${outputPath}.map`, "utf8")) as { version: number; sourcesContent: string[] };
  assert.equal(map.version, 3);
  assert.deepEqual(map.sourcesContent, ["const answer = 40 + 2\n"]);
});

test("CLI runs Core programs on Node with forwarded arguments and propagated exit codes", async () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const directory = await makeTemporaryDirectory("velar-run-");

  const printPath = join(directory, "printing.vel");
  await writeFile(printPath, `
import {iso} from "velar/time"

print(Json.stringify({limit: Math.clamp(12, 0, 10)}))
print(iso(0))
`.trimStart(), "utf8");
  const printed = spawnSync(process.execPath, [cli, "run", printPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stdout, "{\"limit\":10}\n1970-01-01T00:00:00.000Z\n");

  const projectRun = spawnSync(process.execPath, [cli, "run", "tests/fixtures/modules"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(projectRun.status, 0, projectRun.stderr);
  assert.equal(projectRun.stdout, "Hello, Velar\n");

  const failingPath = join(directory, "failing.vel");
  await writeFile(failingPath, "throw Error(\"boom\")\n", "utf8");
  const failed = spawnSync(process.execPath, [cli, "run", failingPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Error: boom/u);
  assert.match(failed.stderr, /failing\.vel:1/u);

  const exitPath = join(directory, "exits.vel");
  // D90 R17: the boundary import is unknown until declared, so the fixture
  // declares the two node:process names it calls.
  await writeFile(exitPath, "extern module \"node:process\":\n    export def exit(code: number) -> null\n\nimport js {exit} from \"node:process\"\n\nexit(7)\n", "utf8");
  const exited = spawnSync(process.execPath, [cli, "run", exitPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(exited.status, 7, exited.stderr);

  const argumentsPath = join(directory, "arguments.vel");
  await writeFile(argumentsPath, "extern module \"node:process\":\n    export const argv: List<string>\n\nimport js {argv} from \"node:process\"\n\nprint(argv.slice(2).join(\",\"))\n", "utf8");
  const forwarded = spawnSync(process.execPath, [cli, "run", argumentsPath, "--", "alpha", "--beta=1", "--help"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(forwarded.status, 0, forwarded.stderr);
  assert.equal(forwarded.stdout, "alpha,--beta=1,--help\n");

  const optionBeforeSeparator = spawnSync(process.execPath, [cli, "run", argumentsPath, "--beta=1"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(optionBeforeSeparator.status, 2);
  assert.match(optionBeforeSeparator.stderr, /unknown option '--beta=1'; program arguments belong after '--'/u);

  const help = spawnSync(process.execPath, [cli, "run", "--help"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: velar run \[entry\.vel \| project-directory\] \[--stack\] \[-- <program-arguments>\.\.\.\]/u);
});

test("CLI run forwards termination to the compiled program and closes inherited streams", { skip: process.platform === "win32" }, async () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const directory = await makeTemporaryDirectory("velar-run-signal-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {onShutdown} from "velar/host"

async def shutdown():
    print("stopping")

onShutdown(shutdown)
print("ready")
while true:
    await Promise.sleep(1s)
`.trimStart(), "utf8");

  const child = spawn(process.execPath, [cli, "run", entry], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk; });
  child.stderr.on("data", (chunk: string) => { output += chunk; });
  await new Promise<void>((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error(`velar run did not become ready: ${output}`)), 10_000);
    const inspect = (): void => {
      if (!output.includes("ready\n")) return;
      clearTimeout(timeout);
      child.stdout.off("data", inspect);
      resolveReady();
    };
    child.stdout.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectReady(new Error(`velar run exited ${String(code)} before readiness: ${output}`));
    });
    inspect();
  });

  child.kill("SIGTERM");
  const close = new Promise<number | null>((resolveClose) => child.once("close", resolveClose));
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rejectTimeout) => {
    timeoutHandle = setTimeout(() => {
      try { process.kill(-child.pid!, "SIGKILL"); } catch {}
      rejectTimeout(new Error(`velar run left its compiled program or inherited streams alive: ${output}`));
    }, 5_000);
  });
  const code = await Promise.race([close, timeout]);
  clearTimeout(timeoutHandle!);
  assert.equal(code, 143, output);
  assert.match(output, /ready\nstopping\n/u);
  assert.throws(() => process.kill(-child.pid!, 0), (error: NodeJS.ErrnoException) => error.code === "ESRCH");
});

test("CLI run rejects web framework projects and points to dev and build", async () => {
  const directory = await makeTemporaryDirectory("velar-run-web-");
  const projectRoot = join(directory, "web-app");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    extensions: ["@velarscript/web"],
    web: { title: "App", base: "/" },
  }), "utf8");
  await writeFile(join(projectRoot, "src", "main.vel"), "print(\"hello\")\n", "utf8");
  await linkWorkspaceWebExtension(projectRoot);
  const rejected = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "run", projectRoot], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stderr, "velar run: this project enables the '@velarscript/web' application framework; use 'velar dev' or 'velar build' instead\n");
});
