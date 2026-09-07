/**
 * Which `velar/*` surfaces `@velarscript/node` publishes, and what follows from
 * that roster when a program that imports one is built for another target.
 *
 * D115 P4 R4a: the roster is the subject of every rule in this file — a module
 * is Node's because it is in it, a module is Node-*only* because it is in it
 * and not shared with the Web — so the ordered entries live here and
 * `compiler.ts` assembles `nodeModuleInterfaces` from them. Each entry is built
 * by the `modules/<surface>.ts` file that owns that surface's tables.
 */
import type { ModuleInterface } from "@velarscript/compiler";
import { velarEnvironmentModuleEntry } from "./modules/env.ts";
import { velarFilesystemModuleEntry } from "./modules/fs.ts";
import { velarHostModuleEntry } from "./modules/host.ts";
import { velarHttpModuleEntry } from "./modules/http.ts";
import { velarPathModuleEntry } from "./modules/path.ts";
import { velarProcessModuleEntry } from "./modules/process.ts";
import { velarServeModuleEntry } from "./modules/serve.ts";
import { velarServerTestModuleEntry } from "./modules/server-test.ts";
import { velarTerminalModuleEntry } from "./modules/terminal.ts";
import { velarWebSocketModuleEntry } from "./modules/websocket.ts";

/** The `nodeModuleInterfaces` entries, in the order that map declares them. */
export const nodeModuleEntries: readonly (readonly [string, ModuleInterface])[] = [
  velarWebSocketModuleEntry,
  velarServerTestModuleEntry,
  velarServeModuleEntry,
  velarFilesystemModuleEntry,
  velarEnvironmentModuleEntry,
  velarHostModuleEntry,
  velarTerminalModuleEntry,
  velarPathModuleEntry,
  velarProcessModuleEntry,
  velarHttpModuleEntry,
];

const nodeModules = new Set(nodeModuleEntries.map(([source]) => source));
const sharedPlatformModules = new Set(["velar/http", "velar/websocket"]);

export function isNodeModule(source: string): boolean {
  return nodeModules.has(source);
}

export function isNodeOnlyModule(source: string): boolean {
  return nodeModules.has(source) && !sharedPlatformModules.has(source);
}

/**
 * SV-C2: the Standard API promises "platform-specific guidance" for a local
 * module a Web target refuses, and guidance is where to go, not only that this
 * door is shut. Every local module says it here — including the three that
 * honestly have no Web equivalent, because "there is none" is guidance too and
 * is what stops an author looking for one.
 */
const nodeModuleWebGuidance: ReadonlyMap<string, string> = new Map([
  ["velar/serve", "web applications are served by the dev server in development and by static hosting in production; call an HTTP API with velar/http"],
  ["velar/path", "use velar/url to build and read URL paths; the Web has no filesystem paths"],
  ["velar/fs", "use velar/files for files the person using the application picks or saves"],
  ["velar/env", "use velar/config for values the build supplies"],
  ["velar/host", "the Web has no equivalent: a page does not own the process it runs in"],
  ["velar/terminal", "the Web has no equivalent: a page has no terminal"],
  ["velar/process", "the Web has no equivalent: a page cannot start local programs"],
]);

export function nodeModuleDiagnostic(source: string): string {
  const guidance = nodeModuleWebGuidance.get(source);
  return `${source} is a local runtime module and cannot run in a web application`
    + (guidance === undefined ? "" : `; ${guidance}`);
}
