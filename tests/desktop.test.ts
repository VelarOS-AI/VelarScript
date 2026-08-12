import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { velarDesktopFramework } from "../packages/desktop/src/index.ts";

const cli = resolve("packages/cli/src/cli.ts");

test("Desktop publishes its restricted page-side test seam", () => {
  assert.equal(velarDesktopFramework.modules.includes("velar/desktop-test"), true);
});

test("Desktop is one VelarScript project with Web syntax and no renderer/main source split", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-project-"));
  const projectRoot = join(directory, "apps", "desktop");
  try {
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await linkDesktopExtension(directory);
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "desktop-fixture", version: "0.1.0", private: true, type: "module" }), "utf8");
    await writeFile(join(projectRoot, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist/renderer",
      publicDir: "public",
      extensions: ["@velarscript/desktop"],
      desktop: {
        productName: "Velar Desktop Fixture",
        identifier: "dev.velarscript.fixture",
        permissions: {
          files: ["project"],
          processes: ["git", basename(process.execPath)],
          network: ["https://api.example.com"],
          environment: ["LANG", "VELAR_DESKTOP_GENERATION_SMOKE"],
          secrets: ["OPENAI_API_KEY"],
        },
      },
    }, null, 2), "utf8");
    await writeFile(join(projectRoot, "src", "main.vel"), `
import {appDataDirectory, platform, projectDirectory, selectedProjectDirectory, selectProjectDirectory} from "velar/desktop"
import {createText, exists, readText, watchFiles, writeText} from "velar/fs"
import {get} from "velar/env"
import {ProcessOutputChannel, run, start} from "velar/process"
import {reload} from "velar/web"

component GenerationProbe:
    mounted:
        if get("VELAR_DESKTOP_GENERATION_SMOKE") == "1":
            const root = await projectDirectory()
            const watcher = await watchFiles(root, recursive=true)
            await watcher.close()
            const marker = root + "/generation-marker.txt"
            if await exists(marker):
                await writeText(root + "/generation-success.txt", "ready")
            else:
                await createText(marker, "first")
                const child = await start("${basename(process.execPath)}", [
                    "-e",
                    "const fs=require('node:fs');fs.writeFileSync(process.argv[1],String(process.pid));process.stdout.write('ready');setInterval(()=>{},1000)",
                    root + "/generation-child.pid",
                ], {timeout: 0, maxOutputBytes: 1024})
                const output = await child.next()
                if output == null or output.text != "ready":
                    throw Error("Generation smoke child did not start")
                reload()

    return <span data-generation-probe></span>

component App:
    state detail = platform()

    action inspectHost() -> null:
        const selected = await selectedProjectDirectory()
        if selected == "":
            await selectProjectDirectory()
        const root = await appDataDirectory()
        const probe = root + "/probe.txt"
        await writeText(probe, "ready")
        const gitProcess = await start("git", ["--version"])
        let streamed = ""
        async for output in gitProcess:
            if output.channel == ProcessOutputChannel.stdout:
                streamed += output.text
        const git = await gitProcess.wait()
        const second = await run("git", ["--version"])
        detail = await readText(probe) + ":" + (get("LANG") ?? "") + streamed + git.stdout + second.stdout

    return <main>
        <GenerationProbe />
        <h1>VelarScript Desktop</h1>
        <button on:click={inspectHost}>Inspect host</button>
        <p>{detail}</p>
    </main>

mount(<App />, "#app")
`.trimStart(), "utf8");

    const project = await resolveVelarProject(projectRoot);
    assert.equal(project.framework?.host.id, "@velarscript/desktop");
    assert.deepEqual(project.extensionGraph.map((item) => item.name), ["@velarscript/desktop"]);
    assert.equal(project.extensionConfig.get("@velarscript/desktop") && typeof project.extensionConfig.get("@velarscript/desktop"), "object");

    const checked = spawnSync(process.execPath, [cli, "check"], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
    const built = spawnSync(process.execPath, [cli, "build", "--out-dir", "build"], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const manifest = JSON.parse(await readFile(join(projectRoot, "build", "velar-build.json"), "utf8")) as {
      framework: { id: string; artifactKind: string };
    };
    assert.deepEqual(manifest.framework, {
      id: "@velarscript/desktop",
      capability: "desktop",
      target: "browser",
      protocolVersion: 1,
      apiVersion: "0.10",
      artifactKind: "velar-desktop-renderer",
    });
    const assets = await readFile(join(projectRoot, "build", manifestEntry(await readFile(join(projectRoot, "build", "velar-build.json"), "utf8"))), "utf8");
    assert.match(assets, /velar\.desktop\.bridge\.v1/u);

    const packaged = spawnSync(process.execPath, [cli, "package"], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(packaged.status, 0, packaged.stderr);
    const desktopBuild = JSON.parse(await readFile(join(projectRoot, "dist", "desktop", "velar-desktop-build.json"), "utf8")) as {
      formatVersion: number;
      kind: string;
      version: string;
      sizes: { hostBytes: number; rendererBytes: number; toolchainBytes: number; totalBytes: number };
      sizeBudgetBytes: number;
      applicationBundle: string;
      runtime: { kind: string; minimumMajor: number; discovery: string; embedded: boolean; version?: unknown; executableHint?: unknown };
    };
    assert.equal(desktopBuild.formatVersion, 2);
    assert.equal(desktopBuild.kind, "velar-desktop-build");
    assert.equal(desktopBuild.version, "0.1.0");
    assert.deepEqual({
      kind: desktopBuild.runtime.kind,
      minimumMajor: desktopBuild.runtime.minimumMajor,
      discovery: desktopBuild.runtime.discovery,
      embedded: desktopBuild.runtime.embedded,
    }, {
      kind: "external-node",
      minimumMajor: 24,
      discovery: "environment-and-system-paths",
      embedded: false,
    });
    assert.equal(desktopBuild.runtime.version, undefined);
    assert.equal(desktopBuild.runtime.executableHint, undefined);
    assert.ok(desktopBuild.sizes.hostBytes < 512 * 1024, JSON.stringify(desktopBuild.sizes));
    assert.ok(desktopBuild.sizes.toolchainBytes > 1024 * 1024 && desktopBuild.sizes.toolchainBytes < 5 * 1024 * 1024, JSON.stringify(desktopBuild.sizes));
    assert.ok(desktopBuild.sizes.totalBytes < desktopBuild.sizeBudgetBytes, JSON.stringify(desktopBuild.sizes));
    const application = join(projectRoot, "dist", "desktop", desktopBuild.applicationBundle);
    assert.ok(!(await collectNames(application)).some((name) => name === "node_modules" || name.endsWith(".map")));
    const information = await readFile(join(application, "Contents", "Info.plist"), "utf8");
    assert.match(information, /<key>CFBundleIconFile<\/key><string>VelarScript<\/string>/u);
    const applicationIcon = await readFile(join(application, "Contents", "Resources", "VelarScript.icns"));
    assert.equal(applicationIcon.subarray(0, 4).toString("ascii"), "icns");
    const hostConfigText = await readFile(join(application, "Contents", "Resources", "desktop.json"), "utf8");
    const hostConfig = JSON.parse(hostConfigText) as Record<string, unknown>;
    assert.deepEqual(hostConfig.languageServer, { path: "host/language-server.js" });
    assert.ok((await readFile(join(application, "Contents", "Resources", "host", "language-server.js"))).byteLength > 1024 * 1024);
    assert.equal(hostConfig.nodeExecutableHint, undefined);
    assert.doesNotMatch(hostConfigText, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    const smokeEnvironment = { ...process.env, VELAR_DESKTOP_NODE: process.execPath, VELAR_DESKTOP_PROJECT_ROOT: projectRoot };
    const smoke = spawnSync(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--smoke"], { encoding: "utf8", env: smokeEnvironment });
    assert.equal(smoke.status, 0, smoke.stderr);
    assert.deepEqual(JSON.parse(smoke.stdout), {
      kind: "velar-desktop-smoke",
      protocolVersion: 1,
      identifier: "dev.velarscript.fixture",
    });
    const invalidRootSmoke = spawnSync(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--smoke"], {
      encoding: "utf8",
      env: { ...smokeEnvironment, VELAR_DESKTOP_PROJECT_ROOT: "relative-project" },
    });
    assert.equal(invalidRootSmoke.status, 1);
    assert.match(invalidRootSmoke.stderr, /must be an absolute path/u);

    const generationHost = spawn(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--headless-smoke"], {
      env: {
        ...smokeEnvironment,
        VELAR_DESKTOP_GENERATION_SMOKE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let generationHostError = "";
    generationHost.stderr.setEncoding("utf8");
    generationHost.stderr.on("data", (chunk: string) => { generationHostError += chunk; });
    let generationChildPid: number | null = null;
    try {
      const pidText = await waitForText(join(projectRoot, "generation-child.pid"), 15_000, () => generationHostError);
      generationChildPid = Number(pidText);
      assert.ok(Number.isSafeInteger(generationChildPid) && generationChildPid > 0, pidText);
      assert.equal(await waitForText(join(projectRoot, "generation-success.txt"), 15_000, () => generationHostError), "ready");
      await waitForProcessExit(generationChildPid, 5_000);
      generationChildPid = null;
      assert.equal(generationHost.exitCode, null, generationHostError);
    } finally {
      if (generationChildPid !== null) terminateProcessGroup(generationChildPid);
      if (generationHost.exitCode === null) generationHost.kill("SIGTERM");
      await new Promise<void>((resolveExit) => {
        if (generationHost.exitCode !== null) resolveExit();
        else generationHost.once("exit", () => resolveExit());
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Desktop permissions fail closed before application compilation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-permissions-"));
  try {
    await mkdir(join(directory, "src"));
    await linkDesktopExtension(directory);
    await writeFile(join(directory, "src", "main.vel"), "const ready = true\n", "utf8");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      extensions: ["@velarscript/desktop"],
      desktop: {
        productName: "Unsafe",
        identifier: "dev.velarscript.unsafe",
        permissions: { processes: ["sh -c unsafe"] },
      },
    }), "utf8");
    await assert.rejects(resolveVelarProject(directory), /executable names, not paths or shell text/u);
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      extensions: ["@velarscript/desktop"],
      desktop: {
        productName: "Unsafe",
        identifier: "dev.velarscript.unsafe",
        permissions: { environment: ["OPENAI_API_KEY"], secrets: ["OPENAI_API_KEY"] },
      },
    }), "utf8");
    await assert.rejects(resolveVelarProject(directory), /cannot also be exposed through desktop\.permissions\.environment/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function linkDesktopExtension(projectRoot: string): Promise<void> {
  const scope = join(projectRoot, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(resolve("packages/desktop"), join(scope, "desktop"), "dir");
}

async function waitForText(path: string, timeoutMs: number, diagnostic: () => string): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await readFile(path, "utf8");
      if (value.length > 0) return value;
    }
    catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for ${path}${diagnostic() ? `: ${diagnostic()}` : ""}`);
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch { return; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Desktop reload left generation-owned process ${pid} alive`);
}

function terminateProcessGroup(pid: number): void {
  try { process.kill(-pid, "SIGKILL"); }
  catch { try { process.kill(pid, "SIGKILL"); } catch {} }
}

function manifestEntry(source: string): string {
  const manifest = JSON.parse(source) as { entry: string };
  return manifest.entry;
}

async function collectNames(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    output.push(entry.name);
    if (entry.isDirectory()) output.push(...await collectNames(join(root, entry.name)));
  }
  return output;
}
