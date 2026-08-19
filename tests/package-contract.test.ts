import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { velarBuildOrder, velarPublishedPackages } from "../scripts/velar-packages.mjs";
import { declaredEntryPaths, declaredImportSpecifiers, packageContentFailures, type PackedPackage } from "./package-contract.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// ---------------------------------------------------------------------------
// A-024 — `test:packages` is the release boundary, and it was checking a set it
// had stopped deriving. `velarPackageNames()` produced the roster, `pack()`
// consumed it, and everything after `pack()` re-spelled the same eight names by
// hand: content checks over six of them, an install listing eight literal
// tarball paths, and a sixth copy in the `gate:build:packages` npm script.
//
// The probe that found it added one publishable package with no LICENSE, no
// README, no `dist`, and an `exports` pointing at a file that does not exist.
// `npm run test:packages` printed "VelarScript packed toolchain consumer
// acceptance passed" and exited 0, while the same package's tarball held
// exactly one file and a clean consumer importing it died with
// ERR_MODULE_NOT_FOUND.
//
// These tests rebuild that package and prove the contract now refuses it, in
// both places the old gate waved it through: the tarball's contents, and a real
// consumer's `import`.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

after(removeTemporaryDirectories);

/** The manifest from the A-024 reproduction, verbatim. */
const brokenManifest = {
  name: "@velarscript/broken-probe",
  version: "0.10.3",
  license: "UNLICENSED",
  type: "module",
  exports: "./dist/does-not-exist.js",
} as const;

function npm(arguments_: readonly string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const execpath = process.env.npm_execpath;
  const execution = execpath
    ? spawnSync(process.execPath, [execpath, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: execution.status, stdout: execution.stdout ?? "", stderr: execution.stderr ?? "" };
}

/** A package directory, packed for real, reported the way `npm pack` reports it. */
async function packageOf(manifest: object, files: Record<string, string> = {}): Promise<{ directory: string; packed: PackedPackage }> {
  const directory = join(await makeTemporaryDirectory("velar-package-contract-"), "package");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content, "utf8");
  }
  const result = npm(["pack", "--dry-run", "--json", "--ignore-scripts", directory], directory);
  assert.equal(result.status, 0, result.stderr);
  const packed = JSON.parse(result.stdout) as PackedPackage[];
  assert.equal(packed.length, 1, result.stdout);
  return { directory, packed: packed[0]! };
}

test("[A-024] a crippled publishable package fails the content contract", async () => {
  const { packed } = await packageOf(brokenManifest);
  // The reproduction's own evidence: one file in the tarball.
  assert.equal(packed.files.length, 1, JSON.stringify(packed.files));
  const failures = packageContentFailures(brokenManifest, packed);
  assert.ok(failures.some((failure) => failure.includes("no LICENSE")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("no README.md")), failures.join("\n"));
  assert.ok(
    failures.some((failure) => failure.includes("points at 'dist/does-not-exist.js', which is not in the tarball")),
    failures.join("\n"),
  );
});

test("[A-024] a crippled publishable package fails a clean consumer's import", async () => {
  // The other half, and the one that matters on release day: the package
  // installs without complaint and the first `import` of it fails. The gate's
  // consumer step imports every specifier each manifest publishes, derived the
  // same way, so this package cannot reach a consumer un-imported.
  const { directory } = await packageOf(brokenManifest);
  const consumer = await makeTemporaryDirectory("velar-broken-consumer-");
  await writeFile(join(consumer, "package.json"), `${JSON.stringify({ name: "broken-consumer", private: true, type: "module" }, null, 2)}\n`, "utf8");
  const installed = join(consumer, "node_modules", "@velarscript", "broken-probe");
  await mkdir(installed, { recursive: true });
  // Installed the way npm lays a tarball down, without asking a registry for
  // anything: this test must run on a machine with no network.
  await writeFile(join(installed, "package.json"), await readFile(join(directory, "package.json"), "utf8"), "utf8");

  const specifiers = declaredImportSpecifiers(brokenManifest);
  assert.deepEqual(specifiers, ["@velarscript/broken-probe"]);
  const execution = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    specifiers.map((specifier) => `await import(${JSON.stringify(specifier)});`).join("\n"),
  ], { cwd: consumer, encoding: "utf8", timeout: 300_000 });
  assert.equal(execution.status, 1, `${execution.stdout ?? ""}${execution.stderr ?? ""}`);
  assert.match(execution.stderr ?? "", /ERR_MODULE_NOT_FOUND/u);
});

test("[A-024] a package that keeps its promises passes both halves", async () => {
  // The contract has to be satisfiable, or the test above proves only that it
  // refuses everything.
  const manifest = {
    name: "velar-contract-probe",
    version: "0.10.3",
    license: "Apache-2.0",
    type: "module",
    files: ["dist", "README.md"],
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    bin: { "contract-probe": "./dist/cli.js" },
  };
  const { packed } = await packageOf(manifest, {
    LICENSE: "Apache License\n",
    "README.md": "# probe\n",
    "dist/index.js": "export const value = 1\n",
    "dist/index.d.ts": "export declare const value: number;\n",
    "dist/cli.js": "#!/usr/bin/env node\n",
  });
  assert.deepEqual(packageContentFailures(manifest, packed), []);
});

test("[A-024] the contract is derived from the manifest, not from a list of names", async () => {
  // A subpath nobody has written before is required the day a manifest names
  // it. This is the property the old gate lost: its checks named packages, so
  // they could only ever check the packages somebody had named.
  const manifest = {
    name: "velar-contract-probe",
    version: "0.10.3",
    type: "module",
    exports: {
      ".": { default: "./dist/index.js" },
      "./brand-new-subpath": { types: "./dist/brand-new.d.ts", default: "./dist/brand-new.js" },
    },
    velar: { entry: "src/index.vel" },
  };
  assert.deepEqual(declaredEntryPaths(manifest), [
    "dist/index.js",
    "dist/brand-new.d.ts",
    "dist/brand-new.js",
    "src/index.vel",
  ]);
  assert.deepEqual(declaredImportSpecifiers(manifest), ["velar-contract-probe", "velar-contract-probe/brand-new-subpath"]);
  const { packed } = await packageOf(manifest, { LICENSE: "x\n", "README.md": "x\n", "dist/index.js": "export const value = 1\n" });
  const failures = packageContentFailures(manifest, packed);
  assert.ok(failures.some((failure) => failure.includes("dist/brand-new.js")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("src/index.vel")), failures.join("\n"));
});

test("[A-024] every publishable package that declares a build is built, dependencies first", async () => {
  // The third copy of the roster was the `gate:build:packages` npm script, six
  // workspaces chained by hand. A publishable package added with a build script
  // would have been packed and content-checked against a `dist` nothing built.
  const published = await velarPublishedPackages(root);
  const order = await velarBuildOrder(root);
  const built = order.map((package_) => package_.name);
  const shouldBuild = published.filter((package_) => package_.manifest.scripts?.build).map((package_) => package_.name);
  assert.deepEqual([...built].sort(), [...shouldBuild].sort(), "a publishable package declares a build the gate does not run");
  for (const [index, package_] of order.entries()) {
    const workspaceDependencies = Object.keys(package_.manifest.dependencies ?? {}).filter((name) => built.includes(name));
    for (const dependency of workspaceDependencies) {
      assert.ok(built.indexOf(dependency) < index, `${package_.name} is built before its workspace dependency ${dependency}`);
    }
  }
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts["gate:build:packages"], "node scripts/build-packages.mjs");
});

test("[A-024] the release gate walks the derived roster", async () => {
  // Structural, and deliberately so: what went wrong was not a wrong list, it
  // was a second list. The acceptance script may name a package to make a
  // specific claim about it — `native/macos/VelarDesktopHost.swift` is a fact
  // about Desktop alone — but the roster it walks has to be the derived one.
  const acceptance = await readFile(join(root, "tests", "package.acceptance.ts"), "utf8");
  assert.match(acceptance, /const published = await velarPublishedPackages\(root\)/u);
  assert.match(acceptance, /published\.flatMap\(\(package_\) => packageContentFailures\(package_\.manifest, named\(package_\.name\)\)\)/u);
  assert.match(acceptance, /\.\.\.published\.map\(\(package_\) => join\(directory, named\(package_\.name\)\.filename\)\)/u);
  // And no tarball path is spelled out beside them.
  assert.doesNotMatch(acceptance, /join\(directory, (?:compiler|node|web|create|cli|desktop|textBuffer|scriptAnalysis)\.filename\)/u);
});

test("[A-024] every acceptance script that installs the toolchain derives its set", async () => {
  // The first repair covered `package.acceptance.ts` and left the copy in
  // `installed-browser.acceptance.ts` standing — one literal `pack()` list and
  // four literal install lists — under a documentation sentence that already
  // claimed the browser job installs the derived set. Naming both files here is
  // the point: a meta-test that reads one file is itself a hand-kept list.
  for (const name of ["package.acceptance.ts", "installed-browser.acceptance.ts"]) {
    const source = await readFile(join(root, "tests", name), "utf8");
    assert.match(source, /velar-packages\.mjs/u, `${name} installs the toolchain without reading the derived roster`);
    assert.doesNotMatch(
      source,
      /await pack\("(?:@velarscript\/[a-z-]+|create-velar)"\)/u,
      `${name} packs a package by literal name; pack whatever packages/* publishes`,
    );
  }
});

test("no tracked text file carries a NUL byte that hides it from every text tool", async () => {
  // `scripts/check-runtime-boundary.mjs` held a literal NUL inside a template
  // literal — a deduplication key written as the character rather than the `\0`
  // escape — and `packages/compiler/src/mechanical-fix.ts` held two more. One
  // byte is enough: `grep` classifies the whole file as binary and reports
  // nothing from it, so `grep -rn standardModuleSources scripts/` came back
  // empty while the gate script imported and called it on the next line. The
  // largest gate in the repository was invisible to every plain text search
  // anybody would run over it, which is the quietest possible way for a file to
  // stop being reviewed.
  //
  // Which files are text is decided without reference to the byte under test:
  // a file counts as text when, ignoring NULs, it decodes as UTF-8 and carries
  // no other control characters. Deciding it by the NUL — which is how git and
  // grep themselves decide — would make this assertion vacuous.
  const listed = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const offenders: string[] = [];
  let checked = 0;
  for (const file of listed.stdout.split("\n").filter((name) => name !== "")) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(root, file));
    } catch {
      continue;
    }
    const withoutNul = bytes.filter((byte) => byte !== 0);
    try {
      decoder.decode(withoutNul);
    } catch {
      continue;
    }
    if (withoutNul.some((byte) => byte < 9 || (byte > 13 && byte < 32) || byte === 127)) continue;
    checked += 1;
    if (bytes.includes(0)) offenders.push(file);
  }
  assert.ok(checked > 100, `only ${checked} tracked text files were read`);
  assert.deepEqual(offenders, [], "these text files carry a NUL byte, so grep and diff treat them as binary");
});
