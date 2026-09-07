/** `velar check`'s own report: how many modules passed, and how many advisories came with them. */

import type { CommandArguments } from "../arguments.ts";
import type { VelarProjectConfig } from "../config.ts";
import { displayInput } from "../help.ts";
import type { CheckedProject } from "../project-check.ts";

export function reportCheckedProject(
  checked: CheckedProject,
  parsed: CommandArguments,
  projectConfig: VelarProjectConfig,
): number {
  const count = checked.compiled.size;
  // D89: a passing check that carried advisories says how many. Folding them
  // into a silent "checked N modules" would hide the one thing the advisory
  // channel exists to make impossible to miss; the exit code stays 0 either
  // way, because an advisory is not a failure.
  const advisories = checked.advisories.length;
  process.stdout.write(
    `Checked ${count} module${count === 1 ? "" : "s"} from ${displayInput(parsed.input, projectConfig)}`
    + `${advisories > 0 ? ` — ${advisories} advisor${advisories === 1 ? "y" : "ies"}` : ""}\n`,
  );
  return 0;
}
