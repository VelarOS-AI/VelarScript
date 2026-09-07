/**
 * Which `velar/*` surfaces `@velarscript/web` publishes, and in what order the
 * map declares them.
 *
 * D115 P4 R3e, the shape D114 R4a gave `packages/node/src/module-policy.ts`:
 * each entry is built by the `modules/<surface>.ts` file that owns that
 * surface's tables, and `compiler.ts` assembles `webModuleInterfaces` from this
 * list. The roster lives here rather than in `compiler.ts` because a file that
 * is imported to build the map cannot import the map back — that edge is a
 * cycle, and a `const` read across one is a temporal dead zone rather than a
 * type error.
 */
import type { ModuleInterface } from "@velarscript/compiler";
import { velarAppModuleEntry } from "./modules/app.ts";
import { velarBrowserModuleEntry } from "./modules/browser.ts";
import { velarBrowserTestModuleEntry } from "./modules/browser-test.ts";
import { velarConfigModuleEntry } from "./modules/config.ts";
import { velarFilesModuleEntry } from "./modules/files.ts";
import { velarFormsModuleEntry } from "./modules/forms.ts";
import { velarHttpModuleEntry } from "./modules/http.ts";
import { velarLookModuleEntry } from "./modules/look.ts";
import { velarRealtimeModuleEntry } from "./modules/realtime.ts";
import { velarStorageModuleEntry } from "./modules/storage.ts";
import { velarWebModuleEntry } from "./modules/web.ts";
import { velarWebSocketModuleEntry } from "./modules/websocket.ts";

/** The `webModuleInterfaces` entries, in the order that map declares them. */
export const webModuleEntries: readonly (readonly [string, ModuleInterface])[] = [
  velarWebSocketModuleEntry,
  velarLookModuleEntry,
  velarAppModuleEntry,
  velarConfigModuleEntry,
  velarWebModuleEntry,
  velarHttpModuleEntry,
  velarStorageModuleEntry,
  velarFormsModuleEntry,
  velarBrowserModuleEntry,
  velarFilesModuleEntry,
  velarRealtimeModuleEntry,
  velarBrowserTestModuleEntry,
];
