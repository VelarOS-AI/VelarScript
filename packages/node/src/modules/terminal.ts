/**
 * `velar/terminal`
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface } from "@velarscript/compiler";
import { boolType, capabilityHandle, functionType, listStringType, moduleInterface, nullType, promise, stringType } from "./types.ts";

// D51 (audit 12): the terminal is a standard capability handle that publishes
// `close()`, so `using` supplies its release contract (charter section 16). The
// marker is set by this target, never inferred from the shape.
const terminalType = capabilityHandle({
  args: functionType([], [], listStringType),
  isInteractive: functionType([], [], boolType),
  readLine: functionType(["prompt"], [stringType], promise(optional(stringType)), 0),
  write: functionType(["text"], [stringType], promise(nullType)),
  writeError: functionType(["text"], [stringType], promise(nullType)),
  close: functionType([], [], nullType),
});

export const velarTerminalModuleEntry: readonly [string, ModuleInterface] = ["velar/terminal", moduleInterface(new Map([
  ["terminal", terminalType],
]))];
