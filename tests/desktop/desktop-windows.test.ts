import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { velarCompilerExtension } from "../../packages/desktop/src/compiler.ts";
import { desktopExternalNavigationPermitted, velarProjectExtension } from "../../packages/desktop/src/config.ts";
import { bridgeKey } from "../support/desktop-runtime-module.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,742-line
 * `desktop-runtime.test.ts`. Every test here is the one that was there, moved
 * verbatim.
 *
 * The subject is the window: which kinds a manifest may open and how they are
 * released, and which origins a window may navigate out to.
 */

test("Desktop external navigation is granted only by an exact desktop.permissions.network origin", () => {
  const config = velarProjectExtension.parse({
    productName: "Test",
    identifier: "dev.velarscript.test",
    permissions: { network: ["https://docs.velarscript.dev", "https://api.example.com:8443"] },
  }, "velar.json");
  assert.equal(desktopExternalNavigationPermitted(config, "https://docs.velarscript.dev/guide?q=1#top"), true);
  assert.equal(desktopExternalNavigationPermitted(config, "https://docs.velarscript.dev:443/guide"), true);
  assert.equal(desktopExternalNavigationPermitted(config, "https://api.example.com:8443/v1"), true);
  // A suffix or substring rule is how allowlists get bypassed, so a host that
  // merely ends with a granted host is a different host.
  assert.equal(desktopExternalNavigationPermitted(config, "https://evil.docs.velarscript.dev/"), false);
  assert.equal(desktopExternalNavigationPermitted(config, "https://docs.velarscript.dev.evil.test/"), false);
  assert.equal(desktopExternalNavigationPermitted(config, "https://api.example.com/v1"), false);
  assert.equal(desktopExternalNavigationPermitted(config, "https://api.example.com:9443/v1"), false);
  assert.equal(desktopExternalNavigationPermitted(config, "http://docs.velarscript.dev/guide"), false);
  assert.equal(desktopExternalNavigationPermitted(config, "velar-app://app/index.html"), false);
  assert.equal(desktopExternalNavigationPermitted(config, "file:///etc/passwd"), false);
  assert.equal(desktopExternalNavigationPermitted(config, "javascript:fetch('https://docs.velarscript.dev')"), false);
  assert.equal(desktopExternalNavigationPermitted(config, "blob:https://docs.velarscript.dev/8f3c"), false);
  assert.equal(desktopExternalNavigationPermitted(config, "not a url"), false);

  const ungranted = velarProjectExtension.parse({
    productName: "Test",
    identifier: "dev.velarscript.test",
  }, "velar.json");
  assert.deepEqual([...ungranted.permissions.network], []);
  assert.equal(desktopExternalNavigationPermitted(ungranted, "https://docs.velarscript.dev/guide"), false);
});

test("Desktop windows are opened only for manifest-declared kinds and released idempotently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-window-"));
  const calls: Array<{ operation: string; args: readonly unknown[] }> = [];
  const states: Array<string | null> = [];
  try {
    const bridge = {
      platform: "macos",
      packaged: true,
      windowKind: "main",
      windowHandle: 1,
      async invoke(capability: string, operation: string, args: readonly unknown[]) {
        assert.equal(capability, "window");
        calls.push({ operation, args });
        if (operation === "open") return 7;
        if (operation === "close") return args[0] === 7;
        if (operation === "bounds") return { x: 12, y: 34, width: 800, height: 600 };
        if (operation === "setBounds") return null;
        if (operation === "focus") return null;
        if (operation === "display") {
          return {
            id: "display-1",
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 25, width: 1920, height: 1055 },
            scale: 2,
            primary: true,
          };
        }
        if (operation === "list") return [{ kind: "main", key: null, focused: true }, { kind: "note-preview", key: "note-1", focused: false }];
        if (operation === "watchStart") return 3;
        if (operation === "watchNext") return states.shift() ?? null;
        if (operation === "watchClose") return true;
        throw new Error(`unexpected window operation '${operation}'`);
      },
    };
    Object.defineProperty(globalThis, bridgeKey, { value: bridge, configurable: true });
    const source = velarCompilerExtension.modules?.source?.("velar/window", {
      windows: { main: {}, "note-preview": {} },
    });
    assert.ok(source, "velar/window must be generated from the project's declared window kinds");
    const path = join(directory, "window.mjs");
    await writeFile(path, source, "utf8");
    const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as {
      Window: { is(value: unknown): boolean };
      WindowBounds: { is(value: unknown): boolean; parse(value: unknown): unknown };
      WindowState: { values(): string[]; is(value: unknown): boolean };
      WindowStateStream: { is(value: unknown): boolean };
      currentWindowKind(): string;
      currentWindow(): { bounds(): Promise<unknown>; close(): Promise<null> };
      openWindow(kind: string, options: Record<string, unknown>): Promise<{
        focus(): Promise<null>;
        close(): Promise<null>;
        bounds(): Promise<unknown>;
        setBounds(bounds: unknown): Promise<null>;
        display(): Promise<Record<string, unknown>>;
        watchState(): Promise<{ next(): Promise<string | null>; close(): Promise<null> }>;
      }>;
      windows(): Promise<readonly Record<string, unknown>[]>;
    };

    // An undeclared kind is refused at the call, with the manifest field that
    // would declare it, before anything reaches the host.
    await assert.rejects(
      module.openWindow("terminal", { route: "/" }),
      /undeclared window kind 'terminal'.*desktop\.windows.*declared kinds: main, note-preview/su,
    );
    assert.equal(calls.length, 0, "an undeclared kind or invalid option must never reach the host");
    await assert.rejects(module.openWindow("note-preview", { route: "https://example.com/" }), /must start with '\/'/u);
    await assert.rejects(module.openWindow("note-preview", { route: "//example.com" }), /stay inside this application/u);
    await assert.rejects(module.openWindow("note-preview", { route: "/", key: "not a key" }), /key must be at most 128 characters/u);
    await assert.rejects(module.openWindow("note-preview", { route: "/", side: "left" }), /unknown field 'side'/u);
    assert.equal(calls.length, 0, "an undeclared kind or invalid option must never reach the host");

    assert.equal(module.currentWindowKind(), "main");
    assert.equal(module.Window.is(module.currentWindow()), true);
    const preview = await module.openWindow("note-preview", { route: "/note-preview?note=1", key: "note-1" });
    assert.deepEqual(calls.at(-1), { operation: "open", args: ["note-preview", { route: "/note-preview?note=1", key: "note-1", bounds: null }] });
    assert.deepEqual(await preview.bounds(), { x: 12, y: 34, width: 800, height: 600 });
    assert.equal(await preview.setBounds({ x: 1, y: 2, width: 300, height: 200 }), null);
    await assert.rejects(preview.setBounds({ x: 1, y: 2, width: 0, height: 200 }), /at least 1 point/u);
    await assert.rejects(preview.setBounds({ x: 1, y: 2, width: 300 }), /must contain x, y, width and height/u);
    assert.equal(await preview.focus(), null);
    assert.deepEqual(await preview.display(), {
      id: "display-1",
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 25, width: 1920, height: 1055 },
      scale: 2,
      primary: true,
    });
    assert.deepEqual(await module.windows(), [
      { kind: "main", key: null, focused: true },
      { kind: "note-preview", key: "note-1", focused: false },
    ]);

    // The stream is a bounded pull source: one active pull at a time, and it
    // drains normally after the window closes.
    states.push("moved", "resized", "closed", null);
    const stream = await preview.watchState();
    assert.equal(module.WindowStateStream.is(stream), true);
    const pull = stream.next();
    await assert.rejects(stream.next(), /already has an active pull/u);
    assert.equal(await pull, "moved");
    assert.equal(await stream.next(), "resized");
    assert.equal(await stream.next(), "closed");
    assert.equal(await stream.next(), null);
    assert.equal(await stream.next(), null);
    assert.equal(await stream.close(), null);

    // Releasing a Window closes it, and the release is idempotent: the second
    // close never reaches the host at all.
    const closes = () => calls.filter((call) => call.operation === "close").length;
    assert.equal(await preview.close(), null);
    assert.equal(closes(), 1);
    assert.equal(await preview.close(), null);
    assert.equal(closes(), 1);

    assert.deepEqual(module.WindowState.values(), ["moved", "resized", "focused", "blurred", "closed"]);
    assert.equal(module.WindowState.is("minimized"), false);
    assert.equal(module.WindowBounds.is({ x: 0, y: 0, width: 10, height: 10 }), true);
    assert.equal(module.WindowBounds.is({ x: 0, y: 0, width: 10 }), false);
  } finally {
    delete (globalThis as { [key: symbol]: unknown })[bridgeKey];
    await rm(directory, { recursive: true, force: true });
  }
});
