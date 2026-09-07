import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { velarProjectExtension } from "../../packages/desktop/src/config.ts";
import { desktopBrowserTestController, desktopBrowserTestInitScript } from "../../packages/desktop/src/test-runtime.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,742-line
 * `desktop-runtime.test.ts`. Every test here is the one that was there, moved
 * verbatim.
 *
 * The subject is the Desktop test host: the bridge `velar test` installs in a
 * browser context, the platform it is sealed to before the first window opens,
 * the window registry it keys, and the capabilities it answers or refuses on
 * the manifest's behalf.
 */

test("Desktop CLI test host provides deterministic manifest-scoped process handles", async () => {
  const context = vm.createContext({ TextEncoder, btoa });
  const initScript = desktopBrowserTestInitScript({
    productName: "Test",
    identifier: "dev.velarscript.test",
    windows: { main: { title: "Test", width: 800, height: 600, minWidth: 480, minHeight: 320,
      titleBar: "standard", material: "none", style: "window", frame: true, level: "normal",
      visibleOnAllWorkspaces: false, aspectRatio: null, resizable: true } },
    services: {},
    permissions: { files: ["project"], processes: ["git"], network: [], environment: ["PRODUCTION_MODE"], secrets: ["PROVIDER_KEY"],
      links: [], notifications: false, secureStorage: [] },
    build: { outDir: "dist/desktop", sizeBudgetBytes: 10 * 1024 * 1024, signing: { identity: null, entitlements: null, notarization: null } },
  })
    .replace("const maxListTextUnits = 2 * 1024 * 1024;", "const maxListTextUnits = 8;")
    .replace("const maxWatchPaths = 4096;", "const maxWatchPaths = 1;");
  vm.runInContext(`${initScript}\nglobalThis.__bridgeUnderTest = globalThis[Symbol.for("velar.desktop.bridge.v1")]`, context);
  const bridge = (context as { __bridgeUnderTest?: { platform: string; environment: Readonly<Record<string, string>>; invoke(capability: string, operation: string, args: unknown[]): Promise<unknown> } }).__bridgeUnderTest;
  assert.ok(bridge);
  assert.equal(bridge.platform, "test");
  assert.equal(Object.prototype.hasOwnProperty.call(bridge.environment, "PRODUCTION_MODE"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bridge.environment, "PROVIDER_KEY"), false);
  await assert.rejects(bridge.invoke("fs", "readText", ["README.md", 4]), /exceeds maxBytes/u);
  assert.equal(await bridge.invoke("fs", "makeDirectory", ["nested/one/two"]), null);
  assert.equal(await bridge.invoke("fs", "createText", ["exclusive.txt", "first"]), null);
  await assert.rejects(bridge.invoke("fs", "createText", ["exclusive.txt", "second"]), /createText target already exists/u);
  assert.equal(await bridge.invoke("fs", "replaceTextIfMatches", ["exclusive.txt", "first", "updated"]), true);
  assert.equal(await bridge.invoke("fs", "replaceTextIfMatches", ["exclusive.txt", "first", "lost"]), false);
  const watcherHandle = await bridge.invoke("fs", "watchStart", ["/velar-test/project", true]) as number;
  const watchedChange = bridge.invoke("fs", "watchNext", [watcherHandle]) as Promise<{paths: string[]; rescan: boolean}>;
  assert.equal(await bridge.invoke("fs", "writeText", ["nested/one/two/value.txt", "value"]), null);
  const watchedBatch = await watchedChange;
  assert.equal(watchedBatch.rescan, false);
  assert.deepEqual([...watchedBatch.paths], ["/velar-test/project/nested/one/two/value.txt"]);
  const pendingWatch = bridge.invoke("fs", "watchNext", [watcherHandle]);
  assert.equal(await bridge.invoke("fs", "watchClose", [watcherHandle]), true);
  assert.equal(await pendingWatch, null);
  const overflowWatcher = await bridge.invoke("fs", "watchStart", ["/velar-test/project", true]) as number;
  assert.equal(await bridge.invoke("fs", "writeText", ["overflow-one.vel", "one"]), null);
  assert.equal(await bridge.invoke("fs", "writeText", ["overflow-two.vel", "two"]), null);
  const overflowBatch = await bridge.invoke("fs", "watchNext", [overflowWatcher]) as {paths: string[]; rescan: boolean};
  assert.equal(overflowBatch.rescan, true);
  assert.deepEqual([...overflowBatch.paths], []);
  assert.equal(await bridge.invoke("fs", "watchClose", [overflowWatcher]), true);
  assert.equal(await bridge.invoke("fs", "readText", ["nested/one/two/value.txt", 16]), "value");
  await assert.rejects(bridge.invoke("fs", "writeText", ["nested", "not-a-file"]), /requires a file path/u);
  assert.equal(await bridge.invoke("fs", "makeDirectory", ["budget"]), null);
  assert.equal(await bridge.invoke("fs", "writeText", ["budget/alpha", "a"]), null);
  assert.equal(await bridge.invoke("fs", "writeText", ["budget/bravo", "b"]), null);
  await assert.rejects(bridge.invoke("fs", "list", ["budget", 10]), /2 MiB of text/u);
  assert.equal(await bridge.invoke("fs", "move", ["nested", "moved", false]), null);
  assert.equal((await bridge.invoke("fs", "info", ["moved/one/two/value.txt"]) as { kind: string }).kind, "file");
  await assert.rejects(bridge.invoke("fs", "move", ["/velar-test/project", "moved-root", false]), /refuses a granted Desktop file root/u);
  const started = await bridge.invoke("process", "start", ["git", ["--version"], { maxOutputBytes: 1024 }]) as { handle: number; pid: number };
  assert.ok(started.handle > 0);
  assert.equal(started.pid, 0);
  const output = await bridge.invoke("process", "read", [started.handle]) as { channel: string; text: string };
  assert.deepEqual({ channel: output.channel, text: output.text }, {
    channel: "stdout",
    text: "[desktop-test] git --version\n",
  });
  assert.equal(await bridge.invoke("process", "read", [started.handle]), null);
  const wait = await bridge.invoke("process", "wait", [started.handle]) as {
    result: { code: number; signal: string | null; stdout: string; stderr: string };
    error: null;
    retained: false;
  };
  const result = wait.result;
  assert.deepEqual({ code: result.code, signal: result.signal, stdout: result.stdout, stderr: result.stderr }, {
    code: 0,
    signal: null,
    stdout: "[desktop-test] git --version\n",
    stderr: "",
  });
  await assert.rejects(bridge.invoke("process", "start", ["sh", [], {}]), /not granted/u);
});

test("Desktop browser-test platform is selected before the first open and then sealed", async () => {
  const config = {
    productName: "Test",
    identifier: "dev.velarscript.test",
    windows: { main: { title: "Test", width: 800, height: 600, minWidth: 480, minHeight: 320,
      titleBar: "standard", material: "none", style: "window", frame: true, level: "normal",
      visibleOnAllWorkspaces: false, aspectRatio: null, resizable: true } },
    services: {},
    permissions: { files: ["project"], processes: [], network: [], environment: [], secrets: [],
      links: [], notifications: false, secureStorage: [] },
    build: { outDir: "dist/desktop", sizeBudgetBytes: 10 * 1024 * 1024, signing: { identity: null, entitlements: null, notarization: null } },
  } as const;
  const controller = desktopBrowserTestController(config);
  assert.deepEqual(await controller.invoke("unowned", "operation", [], 30_000), { handled: false });
  assert.deepEqual(await controller.invoke("desktop-test", "setPlatform", ["macos"], 30_000), { handled: true, value: null });

  const context = vm.createContext({ TextEncoder, btoa });
  vm.runInContext(`${controller.initScript()}\nglobalThis.__platform = globalThis[Symbol.for("velar.desktop.bridge.v1")].platform`, context);
  assert.equal((context as { __platform?: string }).__platform, "macos");
  await assert.rejects(
    async () => controller.invoke("desktop-test", "setPlatform", ["test"], 30_000),
    /before the first browser\.open/u,
  );
});

test("Desktop test window registry keys on kind and key and coalesces a slow consumer", async () => {
  const context = vm.createContext({ TextEncoder, btoa });
  // The registry answers from inside the vm realm, so its records carry that
  // realm's prototypes; these assertions compare the data, not the realm.
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  const config = velarProjectExtension.parse({
    productName: "Test",
    identifier: "dev.velarscript.test",
    windows: { main: {}, "note-preview": { style: "panel", width: 480, height: 320 } },
    permissions: { files: ["app-data"] },
  }, "velar.json");
  vm.runInContext(
    `${desktopBrowserTestInitScript(config, "test", "main")}\nglobalThis.__bridgeUnderTest = globalThis[Symbol.for("velar.desktop.bridge.v1")]`,
    context,
  );
  const bridge = (context as {
    __bridgeUnderTest?: {
      windowKind: string;
      windowHandle: number;
      invoke(capability: string, operation: string, args: unknown[]): Promise<unknown>;
    };
  }).__bridgeUnderTest;
  assert.ok(bridge);
  assert.equal(bridge.windowKind, "main");
  assert.equal(bridge.windowHandle, 1);
  assert.deepEqual(plain(await bridge.invoke("window", "list", [])), [{ kind: "main", key: null, focused: true }]);

  await assert.rejects(
    bridge.invoke("window", "open", ["terminal", { route: "/" }]),
    /undeclared window kind 'terminal'.*declared kinds: main, note-preview/su,
  );
  const preview = await bridge.invoke("window", "open", ["note-preview", { route: "/preview", key: "note-1" }]) as number;
  assert.equal(await bridge.invoke("window", "open", ["note-preview", { route: "/preview", key: "note-1" }]), preview);
  assert.deepEqual(plain(await bridge.invoke("window", "list", [])), [
    { kind: "main", key: null, focused: false },
    { kind: "note-preview", key: "note-1", focused: true },
  ]);
  // A window with a different key is a different window.
  const second = await bridge.invoke("window", "open", ["note-preview", { route: "/preview", key: "note-2" }]) as number;
  assert.notEqual(second, preview);
  assert.equal((await bridge.invoke("window", "list", []) as unknown[]).length, 3);
  assert.equal(await bridge.invoke("window", "close", [second]), true);
  assert.equal(await bridge.invoke("window", "close", [second]), false);

  // The declared size is the window's opening geometry, and a bounds change
  // publishes moved and resized separately.
  assert.deepEqual(plain(await bridge.invoke("window", "bounds", [preview])), { x: 0, y: 0, width: 480, height: 320 });
  // Closing a window leaves no window focused, so the preview takes the focus
  // back before the stream opens: the blur below has to have a focus to lose.
  await bridge.invoke("window-test", "focus", ["note-preview", "note-1"]);
  const watcher = await bridge.invoke("window", "watchStart", [preview]) as number;
  await bridge.invoke("window", "setBounds", [preview, { x: 10, y: 10, width: 480, height: 320 }]);
  await bridge.invoke("window-test", "move", ["note-preview", "note-1", { x: 20, y: 20, width: 480, height: 320 }]);
  await bridge.invoke("window-test", "move", ["note-preview", "note-1", { x: 30, y: 30, width: 500, height: 320 }]);
  // Three moves reached a consumer that pulled none of them, so the queue holds
  // the one moved the window is actually in, followed by the resize.
  assert.equal(await bridge.invoke("window", "watchNext", [watcher]), "moved");
  assert.equal(await bridge.invoke("window", "watchNext", [watcher]), "resized");
  const pending = bridge.invoke("window", "watchNext", [watcher]);
  await assert.rejects(bridge.invoke("window", "watchNext", [watcher]), /already has an active pull/u);
  await bridge.invoke("window-test", "focus", ["main", null]);
  assert.equal(await pending, "blurred");
  await bridge.invoke("window-test", "close", ["note-preview", "note-1"]);
  assert.equal(await bridge.invoke("window", "watchNext", [watcher]), "closed");
  // A closed window ends its stream: the pull that finds the queue empty
  // answers null rather than failing on a released handle.
  assert.equal(await bridge.invoke("window", "watchNext", [watcher]), null);
  assert.equal(await bridge.invoke("window", "watchClose", [watcher]), false);
  await assert.rejects(bridge.invoke("window", "bounds", [preview]), /unknown or already closed/u);
  assert.deepEqual(plain(await bridge.invoke("window", "list", [])), [{ kind: "main", key: null, focused: true }]);
});

test("[L1] the Desktop test host answers notifications, the keychain, power, drops and probes", async () => {
  const context = vm.createContext({ TextEncoder, btoa, URL });
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  const config = velarProjectExtension.parse({
    productName: "Test",
    identifier: "dev.velarscript.test",
    windows: { main: {} },
    permissions: {
      files: ["app-data", "dropped"],
      links: ["https"],
      notifications: true,
      secureStorage: ["CLOUD_SESSION"],
    },
  }, "velar.json");
  vm.runInContext(
    `${desktopBrowserTestInitScript(config, "test", "main")}\nglobalThis.__bridgeUnderTest = globalThis[Symbol.for("velar.desktop.bridge.v1")]`,
    context,
  );
  const bridge = (context as {
    __bridgeUnderTest?: { invoke(capability: string, operation: string, args: unknown[]): Promise<unknown> };
  }).__bridgeUnderTest;
  assert.ok(bridge);

  // A notification the operating system never authorized fails rather than
  // being quietly dropped.
  assert.equal(await bridge.invoke("notification", "requestPermission", []), "undetermined");
  await assert.rejects(
    bridge.invoke("notification", "show", [{ title: "t", body: "b" }]),
    /cannot deliver a notification the operating system has not authorized \(permission: undetermined\)/u,
  );
  await bridge.invoke("notification-test", "setPermission", ["granted"]);
  assert.equal(await bridge.invoke("notification", "show", [{ title: "Build finished", body: "3 packages", tag: "build" }]), null);
  assert.deepEqual(plain(await bridge.invoke("notification-test", "shown", [])), [{ title: "Build finished", body: "3 packages", tag: "build" }]);

  const inbox = await bridge.invoke("notification", "watchStart", []) as number;
  await bridge.invoke("notification-test", "activate", ["build"]);
  // Two activations of the same notification are one activation.
  await bridge.invoke("notification-test", "activate", ["build"]);
  await bridge.invoke("notification-test", "activate", [null]);
  assert.deepEqual(plain(await bridge.invoke("notification", "watchNext", [inbox])), { tag: "build" });
  assert.deepEqual(plain(await bridge.invoke("notification", "watchNext", [inbox])), { tag: null });
  const pendingActivation = bridge.invoke("notification", "watchNext", [inbox]);
  await assert.rejects(bridge.invoke("notification", "watchNext", [inbox]), /already has an active pull/u);
  await bridge.invoke("notification-test", "activate", ["deploy"]);
  assert.deepEqual(plain(await pendingActivation), { tag: "deploy" });
  assert.equal(await bridge.invoke("notification", "watchClose", [inbox]), true);
  assert.equal(await bridge.invoke("notification", "watchClose", [inbox]), false);

  // The fake keychain holds values the way the real one does, and neither hands
  // one back through the test seam.
  assert.equal(await bridge.invoke("secure-storage", "get", ["CLOUD_SESSION"]), null);
  assert.equal(await bridge.invoke("secure-storage", "set", ["CLOUD_SESSION", "opaque"]), null);
  assert.equal(await bridge.invoke("secure-storage", "get", ["CLOUD_SESSION"]), "opaque");
  assert.deepEqual(plain(await bridge.invoke("secure-storage-test", "names", [])), ["CLOUD_SESSION"]);
  await assert.rejects(bridge.invoke("secure-storage", "get", ["OTHER"]), /undeclared secure storage name 'OTHER'.*declared names: CLOUD_SESSION/su);
  assert.equal(await bridge.invoke("secure-storage", "remove", ["CLOUD_SESSION"]), null);
  assert.deepEqual(plain(await bridge.invoke("secure-storage-test", "names", [])), []);

  // Power is a transition stream: a state the machine is already in publishes
  // nothing, so the resume below is the first event the stream carries.
  const powerHandle = await bridge.invoke("desktop", "powerWatchStart", []) as number;
  await bridge.invoke("desktop-test", "publishPower", ["resumed"]);
  await bridge.invoke("desktop-test", "publishPower", ["suspended"]);
  await bridge.invoke("desktop-test", "publishPower", ["resumed"]);
  assert.equal(await bridge.invoke("desktop", "powerWatchNext", [powerHandle]), "suspended");
  assert.equal(await bridge.invoke("desktop", "powerWatchNext", [powerHandle]), "resumed");
  assert.equal(await bridge.invoke("desktop", "powerWatchClose", [powerHandle]), true);

  // A slow consumer sees two gestures as one batch, in gesture order, rather
  // than losing either.
  const dropHandle = await bridge.invoke("desktop", "dropWatchStart", []) as number;
  await bridge.invoke("desktop-test", "dropFiles", [["/Users/ada/one.txt"]]);
  await bridge.invoke("desktop-test", "dropFiles", [["/Users/ada/two.txt", "/Users/ada/three.txt"]]);
  assert.deepEqual(plain(await bridge.invoke("desktop", "dropWatchNext", [dropHandle])), {
    paths: ["/Users/ada/one.txt", "/Users/ada/two.txt", "/Users/ada/three.txt"],
  });
  const pendingDrop = bridge.invoke("desktop", "dropWatchNext", [dropHandle]);
  await bridge.invoke("desktop-test", "dropFiles", [["/Users/ada/four.txt"]]);
  assert.deepEqual(plain(await pendingDrop), { paths: ["/Users/ada/four.txt"] });
  assert.equal(await bridge.invoke("desktop", "dropWatchClose", [dropHandle]), true);

  assert.equal(await bridge.invoke("desktop", "openExternal", ["https://velarscript.dev/"]), null);
  await assert.rejects(bridge.invoke("desktop", "openExternal", ["mailto:ada@example.com"]),
    /requires the 'mailto' scheme under 'desktop\.permissions\.links'/u);
  assert.deepEqual(plain(await bridge.invoke("desktop-test", "openedLinks", [])), ["https://velarscript.dev/"]);

  assert.equal(await bridge.invoke("desktop", "permissionStatus", ["microphone"]), "undetermined");
  await bridge.invoke("desktop-test", "setSystemPermission", ["microphone", "granted"]);
  assert.equal(await bridge.invoke("desktop", "permissionStatus", ["microphone"]), "granted");
  assert.deepEqual(plain(await bridge.invoke("desktop", "displays", [])), [{
    id: "velar-test-display",
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 25, width: 1440, height: 875 },
    scale: 2,
    primary: true,
  }]);
});

test("[L1] the Desktop test host refuses the capabilities its manifest never declared", async () => {
  const context = vm.createContext({ TextEncoder, btoa, URL });
  const config = velarProjectExtension.parse({
    productName: "Test",
    identifier: "dev.velarscript.test",
    windows: { main: {} },
    permissions: { files: ["app-data"] },
  }, "velar.json");
  vm.runInContext(
    `${desktopBrowserTestInitScript(config, "test", "main")}\nglobalThis.__bridgeUnderTest = globalThis[Symbol.for("velar.desktop.bridge.v1")]`,
    context,
  );
  const bridge = (context as {
    __bridgeUnderTest?: { invoke(capability: string, operation: string, args: unknown[]): Promise<unknown> };
  }).__bridgeUnderTest;
  assert.ok(bridge);
  // The generated module already refused each of these at the call; a page that
  // reached the bridge another way is refused again here.
  await assert.rejects(bridge.invoke("notification", "requestPermission", []),
    /requires 'notifications: true' under 'desktop\.permissions'/u);
  await assert.rejects(bridge.invoke("notification", "show", [{ title: "t", body: "b" }]),
    /requires 'notifications: true' under 'desktop\.permissions'/u);
  await assert.rejects(bridge.invoke("secure-storage", "get", ["CLOUD_SESSION"]),
    /undeclared secure storage name 'CLOUD_SESSION'.*declared names: none/su);
  await assert.rejects(bridge.invoke("desktop", "openExternal", ["https://velarscript.dev/"]),
    /requires the 'https' scheme under 'desktop\.permissions\.links'/u);
  await assert.rejects(bridge.invoke("desktop", "dropWatchStart", []),
    /requires the 'dropped' root in 'desktop\.permissions\.files'/u);
  await assert.rejects(bridge.invoke("desktop-test", "dropFiles", [["/Users/ada/one.txt"]]),
    /requires the 'dropped' root in 'desktop\.permissions\.files'/u);
});
