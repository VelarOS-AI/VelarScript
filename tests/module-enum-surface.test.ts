import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import type { CompilerExtension, ModuleInterface } from "@velarscript/compiler/extension";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension as desktopExtension } from "../packages/desktop/src/compiler.ts";
import { velarNodeCompilerExtension as nodeExtension } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension as serverExtension } from "../packages/server/src/compiler.ts";
import { velarCompilerExtension as webExtension } from "../packages/web/src/compiler.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";

// ---------------------------------------------------------------------------
// D60 rule 149 — the derived gate that pins a registration to its runtime.
//
// charter section 6 reserves `is`, `parse`, and `values` on every enum. A
// declared enum gets all three from the emitter, but an enum a module
// *provides* is written by hand in that module's runtime source, and nothing
// held the two halves together: `velar/http`'s HttpTransportPhase was
// registered as an `enumObject` while its runtime was a bare frozen record, so
// every one of the three names compiled clean and threw `is not a function` at
// run time. `velar/desktop`'s two enums and `velar/process`'s one had `is` and
// `parse` but no `values`.
//
// So this gate does not name the enums. It reads every `enumObject` a compiler
// extension registers, loads the runtime that extension actually ships for the
// module, and calls all three names on the real binding. A new module-provided
// enum is covered the day it is registered, and an enum that loses a method
// fails here instead of in a user's program.
// ---------------------------------------------------------------------------

const bridgeKey = Symbol.for("velar.desktop.bridge.v1");

interface RegisteredEnum {
  readonly extension: CompilerExtension;
  readonly label: string;
  readonly specifier: string;
  readonly name: string;
  readonly members: readonly string[];
}

interface EnumRuntime {
  readonly is: (value: unknown) => boolean;
  readonly parse: (value: unknown) => unknown;
  readonly values: () => string[];
}

/** Every `enumObject` the extension publishes, in registration order. */
function registeredEnums(extension: CompilerExtension, label: string): readonly RegisteredEnum[] {
  const found: RegisteredEnum[] = [];
  const interfaces: ReadonlyMap<string, ModuleInterface> = extension.modules?.interfaces ?? new Map();
  for (const [specifier, moduleInterface] of interfaces) {
    for (const [name, type] of moduleInterface.exports ?? []) {
      if ((type as { kind?: string }).kind !== "enumObject") continue;
      const members = (type as { members: ReadonlySet<string> }).members;
      found.push({ extension, label, specifier, name, members: [...members] });
    }
  }
  return found;
}

/**
 * Writes the module and its whole dependency closure out as the extension
 * ships them, then imports the module itself. Nothing is stubbed but the
 * Desktop bridge, which the Desktop host ABI requires before any of its
 * modules will initialize.
 */
async function loadModuleRuntime(extension: CompilerExtension, specifier: string): Promise<Record<string, unknown>> {
  const root = await makeTemporaryDirectory("velar-module-enum-");
  const extensions = [extension];
  const closure = standardModuleClosure([specifier], { base: "/" }, extensions);
  const packageRoot = join(root, "node_modules", "velar");
  await mkdir(packageRoot, { recursive: true });
  const exports_: Record<string, string> = {};
  for (const dependency of closure) {
    const source = standardModuleSource(dependency, { base: "/" }, extensions);
    assert.ok(source !== null, `${dependency} must have a runtime source`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await mkdir(join(packageRoot, name, ".."), { recursive: true });
    await writeFile(join(packageRoot, `${name}.js`), source, "utf8");
  }
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "velar", private: true, type: "module", exports: exports_ }),
    "utf8",
  );
  // Server-target realtime depends on the real Node WebSocket transport. Keep
  // this derived runtime gate honest by loading that transport with its actual
  // external dependency instead of replacing it with a test double.
  if (closure.has("velar/websocket")) {
    await symlink(join(repositoryRoot, "node_modules", "ws"), join(root, "node_modules", "ws"), "dir");
  }
  const entry = join(packageRoot, `${specifier.slice("velar/".length)}.js`);
  return await import(`${pathToFileURL(entry).href}?enum-surface=${Date.now()}-${Math.random()}`) as Record<string, unknown>;
}

/** The smallest bridge the Desktop host ABI accepts at module initialization. */
function installDesktopBridge(): void {
  Object.defineProperty(globalThis, bridgeKey, {
    value: Object.freeze({
      platform: "test",
      packaged: false,
      projectDirectory: "/velar-module-enum",
      projectDirectoryValue(): string { return "/velar-module-enum"; },
      environment: Object.freeze({}),
      invoke(): Promise<never> { return Promise.reject(new Error("the enum surface gate never calls the Desktop host")); },
    }),
    configurable: true,
  });
}

after(async () => {
  delete (globalThis as { [key: symbol]: unknown })[bridgeKey];
  await removeTemporaryDirectories();
});

const catalogue: readonly (readonly [string, CompilerExtension])[] = [
  ["@velarscript/web", webExtension],
  ["@velarscript/node", nodeExtension],
  ["@velarscript/server", serverExtension],
  ["@velarscript/desktop", desktopExtension],
];

const enums = catalogue.flatMap(([label, extension]) => registeredEnums(extension, label));

test("[D60-149] the extensions still register the module-provided enums this gate covers", () => {
  // A registration that disappears would make every case below vacuous, so the
  // gate states the floor it was written against rather than trusting an empty
  // sweep. The list grows with the language; it may not silently shrink.
  const covered = enums.map((item) => `${item.label} ${item.specifier} ${item.name}`).sort();
  assert.deepEqual(covered, [
    "@velarscript/desktop velar/desktop DesktopPlatform",
    "@velarscript/desktop velar/desktop PermissionStatus",
    "@velarscript/desktop velar/desktop PowerState",
    "@velarscript/desktop velar/desktop SystemPermission",
    "@velarscript/desktop velar/http HttpTransportPhase",
    "@velarscript/desktop velar/notification NotificationPermission",
    "@velarscript/desktop velar/process ProcessOutputChannel",
    "@velarscript/desktop velar/realtime RealtimeClientFailureAction",
    "@velarscript/desktop velar/realtime RealtimeClientState",
    "@velarscript/desktop velar/service ServiceState",
    "@velarscript/desktop velar/window WindowState",
    "@velarscript/node velar/http HttpTransportPhase",
    "@velarscript/node velar/process ProcessOutputChannel",
    "@velarscript/server velar/http HttpTransportPhase",
    "@velarscript/server velar/process ProcessOutputChannel",
    "@velarscript/server velar/realtime RealtimeFailureAction",
    "@velarscript/server velar/realtime RealtimePeerState",
    "@velarscript/web velar/http HttpTransportPhase",
    "@velarscript/web velar/realtime RealtimeClientFailureAction",
    "@velarscript/web velar/realtime RealtimeClientState",
  ]);
});

for (const item of enums) {
  test(`[D60-149] ${item.label} ${item.specifier} ${item.name} publishes is, parse, and values at run time`, async () => {
    if (item.label === "@velarscript/desktop") installDesktopBridge();
    const module = await loadModuleRuntime(item.extension, item.specifier);
    const binding = module[item.name] as EnumRuntime | undefined;
    assert.ok(binding && typeof binding === "object", `${item.specifier} must export ${item.name}`);
    for (const method of ["is", "parse", "values"] as const) {
      assert.equal(typeof binding[method], "function", `${item.name}.${method} must be a function`);
    }

    // Members answer, and a value outside the set does not.
    for (const member of item.members) {
      assert.equal(binding.is(member), true, `${item.name}.is must accept ${member}`);
      assert.equal(binding.parse(member), member, `${item.name}.parse must return ${member}`);
      assert.equal((binding as unknown as Record<string, unknown>)[member], member);
    }
    for (const rejected of ["", "not-a-member", 0, null, undefined, {}]) {
      assert.equal(binding.is(rejected), false, `${item.name}.is must reject ${String(rejected)}`);
      assert.throws(() => binding.parse(rejected), `${item.name}.parse must reject ${String(rejected)}`);
    }

    // ENM-U1: the members in declaration order, a fresh mutable List per call.
    const values = binding.values();
    assert.deepEqual(values, item.members);
    assert.ok(Array.isArray(values));
    assert.notEqual(values, binding.values());
    assert.equal(Object.isFrozen(values), false);
    values.push("mutated");
    assert.deepEqual(binding.values(), item.members);
  });
}

// ---------------------------------------------------------------------------
// The Web copy of HttpTransportPhase runs in a page, so one probe asks the
// page. The module loader above reads the same source the bundler embeds, but
// only a browser run proves the three names survive into a real build and are
// callable from VelarScript rather than from a Node import.
// ---------------------------------------------------------------------------

test("[D60-149] velar/http's enum answers all three names inside a built page", { timeout: 300_000 }, async () => {
  const directory = await makeTemporaryDirectory("velar-enum-browser-");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(repositoryRoot, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "D60 rule 149", base: "/" },
  }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), `component App:
    return <p data-ready>ready</p>

mount(<App />, "#app")
`, "utf8");
  await writeFile(join(directory, "src", "phase.browser.test.vel"), `import {HttpTransportPhase} from "velar/http"
import {expect} from "velar/test"

test "HttpTransportPhase.is answers in the page":
    expect(HttpTransportPhase.is(HttpTransportPhase.request)).toBeTruthy()
    expect(HttpTransportPhase.is(HttpTransportPhase.response)).toBeTruthy()
    expect(HttpTransportPhase.is("neither")).toBeFalsy()

test "HttpTransportPhase.parse answers in the page":
    expect(HttpTransportPhase.parse("request")).toBe(HttpTransportPhase.request)
    expect(() => HttpTransportPhase.parse("neither")).toThrow()

test "HttpTransportPhase.values answers in the page":
    const phases = HttpTransportPhase.values()
    expect(phases).toHaveLength(2)
    expect(phases).toContain(HttpTransportPhase.request)
    expect(phases).toContain(HttpTransportPhase.response)
    expect(phases).toEqual([HttpTransportPhase.request, HttpTransportPhase.response])
`, "utf8");
  const execution = spawnSync(process.execPath, [
    join(repositoryRoot, "packages", "cli", "src", "cli.ts"), "test", directory, "--browser", "chromium",
  ], { encoding: "utf8", timeout: 300_000 });
  const output = `${String(execution.stdout)}${String(execution.stderr)}`;
  assert.equal(execution.status, 0, output);
  assert.match(output, /3 passed/u);
});
