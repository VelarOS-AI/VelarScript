import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, posix, sep, win32 } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";
import { browserPackageIdentity, prebundleCacheDirectory } from "../packages/cli/src/npm.ts";
import { projectRelative } from "../packages/cli/src/reproduction.ts";
import { unsupportedProjectFormat } from "../packages/cli/src/project-format.ts";
import { VELAR_VERSION } from "../packages/cli/src/version.ts";
import { DECLARED_VERSIONS, PINNED_DEPENDENCY_VERSIONS, declaredVersionFailure, pinnedDependencyFailure } from "../scripts/release-toolchain.mjs";

// ---------------------------------------------------------------------------
// The supply-chain half of the CLI audit: everything that decides which
// generation of the toolchain a project runs, and everything that takes a path,
// a name, or a version from something the project did not write itself.
//
// The probes here run the shipped CLI, or the exact function the CLI calls,
// over inputs a hostile or merely mismatched dependency can produce.
// ---------------------------------------------------------------------------

const cli = join(repositoryRoot, "packages", "cli", "src", "cli.ts");

after(removeTemporaryDirectories);

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(cwd: string, arguments_: readonly string[]): Run {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

/** A project whose node_modules holds the toolchain packages the repository already has installed. */
async function linkToolchain(root: string, except: readonly string[] = []): Promise<void> {
  const installed = join(repositoryRoot, "node_modules", "@velarscript");
  await mkdir(join(root, "node_modules", "@velarscript"), { recursive: true });
  for (const name of await readdir(installed)) {
    if (except.includes(name)) continue;
    await symlink(await realpath(join(installed, name)), join(root, "node_modules", "@velarscript", name));
  }
}

test("cli-26 a dependency's self-declared name cannot place the prebundle cache outside the project", () => {
  // The name is read from the dependency's own package.json and then joined
  // into <project>/.velar/dev-deps, which ensurePackageBundle removes
  // recursively before writing. A backslash is a path separator on Windows and
  // survives the '/' -> '+' replacement, so the identity is validated first.
  const hostile = browserPackageIdentity({ name: "..\\..\\..\\build" }, "chart-kit");
  assert.equal(hostile, "chart-kit", "a name that is not an npm package name never becomes the identity");
  const traversing = browserPackageIdentity({ name: "../../../build" }, "chart-kit");
  assert.equal(traversing, "chart-kit");
  const mismatched = browserPackageIdentity({ name: "other-package" }, "chart-kit");
  assert.equal(mismatched, "chart-kit", "a name naming a different package never becomes the identity");
  const honest = browserPackageIdentity({ name: "@scope/chart-kit" }, "@scope/chart-kit");
  assert.equal(honest, "@scope/chart-kit", "an honest scoped name is still the identity");

  for (const paths of [posix, win32]) {
    const cacheRoot = paths === win32 ? "C:\\proj\\.velar\\dev-deps" : "/proj/.velar/dev-deps";
    // The input this test exists for: on Windows the backslash is a separator
    // that the '/' -> '+' replacement does not touch, so the unvalidated name
    // leaves the project entirely.
    const unguarded = paths.join(cacheRoot, `${"..\\..\\..\\build".replaceAll("/", "+")}@1.0.0`);
    if (paths === win32) assert.equal(unguarded, "C:\\build@1.0.0");
    const guarded = paths.join(cacheRoot, `${hostile.replaceAll("/", "+")}@1.0.0`);
    assert.ok(guarded.startsWith(cacheRoot + paths.sep), `the guarded cache directory stays inside the project: ${guarded}`);
    assert.ok(!paths.relative(cacheRoot, guarded).startsWith(".."), guarded);
  }

  // The neighbour one step sideways: the version half of the directory name is
  // read from the same untrusted manifest and reaches the same `rm -rf`.
  const cacheRoot = join("proj", ".velar", "dev-deps");
  assert.equal(prebundleCacheDirectory(cacheRoot, "chart-kit", "1.0.0"), join(cacheRoot, "chart-kit@1.0.0"));
  assert.equal(prebundleCacheDirectory(cacheRoot, "@scope/chart-kit", "1.0.0"), join(cacheRoot, "@scope+chart-kit@1.0.0"));
  assert.throws(() => prebundleCacheDirectory(cacheRoot, "chart-kit", `..${sep}..${sep}..${sep}build`),
    /escapes/u, "a hostile version must not place the prebundle outside the cache");
});

test("cli-24 the gate lock lives inside the checkout and never writes terminal controls", async () => {
  // The gate resolves its own location, so the comparison has to be against
  // the real path rather than a symlinked temporary one.
  const workspace = await realpath(await makeTemporaryDirectory("velar-gate-lock-"));
  await mkdir(join(workspace, "scripts"), { recursive: true });
  await copyFile(join(repositoryRoot, "scripts", "gate-lock.mjs"), join(workspace, "scripts", "gate-lock.mjs"));
  const lockPath = join(workspace, ".velar", "gate.lock");

  // A holder naming pid 1 is never reclaimable, so this is the record that
  // wedges a gate for good. It only reaches the victim if the lock lives
  // somewhere the victim does not own.
  await mkdir(join(workspace, ".velar"), { recursive: true });
  const escape = `${String.fromCharCode(27)}]0;pwned${String.fromCharCode(7)}npm run check`;
  await writeFile(lockPath, `${JSON.stringify({
    token: "planted",
    pid: 1,
    host: hostname(),
    label: escape,
    workspace,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");

  const stderr = await new Promise<string>((resolvePromise) => {
    const child = spawn(process.execPath, [join(workspace, "scripts", "gate-lock.mjs"), process.execPath, "-e", ""], {
      cwd: workspace,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let output = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
      if (output.includes("Lock file:")) {
        child.kill("SIGKILL");
        resolvePromise(output);
      }
    });
    child.once("exit", () => resolvePromise(output));
  });

  assert.match(stderr, /Waiting for the VelarScript gate lock/u);
  assert.ok(stderr.includes(`Lock file: ${lockPath}`), `the lock belongs to the checkout, got:\n${stderr}`);
  assert.ok(!stderr.includes(String.fromCharCode(27)), "an ESC from the lock record must never reach a terminal");
  assert.ok(!stderr.includes(String.fromCharCode(7)), "a BEL from the lock record must never reach a terminal");
  assert.ok(stderr.includes("]0;pwnednpm run check"), `the printable remainder is still shown, got:\n${stderr}`);

  const source = await readFile(join(repositoryRoot, "scripts", "gate-lock.mjs"), "utf8");
  const statements = source.split("\n").filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"));
  assert.ok(!statements.some((line) => line.includes("tmpdir")),
    "the gate lock must not live in a world-writable temporary directory");
  assert.ok(!/unlink\(lockPath\)\.catch\(\(\) => \{\}\)/u.test(source), "a failed reclaim must be surfaced, not swallowed");
});

test("cli-15 a reproduction names no path as it sits on this machine", async () => {
  const root = "/home/u/app";
  assert.equal(projectRelative(`${root}/src/x.vel:3:9 error`, root), "src/x.vel:3:9 error");
  // The old substitution was unanchored, so a sibling directory whose name
  // merely starts with the root became `.-backup`.
  assert.ok(!projectRelative(`${root}-backup/x.vel:3:9 error`, root).startsWith(".-backup"));
  assert.equal(projectRelative("/home/u/clients/acme/shared-lib/src/index.vel:14:3 error", root),
    "<external>/index.vel:14:3 error");
  assert.equal(projectRelative("C:\\Users\\alice\\lib\\index.vel:1:1 error", root), "<external>/index.vel:1:1 error");
  assert.equal(projectRelative("see https://example.com/issues", root), "see https://example.com/issues",
    "a URL is not a filesystem path");
  assert.equal(projectRelative("compute a/b and c/d", root), "compute a/b and c/d");

  // The whole bundle, end to end, for the case the leak was found in: a Velar
  // source package hoisted above the project root.
  const workspace = await makeTemporaryDirectory("velar-repro-external-");
  await writeTree(workspace, {
    "node_modules/@t/lib/package.json": `${JSON.stringify({
      name: "@t/lib",
      version: "1.0.0",
      velar: { entry: "src/index.vel", targets: ["core", "node", "web", "desktop"], requires: { capabilities: [] } },
    }, null, 2)}\n`,
    "node_modules/@t/lib/src/index.vel": "export const broken: int = \"text\"\n",
    "app/package.json": `${JSON.stringify({ name: "app", version: "0.0.0", private: true, type: "module" }, null, 2)}\n`,
    "app/velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`,
    "app/src/main.vel": "import {broken} from \"@t/lib\"\n\nprint(broken)\n",
  });
  const project = join(workspace, "app");
  assert.equal(runCli(project, ["check"]).status, 1, "the fixture must fail inside the out-of-project package");
  const wrote = runCli(project, ["repro"]);
  assert.equal(wrote.status, 0, wrote.stderr);

  // The same assertion tests/hardening-d66-repro.test.ts makes over a bundle.
  const hostPath = /(?:^|[\s"'(])[/\\](?:Users|home|var|private|tmp)[/\\]/mu;
  const bundle = join(project, ".velar", "repro");
  const leaked: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (hostPath.test(await readFile(path, "utf8"))) leaked.push(path);
    }
  };
  await visit(bundle);
  assert.deepEqual(leaked, [], "no bundle file may carry an absolute host path");
  const readme = await readFile(join(bundle, "README.md"), "utf8");
  assert.match(readme, /<external>\/index\.vel/u, "an out-of-project module is named by its file, not its location");
});

test("cli-35 VELAR_VERSION matches the version the CLI is published under", async () => {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, "packages", "cli", "package.json"), "utf8")) as { version: string };
  assert.equal(VELAR_VERSION, manifest.version,
    "VELAR_VERSION stamps build manifests, dev-dep cache keys, and reproduction bundles");
  // The release gate is what keeps them equal at release time; it checks every
  // other intra-toolchain pin and never opened this one. cr-6: the gate now
  // holds a roster of these literals rather than one open-coded read, and
  // create-velar's own generation is on it — a create-velar one generation
  // behind used to pass the manifest check while pinning the wrong Web and CLI
  // versions into every generated project.
  const gate = await readFile(join(repositoryRoot, "scripts", "release-toolchain.mjs"), "utf8");
  assert.match(gate, /file: "packages\/cli\/src\/version\.ts", name: "VELAR_VERSION"/u,
    "the release gate must read packages/cli/src/version.ts");
  assert.match(gate, /file: "packages\/create\/src\/types\.ts", name: "VELAR_CREATE_VERSION"/u,
    "the release gate must read packages/create/src/types.ts");
  const create = JSON.parse(await readFile(join(repositoryRoot, "packages", "create", "package.json"), "utf8")) as { version: string };
  for (const declaration of DECLARED_VERSIONS) {
    assert.equal(
      await declaredVersionFailure(repositoryRoot, declaration.file, declaration.name, {
        name: declaration.package,
        version: declaration.package === "create-velar" ? create.version : manifest.version,
      }),
      null,
    );
  }
  // And it is an assertion, not a formality: a literal one generation behind fails.
  const stale = await makeTemporaryDirectory("velar-declared-version");
  await mkdir(join(stale, "packages", "create", "src"), { recursive: true });
  await writeFile(join(stale, "packages", "create", "src", "types.ts"), 'export const VELAR_CREATE_VERSION = "0.0.1";\n', "utf8");
  assert.equal(
    await declaredVersionFailure(stale, "packages/create/src/types.ts", "VELAR_CREATE_VERSION", { name: "create-velar", version: create.version }),
    `packages/create/src/types.ts declares VELAR_CREATE_VERSION 0.0.1, but create-velar is ${create.version}`,
  );
});

test("cli-35a a version literal pinning one of our dependencies is held to the range we declare", async () => {
  // A literal need not name one of our own packages to be a second copy of a
  // version. WEBSOCKET_VERSION and YAML_VERSION decide which runtime packages
  // the CLI will accept in a generated project's node_modules, and their owner
  // manifests decide which versions the toolchain ships. Neither side may move
  // alone behind a green release.
  const node = JSON.parse(await readFile(join(repositoryRoot, "packages", "node", "package.json"), "utf8")) as {
    readonly name: string;
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  const server = JSON.parse(await readFile(join(repositoryRoot, "packages", "server", "package.json"), "utf8")) as {
    readonly name: string;
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  const owners = new Map([[node.name, node], [server.name, server]]);
  assert.deepEqual(PINNED_DEPENDENCY_VERSIONS.map((pin) => [pin.file, pin.name, pin.package, pin.dependency]), [
    ["packages/cli/src/node-runtime-dependencies.ts", "WEBSOCKET_VERSION", "@velarscript/node", "ws"],
    ["packages/cli/src/node-runtime-dependencies.ts", "YAML_VERSION", "@velarscript/server", "yaml"],
  ]);
  for (const pin of PINNED_DEPENDENCY_VERSIONS) {
    const owner = owners.get(pin.package);
    assert.ok(owner, `the test must load ${pin.package}`);
    assert.equal(await pinnedDependencyFailure(repositoryRoot, pin.file, pin.name, pin.dependency, owner), null);
  }
  const gate = await readFile(join(repositoryRoot, "scripts", "release-toolchain.mjs"), "utf8");
  assert.match(gate, /for \(const pin of PINNED_DEPENDENCY_VERSIONS\)/u, "the release gate must run the pinned dependency roster");

  // And each way the two can part is an assertion, not a formality.
  const drifted = await makeTemporaryDirectory("velar-pinned-dependency");
  const file = "packages/cli/src/node-runtime-dependencies.ts";
  await mkdir(join(drifted, "packages", "cli", "src"), { recursive: true });
  await writeFile(join(drifted, file), 'const WEBSOCKET_PACKAGE = "ws";\nconst WEBSOCKET_VERSION = "8.21.1";\n', "utf8");
  const bumped = { name: "@velarscript/node", dependencies: { ws: "^8.22.0" } };
  assert.equal(await pinnedDependencyFailure(drifted, file, "WEBSOCKET_VERSION", "ws", bumped),
    `${file} declares WEBSOCKET_VERSION 8.21.1, but @velarscript/node depends on ws@^8.22.0`);
  assert.equal(await pinnedDependencyFailure(drifted, file, "WEBSOCKET_VERSION", "ws", { name: "@velarscript/node", dependencies: {} }),
    `${file} pins WEBSOCKET_VERSION, but @velarscript/node no longer depends on 'ws'`);
  assert.equal(await pinnedDependencyFailure(drifted, file, "WEBSOCKET_VERSION", "ws", { name: "@velarscript/node", dependencies: { ws: ">=8" } }),
    `@velarscript/node depends on ws@>=8, which names no single version for ${file} to pin`);
  await writeFile(join(drifted, file), 'const WEBSOCKET_PACKAGE = "ws";\n', "utf8");
  assert.equal(await pinnedDependencyFailure(drifted, file, "WEBSOCKET_VERSION", "ws", node),
    `${file} declares WEBSOCKET_VERSION (unreadable), but @velarscript/node depends on ws@${node.dependencies?.ws}`);
});

test("cli-36 a newer and an older project format are told apart", () => {
  const newer = unsupportedProjectFormat(3);
  const older = unsupportedProjectFormat(1);
  assert.notEqual(newer, older);
  assert.match(newer, /newer than this toolchain supports \(2\); upgrade @velarscript\/cli/u);
  assert.match(older, /no longer supported by this toolchain \(2\)/u);
  // The opening clause every caller and every existing test matches is intact.
  assert.match(newer, /^unsupported formatVersion 3/u);
  assert.match(older, /^unsupported formatVersion 1/u);
});

test("cli-x14 an extension cannot claim a velar/* module", async () => {
  const workspace = await makeTemporaryDirectory("velar-module-ownership-");
  await linkToolchain(workspace);
  const extension = (source: string): string => `export const velarCompilerExtension = Object.freeze({
  id: "velar-charts",
  contract: Object.freeze({ protocolVersion: 1, apiVersion: "1.0", kind: "capability", extends: Object.freeze({}) }),
  modules: Object.freeze({
    interfaces: new Map(),
    sources: new Map([[${JSON.stringify(source)}, "export function uuid(){ return 'pwned'; }\\n"]]),
  }),
});
`;
  await writeTree(workspace, {
    "node_modules/velar-charts/package.json": `${JSON.stringify({
      name: "velar-charts",
      version: "1.0.0",
      type: "module",
      exports: { "./compiler": "./compiler.js" },
      velar: { extension: { kind: "capability", apiVersion: "1.0" } },
    }, null, 2)}\n`,
    "node_modules/velar-charts/compiler.js": extension("velar/id"),
    "package.json": `${JSON.stringify({ name: "owned", version: "0.0.0", private: true, type: "module" }, null, 2)}\n`,
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: ["velar-charts"] }, null, 2)}\n`,
    "src/main.vel": "print(\"hi\")\n",
  });

  const claimed = runCli(workspace, ["check"]);
  assert.equal(claimed.status, 1, claimed.stdout);
  assert.match(claimed.stderr, /extension 'velar-charts' cannot declare Velar module 'velar\/id'/u);
  assert.match(claimed.stderr, /belongs to the language/u);

  // The gate is about the namespace, not about the extension: the same
  // extension publishing under its own name still loads.
  await writeFile(join(workspace, "node_modules", "velar-charts", "compiler.js"), extension("charts/id"), "utf8");
  const owned = runCli(workspace, ["check"]);
  assert.equal(owned.status, 0, owned.stderr);
});

test("cli-9 an extension from another toolchain generation is refused by name and version", async () => {
  const workspace = await makeTemporaryDirectory("velar-generation-");
  await linkToolchain(workspace, ["node"]);
  const installed = await realpath(join(repositoryRoot, "node_modules", "@velarscript", "node"));
  const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8")) as Record<string, unknown>;
  await writeTree(workspace, {
    "node_modules/@velarscript/node/package.json": `${JSON.stringify({
      ...manifest,
      version: "0.99.0",
      exports: { "./compiler": "./compiler.js", "./host": "./host.js" },
      dependencies: undefined,
      peerDependencies: undefined,
      devDependencies: undefined,
    }, null, 2)}\n`,
    "node_modules/@velarscript/node/compiler.js": `export * from ${JSON.stringify(join(installed, "dist", "compiler.js"))};\n`,
    "node_modules/@velarscript/node/host.js": `export * from ${JSON.stringify(join(installed, "dist", "host.js"))};\n`,
    "package.json": `${JSON.stringify({ name: "mixed", version: "0.0.0", private: true, type: "module" }, null, 2)}\n`,
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: ["@velarscript/node"], node: {} }, null, 2)}\n`,
    "src/main.vel": "print(\"hi\")\n",
  });

  const mixed = runCli(workspace, ["check"]);
  assert.equal(mixed.status, 1, mixed.stdout);
  assert.match(mixed.stderr, /this project resolves @velarscript\/node 0\.99\.0/u);
  assert.match(mixed.stderr, new RegExp(`is built against @velarscript/node ${VELAR_VERSION.replaceAll(".", "\\.")}`, "u"));
});

test("cli-9 the official templates pin what they install and only state what they need", async () => {
  const { createTemplateFiles } = await import("../packages/create/src/templates.ts");
  const { VELAR_PROJECT_TEMPLATES } = await import("../packages/create/src/types.ts");
  // `dependencies` and `devDependencies` decide which copy is installed beside
  // the pinned CLI, so every toolchain package in them is exact.
  // `peerDependencies` installs nothing: it tells a consumer which target this
  // package needs present, and the copy that loads is pinned by the consumer's
  // own toolchain. Pinning it exactly would only refuse the install of a
  // component that would have compiled fine.
  //
  // D111 rule 5 put the one non-toolchain package into a template's
  // devDependencies: Playwright, which a browser-testing template installs for
  // itself now that the CLI no longer installs it for every project. It is not
  // part of the toolchain generation, so it carries the CLI's own optional-peer
  // range — read off the CLI manifest rather than restated here, so the two
  // cannot drift into a project that resolves a Playwright the toolchain was
  // never driven against. Which templates declare it is derived from which
  // templates actually ship a browser test.
  const cliManifest = JSON.parse(await readFile(join(repositoryRoot, "packages", "cli", "package.json"), "utf8")) as {
    peerDependencies?: Record<string, string>;
  };
  let peers = 0;
  let browserDrivers = 0;
  for (const template of VELAR_PROJECT_TEMPLATES) {
    const files = createTemplateFiles(template, join("/tmp", "example-app"), "0.13.0", 2);
    const manifest = JSON.parse(files.get("package.json") ?? "{}") as Record<string, Record<string, string> | undefined>;
    const browserTested = [...files.keys()].some((path) => path.endsWith(".browser.test.vel"));
    for (const field of ["dependencies", "devDependencies"]) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (name === "playwright") {
          assert.equal(field, "devDependencies", `${template}: Playwright is a development tool`);
          assert.equal(range, cliManifest.peerDependencies?.playwright,
            `${template}: devDependencies.playwright must state the CLI's own peer range, got ${range}`);
          browserDrivers += 1;
          continue;
        }
        assert.equal(range, "0.13.0",
          `${template}: ${field}.${name} must pin one toolchain generation exactly, got ${range}`);
      }
    }
    assert.equal(manifest.devDependencies?.playwright !== undefined, browserTested,
      `${template}: a template ships a browser test and declares Playwright, or does neither`);
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      assert.equal(range, "^0.13.0",
        `${template}: peerDependencies.${name} states a compatibility range, got ${range}`);
      peers += 1;
    }
  }
  assert.equal(peers, 1, "the component template is the one template that declares a peer");
  assert.ok(browserDrivers > 0, "no template declares the browser driver its own browser test needs");

  // A caret over a prerelease accepts the release it precedes, so a toolchain
  // that is not yet released states its peer exactly.
  const prerelease = createTemplateFiles("component", join("/tmp", "example-app"), "0.13.0-rc.1", 2);
  const prereleaseManifest = JSON.parse(prerelease.get("package.json") ?? "{}") as {
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(prereleaseManifest.peerDependencies?.["@velarscript/web"], "0.13.0-rc.1");
  assert.equal(prereleaseManifest.devDependencies?.["@velarscript/web"], "0.13.0-rc.1");
});

test("cli-24 a held gate lock never reaches the attested release source hash", async () => {
  // The lock moved into `.velar/` inside the checkout, and a release is built
  // with a gate lock held — `npm test` runs the release acceptance under
  // gate-lock.mjs. `source.treeSha256` exists so an auditor can recompute it,
  // so a file carrying a fresh token and pid on every run must not be in it.
  const source = await readFile(join(repositoryRoot, "scripts", "release-toolchain.mjs"), "utf8");
  const names = /const excludedTreeNames = new Set\(\[([^\]]*)\]\)/u.exec(source);
  assert.ok(names, "release-toolchain.mjs no longer names the tree walk's exclusions in one place");
  assert.ok(names[1]!.includes('".velar"'),
    `the CLI's scratch namespace must stay out of the attested source hash, got ${names[1]!}`);
});

test("cli-11 no publish workflow hands the repository token to registry.npmjs.org", async () => {
  for (const name of ["publish-npm.yml", "release-rehearsal.yml", "ci.yml", "external-preview-verification.yml"]) {
    const path = join(repositoryRoot, ".github", "workflows", name);
    const source = await readFile(path, "utf8");
    // Steps are separated by a `- ` at step indentation; a registry credential
    // is scoped to the step that configures it and the steps that follow it
    // until the next setup-node, so the test walks the file in order.
    let registryConfigured = false;
    for (const line of source.split("\n")) {
      const statement = line.trim();
      if (statement.startsWith("#")) continue;
      if (statement.includes("actions/setup-node@")) registryConfigured = false;
      if (statement.startsWith("registry-url:") && statement.includes("registry.npmjs.org")) registryConfigured = true;
      if (statement.includes("NODE_AUTH_TOKEN:") && statement.includes("github.token")) {
        assert.ok(!registryConfigured,
          `${name}: the repository token must not be npm's registry credential — ${statement}`);
      }
      if (registryConfigured && /^run:|^- run:/u.test(statement) && statement.includes("npm ci")) {
        assert.fail(`${name}: 'npm ci' must not run under an npmjs.org registry credential`);
      }
    }
  }
});
