import { fileURLToPath } from "node:url";
import { VELAR_PROGRAM_FAILURE_MODULE_SOURCE } from "./runtime-sources.generated.ts";

interface ProgramErrorRuntime {
  formatProgramFailure(error: unknown, harness?: string, fullStack?: boolean, command?: string, ownHeader?: boolean, runtimeRoots?: readonly string[]): string;
  hostErrorTrace(error: unknown, fallback: string): string;
  hostErrorContext(): { readonly fullStack: boolean; readonly command: string } | null;
}

// Only toolchain-distributed static source enters this module URL. Loading it
// once gives the synchronous reporters the same implementation the launcher
// inlines, without depending on a checkout-relative or generated output path.
const runtime = await import(`data:text/javascript;base64,${Buffer.from(VELAR_PROGRAM_FAILURE_MODULE_SOURCE).toString("base64")}`) as ProgramErrorRuntime;
// The installed CLI is one known owner. Its actual directory, not a pattern
// guessed from an author's paths, identifies supervisor and runner frames.
const runtimeUrl = new URL("./", import.meta.url);
const runtimeRoots = [runtimeUrl.href, fileURLToPath(runtimeUrl).replaceAll("\\", "/")];

export function formatProgramFailure(error: unknown, harness?: string, fullStack?: boolean): string {
  const context = runtime.hostErrorContext();
  return runtime.formatProgramFailure(error, harness, fullStack ?? context?.fullStack ?? false, context?.command ?? "velar test", true, runtimeRoots);
}

export function formatProgramHostError(error: unknown): string {
  return runtime.hostErrorTrace(error, "A program error was reported");
}

export function programStackContextSource(fullStack: boolean, command = "velar test"): string {
  return `globalThis[Symbol.for("velar.run.stack")] = Object.freeze(${JSON.stringify({ fullStack, command })});`;
}

export function installProgramStackContext(fullStack: boolean, command = "velar test"): void {
  Object.defineProperty(globalThis, Symbol.for("velar.run.stack"), {
    value: Object.freeze({ fullStack, command, runtimeRoots: Object.freeze([...runtimeRoots]) }), configurable: true, writable: true,
  });
}
