import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bridgeKey, configuredRuntime, runtime } from "../support/desktop-runtime-module.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,742-line
 * `desktop-runtime.test.ts`. Every test here is the one that was there, moved
 * verbatim.
 *
 * The subject is the [L1] capability itself: what an ungranted manifest fails
 * at and how it names the declaration it wanted, and what `velar/notification`,
 * `velar/secure-storage` and `velar/desktop` publish once one is granted.
 */

test("[L1] every Desktop capability an ungranted manifest omits fails at the call and names the declaration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-ungranted-"));
  const calls: string[] = [];
  try {
    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "test",
        packaged: false,
        windowKind: "main",
        windowHandle: 1,
        async invoke(capability: string, operation: string) {
          calls.push(`${capability}.${operation}`);
          return null;
        },
      },
      configurable: true,
    });

    // The fallback the extension publishes outside a resolved project grants
    // nothing at all, which is the shape every one of these calls is refused in.
    const notification = await runtime<{
      requestPermission(): Promise<string>;
      show(value: unknown): Promise<null>;
      activations(): Promise<unknown>;
    }>(directory, "notification-denied", "velar/notification");
    for (const [name, call] of [
      ["requestPermission", () => notification.requestPermission()],
      ["show", () => notification.show({ title: "t", body: "b" })],
      ["activations", () => notification.activations()],
    ] as const) {
      await assert.rejects(call(), (error: Error) => {
        assert.match(error.message, new RegExp(`^${name} requires 'notifications: true' under 'desktop\\.permissions' in this project's velar\\.json$`, "u"));
        return true;
      });
    }

    const storage = await runtime<{
      set(name: string, value: string): Promise<null>;
      get(name: string): Promise<string | null>;
      remove(name: string): Promise<null>;
    }>(directory, "storage-denied", "velar/secure-storage");
    for (const [name, call] of [
      ["set", () => storage.set("CLOUD_SESSION", "value")],
      ["get", () => storage.get("CLOUD_SESSION")],
      ["remove", () => storage.remove("CLOUD_SESSION")],
    ] as const) {
      await assert.rejects(call(), (error: Error) => {
        assert.match(error.message, new RegExp(`^${name} cannot reach the undeclared secure storage name 'CLOUD_SESSION'`, "u"));
        assert.match(error.message, /declare it under 'desktop\.permissions\.secureStorage' in this project's velar\.json \(declared names: none\)/u);
        return true;
      });
    }

    const desktop = await runtime<{
      openExternal(url: string): Promise<null>;
      watchDroppedFiles(): Promise<unknown>;
    }>(directory, "desktop-denied", "velar/desktop");
    await assert.rejects(desktop.openExternal("https://velarscript.dev/"), (error: Error) => {
      assert.match(error.message, /^openExternal cannot open a 'https' URL; declare the scheme under 'desktop\.permissions\.links' in this project's velar\.json \(granted schemes: none\)$/u);
      return true;
    });
    await assert.rejects(desktop.watchDroppedFiles(), (error: Error) => {
      assert.match(error.message, /^watchDroppedFiles requires the 'dropped' root in 'desktop\.permissions\.files' in this project's velar\.json$/u);
      return true;
    });

    // Nothing reached the host: a capability the manifest never declared is
    // refused where it is written, not where it is served.
    assert.deepEqual(calls, []);

    // A grant that exists but does not cover this name is the same refusal, and
    // the message lists what the manifest did declare.
    const narrow = await configuredRuntime<{ get(name: string): Promise<string | null> }>(
      directory, "storage-narrow", "velar/secure-storage", { secureStorage: ["CLOUD_SESSION"] },
    );
    await assert.rejects(narrow.get("OTHER_SESSION"), /undeclared secure storage name 'OTHER_SESSION'.*declared names: CLOUD_SESSION/su);
    const mailOnly = await configuredRuntime<{ openExternal(url: string): Promise<null> }>(
      directory, "desktop-mail", "velar/desktop", { links: ["mailto"] },
    );
    await assert.rejects(mailOnly.openExternal("https://velarscript.dev/"), /granted schemes: mailto/u);
    // A nested scheme names one scheme and reads as another, so the outermost is
    // the one asked about.
    await assert.rejects(mailOnly.openExternal("blob:https://velarscript.dev/id"), /cannot open a 'blob' URL/u);
    assert.deepEqual(calls, []);
  } finally {
    delete (globalThis as { [key: symbol]: unknown })[bridgeKey];
    await rm(directory, { recursive: true, force: true });
  }
});

test("[L1] velar/notification bounds its fields and drains its activation stream", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-notification-"));
  const calls: Array<{ operation: string; args: readonly unknown[] }> = [];
  const activations: Array<Record<string, unknown> | null> = [];
  try {
    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "macos",
        packaged: true,
        async invoke(capability: string, operation: string, args: readonly unknown[]) {
          assert.equal(capability, "notification");
          calls.push({ operation, args });
          if (operation === "requestPermission") return "granted";
          if (operation === "show") return null;
          if (operation === "watchStart") return 4;
          if (operation === "watchNext") return activations.shift() ?? null;
          if (operation === "watchClose") return true;
          throw new Error(`unexpected notification operation '${operation}'`);
        },
      },
      configurable: true,
    });
    const module = await configuredRuntime<{
      NotificationPermission: { values(): string[]; is(value: unknown): boolean };
      NotificationActivation: { is(value: unknown): boolean };
      NotificationActivationStream: { is(value: unknown): boolean };
      requestPermission(): Promise<string>;
      show(value: unknown): Promise<null>;
      activations(): Promise<{ next(): Promise<unknown>; close(): Promise<null> }>;
    }>(directory, "notification", "velar/notification", { notifications: true });

    assert.deepEqual(module.NotificationPermission.values(), ["granted", "denied", "undetermined"]);
    assert.equal(module.NotificationPermission.is("default"), false);
    assert.equal(await module.requestPermission(), "granted");
    assert.equal(await module.show({ title: "Build finished", body: "3 packages", tag: "build" }), null);
    assert.deepEqual(calls.at(-1), { operation: "show", args: [{ title: "Build finished", body: "3 packages", tag: "build" }] });
    // An absent tag is the absent tag, not an absent field.
    assert.equal(await module.show({ title: "t", body: "b" }), null);
    assert.deepEqual(calls.at(-1), { operation: "show", args: [{ title: "t", body: "b", tag: null }] });

    const shown = calls.length;
    await assert.rejects(module.show({ title: "", body: "b" }), /show title must be non-empty text/u);
    await assert.rejects(module.show({ title: "t".repeat(257), body: "b" }), /show title cannot exceed 256 characters/u);
    await assert.rejects(module.show({ title: "t", body: "b".repeat(1025) }), /show body cannot exceed 1024 characters/u);
    await assert.rejects(module.show({ title: "t", body: "b", tag: "g".repeat(129) }), /show tag cannot exceed 128 characters/u);
    await assert.rejects(module.show({ title: "t", body: "b", icon: "x" }), /unknown field 'icon'/u);
    assert.equal(calls.length, shown, "a notification outside its bounds never reaches the host");

    activations.push({ tag: "build" }, { tag: null }, null);
    const stream = await module.activations();
    assert.equal(module.NotificationActivationStream.is(stream), true);
    const pull = stream.next();
    await assert.rejects(stream.next(), /already has an active pull/u);
    assert.deepEqual(await pull, { tag: "build" });
    assert.deepEqual(await stream.next(), { tag: null });
    assert.equal(await stream.next(), null);
    assert.equal(await stream.next(), null);
    assert.equal(await stream.close(), null);
    assert.equal(module.NotificationActivation.is({ tag: "build" }), true);
    assert.equal(module.NotificationActivation.is({ tag: "build", body: "x" }), false);
  } finally {
    delete (globalThis as { [key: symbol]: unknown })[bridgeKey];
    await rm(directory, { recursive: true, force: true });
  }
});

test("[L1] velar/secure-storage reaches declared names only and keeps values out of its errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-storage-"));
  const calls: Array<{ operation: string; args: readonly unknown[] }> = [];
  const entries = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "macos",
        packaged: true,
        async invoke(capability: string, operation: string, args: readonly unknown[]) {
          assert.equal(capability, "secure-storage");
          calls.push({ operation, args });
          if (operation === "set") { entries.set(args[0] as string, args[1] as string); return null; }
          if (operation === "get") return entries.get(args[0] as string) ?? null;
          if (operation === "remove") { entries.delete(args[0] as string); return null; }
          throw new Error(`unexpected secure storage operation '${operation}'`);
        },
      },
      configurable: true,
    });
    const module = await configuredRuntime<{
      set(name: string, value: string): Promise<null>;
      get(name: string): Promise<string | null>;
      remove(name: string): Promise<null>;
    }>(directory, "storage", "velar/secure-storage", { secureStorage: ["CLOUD_SESSION", "SYNC_TOKEN"] });

    assert.equal(await module.get("CLOUD_SESSION"), null);
    assert.equal(await module.set("CLOUD_SESSION", "opaque"), null);
    assert.equal(await module.get("CLOUD_SESSION"), "opaque");
    // Removing what is not there is the state it is already in.
    assert.equal(await module.remove("SYNC_TOKEN"), null);
    assert.equal(await module.remove("CLOUD_SESSION"), null);
    assert.equal(await module.remove("CLOUD_SESSION"), null);
    assert.equal(await module.get("CLOUD_SESSION"), null);

    const reached = calls.length;
    await assert.rejects(module.set("CLOUD_SESSION", "x".repeat(8 * 1024 + 1)), (error: Error) => {
      assert.match(error.message, /^set cannot store more than 8 KiB$/u);
      // The rejected value is described by its size, never by its content.
      assert.doesNotMatch(error.message, /x{4}/u);
      return true;
    });
    // A value that is 8 KiB of multi-byte text is over the bound in bytes even
    // though it is under it in characters.
    await assert.rejects(module.set("CLOUD_SESSION", "é".repeat(4 * 1024 + 1)), /cannot store more than 8 KiB/u);
    assert.equal(await module.set("CLOUD_SESSION", "x".repeat(8 * 1024)), null);
    await assert.rejects(module.set("CLOUD_SESSION", 7 as unknown as string), /set requires a text value/u);
    assert.equal(calls.length, reached + 1, "only the value inside its bound reached the host");
  } finally {
    delete (globalThis as { [key: symbol]: unknown })[bridgeKey];
    await rm(directory, { recursive: true, force: true });
  }
});

test("[L1] velar/desktop reads displays, opens granted links, and pulls power and dropped files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-surface-"));
  const calls: Array<{ operation: string; args: readonly unknown[] }> = [];
  const power: Array<string | null> = [];
  const drops: Array<Record<string, unknown> | null> = [];
  const display = {
    id: "display-1",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 25, width: 1920, height: 1055 },
    scale: 2,
    primary: true,
  };
  try {
    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "macos",
        packaged: true,
        async invoke(capability: string, operation: string, args: readonly unknown[]) {
          assert.equal(capability, "desktop");
          calls.push({ operation, args });
          if (operation === "openExternal") return null;
          if (operation === "displays") return [display];
          if (operation === "permissionStatus") return args[0] === "microphone" ? "denied" : "undetermined";
          if (operation === "powerWatchStart") return 1;
          if (operation === "powerWatchNext") return power.shift() ?? null;
          if (operation === "powerWatchClose") return true;
          if (operation === "dropWatchStart") return 2;
          if (operation === "dropWatchNext") return drops.shift() ?? null;
          if (operation === "dropWatchClose") return true;
          throw new Error(`unexpected desktop operation '${operation}'`);
        },
      },
      configurable: true,
    });
    const module = await configuredRuntime<{
      Display: { is(value: unknown): boolean };
      DroppedFiles: { is(value: unknown): boolean };
      PowerState: { values(): string[] };
      PowerStream: { is(value: unknown): boolean };
      DroppedFilesStream: { is(value: unknown): boolean };
      SystemPermission: { values(): string[] };
      PermissionStatus: { values(): string[] };
      openExternal(url: string): Promise<null>;
      displays(): Promise<readonly Record<string, unknown>[]>;
      permissionStatus(kind: string): Promise<string>;
      watchPower(): Promise<{ next(): Promise<string | null>; close(): Promise<null> }>;
      watchDroppedFiles(): Promise<{ next(): Promise<unknown>; close(): Promise<null> }>;
    }>(directory, "desktop", "velar/desktop", { files: ["app-data", "dropped"], links: ["https", "mailto"] });

    assert.deepEqual(module.SystemPermission.values(), ["screenRecording", "accessibility", "microphone"]);
    assert.deepEqual(module.PermissionStatus.values(), ["granted", "denied", "undetermined"]);
    assert.deepEqual(module.PowerState.values(), ["suspended", "resumed"]);

    assert.equal(await module.openExternal("https://velarscript.dev/guide"), null);
    assert.equal(await module.openExternal("mailto:ada@example.com"), null);
    const opened = calls.length;
    await assert.rejects(module.openExternal("ftp://example.com/file"), /cannot open a 'ftp' URL/u);
    await assert.rejects(module.openExternal("/guide"), /openExternal requires an absolute URL/u);
    assert.equal(calls.length, opened, "an ungranted scheme never reaches the host");

    assert.deepEqual(await module.displays(), [display]);
    assert.equal(module.Display.is(display), true);
    assert.equal(module.Display.is({ ...display, scale: 0 }), false);
    assert.equal(await module.permissionStatus("microphone"), "denied");
    assert.equal(await module.permissionStatus("screenRecording"), "undetermined");
    await assert.rejects(module.permissionStatus("camera"), /Value does not match SystemPermission/u);

    power.push("suspended", "resumed", null);
    const states = await module.watchPower();
    assert.equal(module.PowerStream.is(states), true);
    assert.equal(module.DroppedFilesStream.is(states), false);
    const pull = states.next();
    await assert.rejects(states.next(), /PowerStream\.next already has an active pull/u);
    assert.equal(await pull, "suspended");
    assert.equal(await states.next(), "resumed");
    assert.equal(await states.next(), null);
    assert.equal(await states.close(), null);

    drops.push({ paths: ["/Users/ada/one.txt", "/Users/ada/two.txt"] }, null);
    const dropped = await module.watchDroppedFiles();
    assert.equal(module.DroppedFilesStream.is(dropped), true);
    // The order is the order of the gesture, so it is preserved rather than
    // sorted: the first file the user dropped is the first path here.
    assert.deepEqual(await dropped.next(), { paths: ["/Users/ada/one.txt", "/Users/ada/two.txt"] });
    assert.equal(await dropped.next(), null);
    assert.equal(await dropped.close(), null);
    assert.equal(module.DroppedFiles.is({ paths: ["/a"] }), true);
    assert.equal(module.DroppedFiles.is({ paths: ["relative"] }), false);
    assert.equal(module.DroppedFiles.is({ paths: [] }), false);
  } finally {
    delete (globalThis as { [key: symbol]: unknown })[bridgeKey];
    await rm(directory, { recursive: true, force: true });
  }
});
