import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { WorkspaceIndexCancelledError, WorkspaceTextIndex } from "../../packages/cli/src/workspace-index.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("CLI emits complete Web application assets", async () => {
  const directory = await makeTemporaryDirectory("velar-web-build-");
  const execution = spawnSync(process.execPath, [
    "packages/cli/src/cli.ts",
    "build",
    "examples/app",
    "--out-dir",
    directory,
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(execution.status, 0, String(execution.stderr));
  const html = await readFile(join(directory, "index.html"), "utf8");
  assert.match(html, /<script type="module" src="\/assets\/main-[A-Z0-9]+\.js">/);
  assert.match(html, /<link rel="icon" href="data:,">/);
  assert.match(html, /Content-Security-Policy/u);
  const assets = await readdir(join(directory, "assets"));
  const stylesheet = assets.find((name) => /^styles-[a-f0-9]+\.css$/u.test(name));
  const javascript = assets.find((name) => /^main-[A-Z0-9]+\.js$/u.test(name));
  const aboutChunk = assets.find((name) => /^chunk-about-[A-Z0-9]+\.js$/u.test(name));
  assert.ok(stylesheet && javascript && aboutChunk);
  assert.match(await readFile(join(directory, "assets", stylesheet), "utf8"), /data-velar-/);
  assert.match(await readFile(join(directory, "assets", javascript), "utf8"), /Release board/);
  assert.match(await readFile(join(directory, "assets", aboutChunk), "utf8"), /About Release Studio/);
  assert.ok(assets.includes(`${javascript}.map`));
  assert.match(await readFile(join(directory, "data/activity.json"), "utf8"), /Parser fuzz run/);
  assert.match(await readFile(join(directory, "robots.txt"), "utf8"), /User-agent/u);
  const manifest = JSON.parse(await readFile(join(directory, "velar-build.json"), "utf8")) as {
    formatVersion: number;
    kind: string;
    framework: { id: string; capability: string; target: string; protocolVersion: number; apiVersion: string; artifactKind: string };
    compiler: { name: string; version: string };
    buildId: string;
    sourceMaps: boolean;
    entry: string;
    modules: { total: number; application: number; packages: Array<{ name: string; modules: number }> };
    dependencies: { velar: string[]; javascript: string[] };
    deployment: { manifest: string; fallback: string | null; contentSecurityPolicy: boolean };
    assets: Array<{ path: string; sizeBytes: number; sha256: string; role: string }>;
  };
  assert.equal(manifest.formatVersion, 4);
  assert.equal((manifest as typeof manifest & { mode: string }).mode, "production");
  assert.equal(manifest.kind, "velar-framework-build");
  assert.deepEqual(manifest.framework, {
    id: "@velarscript/web",
    capability: "web",
    target: "browser",
    protocolVersion: 3,
    apiVersion: "0.14",
    artifactKind: "velar-web-build",
  });
  assert.deepEqual(manifest.compiler, { name: "velar", version: "0.30.0" });
  assert.match(manifest.buildId, /^[a-f0-9]{64}$/u);
  assert.equal(manifest.sourceMaps, true);
  assert.equal(manifest.entry, `assets/${javascript}`);
  // The counts are a relation rather than a literal: the application is the
  // showcase and may grow a module, but every module it builds must be counted
  // as its own, and a shrunk graph must still be visible.
  assert.ok(manifest.modules.total >= 17);
  assert.equal(manifest.modules.application, manifest.modules.total);
  assert.deepEqual(manifest.modules.packages, []);
  assert.deepEqual(manifest.dependencies, { velar: [], javascript: [] });
  assert.deepEqual(manifest.deployment, { manifest: "velar-deploy.json", fallback: "404.html", contentSecurityPolicy: true });
  assert.ok(manifest.assets.some((asset) => asset.path === "index.html" && asset.role === "html" && asset.sizeBytes > 0 && asset.sha256.length === 64));
  assert.ok(manifest.assets.some((asset) => asset.path === "404.html" && asset.role === "html"));
  assert.ok(manifest.assets.some((asset) => asset.path === "velar-deploy.json" && asset.role === "deployment"));
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${javascript}` && asset.role === "entry"));
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${javascript}.map` && asset.role === "source-map"));
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${aboutChunk}` && asset.role === "asset"));
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${aboutChunk}.map` && asset.role === "source-map"));
  assert.ok(manifest.assets.some((asset) => asset.path === "data/activity.json" && asset.role === "asset"));
});

test("workspace text index retains bounded sources and applies exact changes and open overlays", async () => {
  const directory = await makeTemporaryDirectory("velar-workspace-index-");
  const sourceDirectory = join(directory, "src");
  const mainPath = join(sourceDirectory, "main.vel");
  const scriptPath = join(sourceDirectory, "feature.ts");
  const readmePath = join(directory, "README.md");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(directory, "node_modules", "hidden"), { recursive: true });
  await mkdir(join(directory, "dist"), { recursive: true });
  await writeFile(mainPath, "const emoji = \"😀\"\r\nprint(emoji)\r\n", "utf8");
  await writeFile(scriptPath, "export const diskNeedle = 1\n", "utf8");
  await writeFile(readmePath, "Workspace guide\n", "utf8");
  await writeFile(join(directory, "node_modules", "hidden", "ignored.ts"), "const diskNeedle = 2\n", "utf8");
  await writeFile(join(directory, "dist", "ignored.js"), "const diskNeedle = 3\n", "utf8");

  const index = new WorkspaceTextIndex();
  index.configure([sourceDirectory, directory]);
  assert.deepEqual(index.workspaceRoots(), [directory]);
  const initial = await index.rescan();
  assert.equal(initial.strategy, "rescan");
  assert.equal(initial.indexedFiles, 3);
  assert.equal(initial.filesRead, 3);
  assert.equal((await index.search("Workspace", { maximumResults: 10 })).coverageComplete, true);
  const insensitive = await index.search("PRINT", { maximumResults: 10 });
  assert.equal(insensitive.matches.length, 1);
  assert.equal(insensitive.matches[0]?.path, mainPath);
  assert.deepEqual(insensitive.matches[0]?.start, { line: 1, utf16Character: 0, utf32Character: 0 });
  const unicode = await index.search("😀", { maximumResults: 10 });
  const unicodeMatch = unicode.matches[0]!;
  assert.equal(unicodeMatch.end.utf16Character - unicodeMatch.start.utf16Character, 2);
  assert.equal(unicodeMatch.end.utf32Character - unicodeMatch.start.utf32Character, 1);

  index.openDocument(scriptPath, "export const unsavedNeedle = 2\n");
  assert.equal((await index.search("unsavedNeedle", { maximumResults: 10 })).matches.length, 1);
  assert.equal((await index.search("diskNeedle", { maximumResults: 10 })).matches.length, 0);
  const closed = await index.closeDocument(scriptPath);
  assert.equal(closed.strategy, "known-changes");
  assert.equal(closed.filesRead, 1);
  assert.equal((await index.search("diskNeedle", { maximumResults: 10 })).matches.length, 1);

  index.openDocument(scriptPath, `oversizedNeedle${"x".repeat(4 * 1024 * 1024)}`);
  const boundedOverlay = await index.search("Needle", { maximumResults: 10 });
  assert.equal(boundedOverlay.matches.some((match) => match.path === scriptPath), false);
  assert.equal(boundedOverlay.coverageComplete, false);
  const restored = await index.closeDocument(scriptPath);
  assert.equal(restored.skippedLargeFiles, 0);
  assert.equal((await index.search("diskNeedle", { maximumResults: 10 })).matches.length, 1);

  await writeFile(scriptPath, "export const watchedNeedle = 3\n", "utf8");
  const changed = await index.update(new Set([scriptPath]));
  assert.equal(changed.filesRead, 1);
  assert.equal((await index.search("diskNeedle", { maximumResults: 10 })).matches.length, 0);
  assert.equal((await index.search("watchedNeedle", { maximumResults: 10 })).matches.length, 1);
  await assert.rejects(index.search("needle", { cancelled: () => true }), WorkspaceIndexCancelledError);
  await assert.rejects(index.search("", {}), /cannot be empty/u);
  await assert.rejects(index.search("needle", { maximumResults: 10_001 }), /1 through 10000/u);
});
