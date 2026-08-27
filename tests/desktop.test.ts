import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { velarDesktopFramework } from "../packages/desktop/src/index.ts";
import { DESKTOP_NODE_RUNTIME_ARCHIVES, DESKTOP_NODE_RUNTIME_VERSION } from "../packages/desktop/src/config.ts";

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
        windows: {
          main: { width: 900, height: 640 },
          "note-preview": { style: "panel", frame: false, material: "sidebar", aspectRatio: 1.5, width: 480, height: 320, minWidth: 480, minHeight: 320 },
        },
        permissions: {
          files: ["project"],
          processes: ["git", basename(process.execPath)],
          network: ["https://api.example.com"],
          environment: ["LANG", "VELAR_DESKTOP_GENERATION_SMOKE"],
          secrets: ["OPENAI_API_KEY"],
        },
        build: { sizeBudgetBytes: 32 * 1024 * 1024 },
      },
    }, null, 2), "utf8");
    await writeFile(join(projectRoot, "src", "main.vel"), `
import {appDataDirectory, platform, projectDirectory, selectedProjectDirectory, selectProjectDirectory} from "velar/desktop"
import {createText, exists, readText, watchFiles, writeText} from "velar/fs"
import {get} from "velar/env"
import {ProcessOutputChannel, run, start} from "velar/process"
import {reload} from "velar/web"

component GenerationProbe:
    @mounted:
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
    state detail: string = f"{platform()}"

    action inspectHost():
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
      protocolVersion: 2,
      apiVersion: "0.10",
      artifactKind: "velar-desktop-renderer",
    });
    const assets = await readFile(join(projectRoot, "build", manifestEntry(await readFile(join(projectRoot, "build", "velar-build.json"), "utf8"))), "utf8");
    assert.match(assets, /velar\.desktop\.bridge\.v1/u);
    assert.doesNotMatch(assets, /project-task|project-changes|openTerminal|languageServer/u);

    // The 0.10 native host is deliberately the macOS system-WebView host.
    // Other platforms still prove the single-project compiler contract above;
    // they must not pretend to package a host the product does not publish.
    if (process.platform !== "darwin") return;

    const packaged = spawnSync(process.execPath, [cli, "package"], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(packaged.status, 0, packaged.stderr);
    const desktopBuild = JSON.parse(await readFile(join(projectRoot, "dist", "desktop", "velar-desktop-build.json"), "utf8")) as {
      formatVersion: number;
      kind: string;
      version: string;
      sizes: {
        hostBytes: number;
        rendererBytes: number;
        capabilityHostBytes: number;
        metadataBytes: number;
        applicationBytes: number;
        runtimeBytes: number;
        totalBytes: number;
      };
      sizeBudgetBytes: number;
      applicationBundle: string;
      signing: { mode: string; hardenedRuntime: boolean; notarized: boolean };
      runtime: { kind: string; version: string; embedded: boolean; bytes: number; sha256: string; minimumMajor?: unknown; discovery?: unknown };
    };
    assert.equal(desktopBuild.formatVersion, 4);
    assert.equal(desktopBuild.kind, "velar-desktop-build");
    assert.equal(desktopBuild.version, "0.1.0");
    // A packaged application carries its interpreter. The version is the
    // toolchain generation's, and `sha256` is the provenance the download
    // verified — the official archive digest, not a digest of the signed bytes,
    // which this build's own signature has already replaced.
    assert.deepEqual({
      kind: desktopBuild.runtime.kind,
      version: desktopBuild.runtime.version,
      embedded: desktopBuild.runtime.embedded,
      sha256: desktopBuild.runtime.sha256,
    }, {
      kind: "embedded-node",
      version: DESKTOP_NODE_RUNTIME_VERSION,
      embedded: true,
      sha256: DESKTOP_NODE_RUNTIME_ARCHIVES[`${process.platform}-${process.arch}`]!.sha256,
    });
    // v4 has no reader for v3's shape, and does not write it either.
    assert.equal(desktopBuild.runtime.minimumMajor, undefined);
    assert.equal(desktopBuild.runtime.discovery, undefined);
    // Signing records what was done and never who it was done by: an identity,
    // a keychain profile, or anything behind one is not a build receipt field.
    assert.deepEqual(desktopBuild.signing, { mode: "ad-hoc", hardenedRuntime: true, notarized: false });
    assert.ok(desktopBuild.sizes.hostBytes < 1024 * 1024, JSON.stringify(desktopBuild.sizes));
    assert.ok(desktopBuild.sizes.capabilityHostBytes > 0 && desktopBuild.sizes.capabilityHostBytes < 256 * 1024, JSON.stringify(desktopBuild.sizes));
    assert.ok(desktopBuild.sizes.metadataBytes > 0, JSON.stringify(desktopBuild.sizes));
    // The parts sum to the total. They only do so because every one of them is
    // measured after signing: an ad-hoc signature is smaller than the Developer
    // ID signature it replaced on the runtime.
    const sizes = desktopBuild.sizes;
    assert.equal(sizes.hostBytes + sizes.rendererBytes + sizes.capabilityHostBytes + sizes.metadataBytes, sizes.applicationBytes);
    assert.equal(sizes.applicationBytes + sizes.runtimeBytes, sizes.totalBytes);
    assert.equal(sizes.runtimeBytes, desktopBuild.runtime.bytes);
    // The budget governs the application, not the bundle: the runtime is a
    // hundred times the application here and the default budget still passes.
    assert.ok(sizes.applicationBytes < desktopBuild.sizeBudgetBytes, JSON.stringify(sizes));
    assert.ok(sizes.totalBytes > desktopBuild.sizeBudgetBytes, JSON.stringify(sizes));
    const application = join(projectRoot, "dist", "desktop", desktopBuild.applicationBundle);
    assert.ok(!(await collectNames(application)).some((name) => name === "node_modules" || name.endsWith(".map")));
    const information = await readFile(join(application, "Contents", "Info.plist"), "utf8");
    assert.match(information, /<key>CFBundleIconFile<\/key><string>VelarScript<\/string>/u);
    // A second launch of a packaged application activates the running instance
    // rather than starting another; this is the key that makes it so.
    assert.match(information, /<key>LSMultipleInstancesProhibited<\/key><true\/>/u);
    const applicationIcon = await readFile(join(application, "Contents", "Resources", "VelarScript.icns"));
    assert.equal(applicationIcon.subarray(0, 4).toString("ascii"), "icns");
    const hostConfigText = await readFile(join(application, "Contents", "Resources", "desktop.json"), "utf8");
    const hostConfig = JSON.parse(hostConfigText) as Record<string, unknown>;
    assert.equal(hostConfig.languageServer, undefined);
    assert.equal(hostConfig.projectTask, undefined);
    assert.equal(hostConfig.terminalHost, undefined);
    // The native host reads the window map the manifest declared, not a
    // singular window; every field it may act on is resolved before packaging.
    assert.equal(hostConfig.window, undefined);
    assert.deepEqual(hostConfig.windows, {
      main: {
        title: "Velar Desktop Fixture", width: 900, height: 640, minWidth: 720, minHeight: 520,
        titleBar: "standard", material: "none", style: "window", frame: true, level: "normal",
        visibleOnAllWorkspaces: false, aspectRatio: null, resizable: true,
      },
      "note-preview": {
        title: "Velar Desktop Fixture", width: 480, height: 320, minWidth: 480, minHeight: 320,
        titleBar: "standard", material: "sidebar", style: "panel", frame: false, level: "floating",
        visibleOnAllWorkspaces: false, aspectRatio: 1.5, resizable: true,
      },
    });
    assert.deepEqual((await readdir(join(application, "Contents", "Resources", "host"))).sort(), ["worker.js"]);
    assert.equal(hostConfig.nodeExecutableHint, undefined);
    assert.doesNotMatch(hostConfigText, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

    // The runtime sits beside the executable rather than in Resources. A Mach-O
    // under Contents/Resources is sealed as a plain resource — no signature of
    // its own — and arm64 refuses to execute one. Only the bare executable is
    // there: no npm, no npx, no symbolic links into a lib directory.
    const embeddedRuntime = join(application, "Contents", "MacOS", "node");
    assert.equal((await stat(embeddedRuntime)).isFile(), true);
    assert.ok((await stat(embeddedRuntime)).mode & 0o111, "the embedded runtime must be executable");
    assert.deepEqual((await readdir(join(application, "Contents", "MacOS"))).sort(), ["VelarDesktopHost", "node"]);
    const runtimeVersion = spawnSync(embeddedRuntime, ["--version"], { encoding: "utf8" });
    assert.equal(runtimeVersion.stdout.trim(), `v${DESKTOP_NODE_RUNTIME_VERSION}`, runtimeVersion.stderr);
    // The entitlement V8 cannot start without, in the signature rather than only
    // in the build's argv. Without it the hardened runtime refuses the code
    // range and the worker dies on its first real call.
    const runtimeEntitlements = spawnSync("/usr/bin/codesign", ["-d", "--entitlements", "-", "--xml", embeddedRuntime], { encoding: "utf8" });
    assert.match(`${runtimeEntitlements.stdout}${runtimeEntitlements.stderr}`, /com\.apple\.security\.cs\.allow-jit/u);
    // The whole bundle verifies, nested code included.
    const verified = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", application], { encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stderr);
    // The entitlements the runtime was signed with are recorded beside the
    // manifest and are not shipped inside the application.
    assert.match(
      await readFile(join(projectRoot, "dist", "desktop", "velar-desktop-runtime.entitlements"), "utf8"),
      /com\.apple\.security\.cs\.allow-jit/u,
    );

    const smokeEnvironment = { ...process.env, VELAR_DESKTOP_NODE: process.execPath, VELAR_DESKTOP_PROJECT_ROOT: projectRoot };
    const smoke = spawnSync(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--smoke"], { encoding: "utf8", env: smokeEnvironment });
    assert.equal(smoke.status, 0, smoke.stderr);
    assert.deepEqual(JSON.parse(smoke.stdout), {
      kind: "velar-desktop-smoke",
      protocolVersion: 1,
      identifier: "dev.velarscript.fixture",
      windowKinds: ["main", "note-preview"],
    });
    const invalidRootSmoke = spawnSync(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--smoke"], {
      encoding: "utf8",
      env: { ...smokeEnvironment, VELAR_DESKTOP_PROJECT_ROOT: "relative-project" },
    });
    assert.equal(invalidRootSmoke.status, 1);
    assert.match(invalidRootSmoke.stderr, /must be an absolute path/u);

    // The packaging gate's acceptance, run twice: once ordinarily, and once on a
    // machine that has been stripped of every Node the application could borrow.
    //
    // The deprivation is two things at once because neither is enough on a
    // developer's machine: `env -i` with a PATH that holds no `node`, and a
    // sandbox profile that denies reading *and* executing under the three
    // package-manager roots the native host falls back to. Without both, a
    // Homebrew Node would answer and this test would pass for the wrong reason.
    const deprivation = resolve("tests/fixtures/desktop/no-external-node.sb");
    for (const [label, command, argv] of [
      ["ordinary", join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--headless-smoke"]],
      ["deprived", "/usr/bin/sandbox-exec", [
        "-f", deprivation,
        "/usr/bin/env", "-i", `HOME=${process.env.HOME ?? ""}`, "PATH=/usr/bin",
        join(application, "Contents", "MacOS", "VelarDesktopHost"), "--headless-smoke",
      ]],
    ] as const) {
      const accepted = spawnSync(command, [...argv], { encoding: "utf8", env: { ...process.env, VELAR_DESKTOP_PROJECT_ROOT: projectRoot } });
      assert.equal(accepted.status, 0, `${label}: ${accepted.stderr}`);
      const { runtime, ...report } = JSON.parse(accepted.stdout) as { runtime: string };
      assert.deepEqual(report, {
        kind: "velar-desktop-headless-smoke",
        protocolVersion: 1,
        identifier: "dev.velarscript.fixture",
        // Not "external", and this is the assertion the whole deprivation
        // exists to make believable.
        runtimeSource: "bundled",
        // A real capability, answered by the worker the bundled interpreter is
        // running. `--smoke` reaches `node --version`, which returns before V8
        // has created an Isolate; this one cannot be answered without one.
        capability: "fs.list",
        fileScope: true,
        windowKinds: ["main", "note-preview"],
      }, `${label}: ${accepted.stdout}${accepted.stderr}`);
      assert.equal(await realpath(runtime), await realpath(embeddedRuntime), `${label}: ${runtime}`);
    }

    // And the deprivation is real: take the bundled runtime away and the same
    // command fails, because there is nothing else on this machine to find.
    const parked = join(projectRoot, "parked-node");
    await rename(embeddedRuntime, parked);
    try {
      const withoutRuntime = spawnSync("/usr/bin/sandbox-exec", [
        "-f", deprivation,
        "/usr/bin/env", "-i", `HOME=${process.env.HOME ?? ""}`, "PATH=/usr/bin",
        join(application, "Contents", "MacOS", "VelarDesktopHost"), "--headless-smoke",
      ], { encoding: "utf8" });
      assert.equal(withoutRuntime.status, 1, withoutRuntime.stdout);
      assert.match(withoutRuntime.stderr, /carries no usable embedded Node\.js runtime and found no Node\.js 24 or newer/u);
    } finally {
      await rename(parked, embeddedRuntime);
    }

    // `--headless` is the same application with no visible windows and no
    // ending, which is what a renderer-driven regression needs.
    const generationHost = spawn(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--headless"], {
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
      const generationDiagnostic = (): string => `${generationHostError}${generationHost.exitCode === null ? "" : ` host exit ${generationHost.exitCode}`}`;
      const pidText = await waitForText(join(projectRoot, "generation-child.pid"), 15_000, generationDiagnostic);
      generationChildPid = Number(pidText);
      assert.ok(Number.isSafeInteger(generationChildPid) && generationChildPid > 0, pidText);
      assert.equal(await waitForText(join(projectRoot, "generation-success.txt"), 15_000, generationDiagnostic), "ready");
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
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      extensions: ["@velarscript/desktop"],
      desktop: {
        productName: "Unsafe",
        identifier: "dev.velarscript.unsafe",
        permissions: { terminal: true },
      },
    }), "utf8");
    await assert.rejects(resolveVelarProject(directory), /unknown 'desktop\.permissions' field 'terminal'/u);
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

test("Desktop manifest v2 declares window kinds with closed vocabularies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-windows-"));
  try {
    await mkdir(join(directory, "src"));
    await linkDesktopExtension(directory);
    await writeFile(join(directory, "src", "main.vel"), "const ready = true\n", "utf8");
    const write = async (desktop: Record<string, unknown>): Promise<void> => {
      await writeFile(join(directory, "velar.json"), JSON.stringify({
        formatVersion: 2,
        entry: "src/main.vel",
        extensions: ["@velarscript/desktop"],
        desktop: { productName: "Windows", identifier: "dev.velarscript.windows", ...desktop },
      }), "utf8");
    };

    // The retired singular shape is reported by what replaced it and by the
    // command that migrates it, rather than as an unknown field.
    await write({ window: { width: 900 } });
    await assert.rejects(resolveVelarProject(directory), /'desktop\.window' was replaced by 'desktop\.windows'/u);
    await assert.rejects(resolveVelarProject(directory), /run 'velar fix'/u);

    await write({ windows: { preview: {} } });
    await assert.rejects(resolveVelarProject(directory), /must declare the 'main' window kind the host opens at launch/u);

    await write({ windows: { main: {}, "Note Preview": {} } });
    await assert.rejects(resolveVelarProject(directory), /window kind 'Note Preview' must be lowercase words joined by single hyphens/u);

    await write({ windows: Object.fromEntries([...Array(33).keys()].map((index) => [`kind-${"a".repeat(index + 1)}`, {}])) });
    await assert.rejects(resolveVelarProject(directory), /cannot declare more than 32 window kinds/u);

    // knownFields names the exact path, kind and all.
    await write({ windows: { main: {}, "note-preview": { vibrancy: "sidebar" } } });
    await assert.rejects(resolveVelarProject(directory), /unknown 'desktop\.windows\.note-preview' field 'vibrancy'/u);

    for (const [field, value, message] of [
      ["titleBar", "hidden", /'desktop\.windows\.main\.titleBar' must be one of 'standard', 'hidden-inset'/u],
      ["material", "acrylic", /'desktop\.windows\.main\.material' must be one of 'none', 'sidebar'/u],
      ["style", "sheet", /'desktop\.windows\.main\.style' must be one of 'window', 'panel'/u],
      ["level", "screenSaver", /'desktop\.windows\.main\.level' must be one of 'normal', 'floating'/u],
      ["frame", "yes", /'desktop\.windows\.main\.frame' must be a boolean/u],
      ["visibleOnAllWorkspaces", 1, /'desktop\.windows\.main\.visibleOnAllWorkspaces' must be a boolean/u],
      ["resizable", "no", /'desktop\.windows\.main\.resizable' must be a boolean/u],
      ["aspectRatio", 0, /'desktop\.windows\.main\.aspectRatio' must be a finite number greater than 0/u],
      ["aspectRatio", "1.6", /'desktop\.windows\.main\.aspectRatio' must be a finite number greater than 0/u],
    ] as const) {
      await write({ windows: { main: { [field]: value } } });
      await assert.rejects(resolveVelarProject(directory), message, `${field} must be a closed vocabulary`);
    }

    await write({
      windows: {
        main: { title: "Main" },
        "note-preview": {
          style: "panel", frame: false, material: "sidebar", titleBar: "hidden-inset",
          visibleOnAllWorkspaces: true, aspectRatio: 1.6, resizable: false,
          width: 512, height: 320, minWidth: 480, minHeight: 300,
        },
      },
    });
    const project = await resolveVelarProject(directory);
    const config = project.extensionConfig.get("@velarscript/desktop") as {
      windows: Record<string, Record<string, unknown>>;
    };
    assert.deepEqual(Object.keys(config.windows), ["main", "note-preview"]);
    assert.deepEqual(config.windows.main, {
      title: "Main", width: 1180, height: 760, minWidth: 720, minHeight: 520,
      titleBar: "standard", material: "none", style: "window", frame: true, level: "normal",
      visibleOnAllWorkspaces: false, aspectRatio: null, resizable: true,
    });
    assert.deepEqual(config.windows["note-preview"], {
      // An undeclared title is the product name, so a window kind never has to
      // repeat it to get the default.
      title: "Windows", width: 512, height: 320, minWidth: 480, minHeight: 300,
      titleBar: "hidden-inset", material: "sidebar", style: "panel", frame: false,
      // A panel floats by definition, so `level` restates rather than decides.
      level: "floating", visibleOnAllWorkspaces: true, aspectRatio: 1.6, resizable: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("velar fix migrates desktop.window to desktop.windows.main in place", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-fix-"));
  try {
    await mkdir(join(directory, "src"));
    await linkDesktopExtension(directory);
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "fix-fixture", version: "0.1.0", private: true, type: "module" }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), "const ready = true\n", "utf8");
    const before = [
      "{",
      "  \"formatVersion\": 2,",
      "  \"entry\": \"src/main.vel\",",
      "  \"extensions\": [\"@velarscript/desktop\"],",
      "  \"desktop\": {",
      "    \"productName\": \"Fix Fixture\",",
      "    \"identifier\": \"dev.velarscript.fix\",",
      "    \"window\": {",
      "      \"title\": \"Fix Fixture\",",
      "      \"width\": 1040,",
      "      \"height\": 720",
      "    },",
      "    \"permissions\": {",
      "      \"files\": [\"app-data\"]",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const after = before
      .replace("\"window\": {", "\"windows\": {\n      \"main\": {")
      .replace([
        "      \"title\": \"Fix Fixture\",",
        "      \"width\": 1040,",
        "      \"height\": 720",
        "    },",
      ].join("\n"), [
        "        \"title\": \"Fix Fixture\",",
        "        \"width\": 1040,",
        "        \"height\": 720",
        "      }",
        "    },",
      ].join("\n"));
    await writeFile(join(directory, "velar.json"), before, "utf8");

    // Before: `velar check` refuses the manifest and names the migration.
    const checkedBefore = spawnSync(process.execPath, [cli, "check"], { cwd: directory, encoding: "utf8" });
    assert.equal(checkedBefore.status, 1, checkedBefore.stdout);
    assert.match(checkedBefore.stderr, /'desktop\.window' was replaced by 'desktop\.windows'/u);
    assert.match(checkedBefore.stderr, /run 'velar fix'/u);

    const fixed = spawnSync(process.execPath, [cli, "fix"], { cwd: directory, encoding: "utf8" });
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.match(fixed.stdout, /velar\.json migrated the 'desktop' manifest section/u);
    assert.match(fixed.stdout, /applied 1 mechanical fix in 1 file/u);

    // After: the rewrite is exactly the one member, indented as the author's
    // own manifest already was, and everything else keeps its bytes.
    assert.equal(await readFile(join(directory, "velar.json"), "utf8"), after);
    const checkedAfter = spawnSync(process.execPath, [cli, "check"], { cwd: directory, encoding: "utf8" });
    assert.equal(checkedAfter.status, 0, checkedAfter.stderr);

    // A second run changes nothing, which is what makes the migration a fix
    // rather than a rewrite.
    const again = spawnSync(process.execPath, [cli, "fix"], { cwd: directory, encoding: "utf8" });
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(again.stdout, /migrated the 'desktop' manifest section/u);
    assert.equal(await readFile(join(directory, "velar.json"), "utf8"), after);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Desktop manifest v2 declares the link, notification and secure storage grants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-permissions-v2-"));
  try {
    await mkdir(join(directory, "src"));
    await linkDesktopExtension(directory);
    await writeFile(join(directory, "src", "main.vel"), "const ready = true\n", "utf8");
    const write = async (permissions: Record<string, unknown>): Promise<void> => {
      await writeFile(join(directory, "velar.json"), JSON.stringify({
        formatVersion: 2,
        entry: "src/main.vel",
        extensions: ["@velarscript/desktop"],
        desktop: { productName: "Grants", identifier: "dev.velarscript.grants", permissions },
      }), "utf8");
    };

    // `links` is a closed scheme set, not author-supplied text.
    await write({ links: ["ftp"] });
    await assert.rejects(resolveVelarProject(directory), /'desktop\.permissions\.links' must contain only 'http', 'https', 'mailto'/u);
    await write({ links: ["https", "https"] });
    await assert.rejects(resolveVelarProject(directory), /'desktop\.permissions\.links' cannot contain duplicates/u);

    await write({ notifications: "yes" });
    await assert.rejects(resolveVelarProject(directory), /'desktop\.permissions\.notifications' must be a boolean/u);

    // A credential slot follows the same spelling rule an environment secret
    // does, which is what makes the collision rule below able to fire at all.
    await write({ secureStorage: ["cloud-session"] });
    await assert.rejects(resolveVelarProject(directory), /desktop secure storage permissions must be uppercase variable names/u);
    await write({ secrets: ["CLOUD_SESSION"], secureStorage: ["CLOUD_SESSION"] });
    await assert.rejects(resolveVelarProject(directory), /secure storage name 'CLOUD_SESSION' cannot also be declared in desktop\.permissions\.secrets/u);

    // `dropped` is a file root a drag gesture authorizes, and an unknown root is
    // still refused by name.
    await write({ files: ["app-data", "downloads"] });
    await assert.rejects(resolveVelarProject(directory), /unknown desktop file scope 'downloads'/u);

    await write({ files: ["app-data", "project", "dropped"], links: ["https", "mailto"], notifications: true, secureStorage: ["CLOUD_SESSION"] });
    const project = await resolveVelarProject(directory);
    const config = project.extensionConfig.get("@velarscript/desktop") as { permissions: Record<string, unknown> };
    assert.deepEqual(config.permissions, {
      files: ["app-data", "project", "dropped"],
      processes: [], network: [], environment: [], secrets: [],
      links: ["https", "mailto"], notifications: true, secureStorage: ["CLOUD_SESSION"],
    });

    // Every category has a default, and the default is no authority at all.
    await write({});
    const bare = await resolveVelarProject(directory);
    const bareConfig = bare.extensionConfig.get("@velarscript/desktop") as { permissions: Record<string, unknown> };
    assert.deepEqual(bareConfig.permissions.links, []);
    assert.equal(bareConfig.permissions.notifications, false);
    assert.deepEqual(bareConfig.permissions.secureStorage, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Desktop refuses a project whose imported capability module is granted nothing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-ungranted-"));
  try {
    await mkdir(join(directory, "src"));
    await linkDesktopExtension(directory);
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "ungranted", version: "0.1.0", private: true, type: "module" }), "utf8");
    const write = async (source: string, permissions: Record<string, unknown>): Promise<void> => {
      await writeFile(join(directory, "src", "main.vel"), source, "utf8");
      await writeFile(join(directory, "velar.json"), JSON.stringify({
        formatVersion: 2,
        entry: "src/main.vel",
        extensions: ["@velarscript/desktop"],
        desktop: { productName: "Ungranted", identifier: "dev.velarscript.ungranted", permissions },
      }), "utf8");
    };
    const check = () => spawnSync(process.execPath, [cli, "check"], { cwd: directory, encoding: "utf8" });

    await write("import {show} from \"velar/notification\"\n\nexport async def tell(): await show({title: \"t\", body: \"b\"})\n", {});
    const withoutNotifications = check();
    assert.equal(withoutNotifications.status, 1, withoutNotifications.stdout);
    assert.match(withoutNotifications.stderr, /imports 'velar\/notification' but desktop\.permissions\.notifications is not true/u);

    await write("import {show} from \"velar/notification\"\n\nexport async def tell(): await show({title: \"t\", body: \"b\"})\n", { notifications: true });
    assert.equal(check().status, 0);

    await write("import {get} from \"velar/secure-storage\"\n\nexport async def read() -> string?: return await get(\"CLOUD_SESSION\")\n", {});
    const withoutStorage = check();
    assert.equal(withoutStorage.status, 1, withoutStorage.stdout);
    assert.match(withoutStorage.stderr, /imports 'velar\/secure-storage' but desktop\.permissions\.secureStorage grants no name/u);

    await write("import {get} from \"velar/secure-storage\"\n\nexport async def read() -> string?: return await get(\"CLOUD_SESSION\")\n", { secureStorage: ["CLOUD_SESSION"] });
    assert.equal(check().status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
