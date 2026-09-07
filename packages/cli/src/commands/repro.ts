/**
 * `velar repro`: a self-contained minimal reproduction of a failing check.
 *
 * The bundle is re-checked by spawning the toolchain entry again, and that
 * entry is the `velar` command file rather than this module — the caller hands
 * it in, because `import.meta.url` here would name the arm and not the command.
 */

import { parseReproArguments } from "../arguments.ts";
import { resolveVelarProject, type VelarProjectConfig } from "../config.ts";
import { displayInput } from "../help.ts";
import { hostErrorMessage } from "../host-error.ts";
import { checkResolvedProject } from "../project-check.ts";
import { writeReproduction } from "../reproduction.ts";

export async function runReproCommand(rest: readonly string[], toolchainEntry: string): Promise<number> {
  const parsed = parseReproArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar repro: ${parsed}\n`);
    return 2;
  }
  let reproConfig: VelarProjectConfig;
  try {
    reproConfig = await resolveVelarProject(parsed.input);
  } catch (error) {
    process.stderr.write(`velar repro: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  try {
    const checked = await checkResolvedProject(reproConfig, parsed.input);
    if (checked.errors.length === 0) {
      process.stderr.write(`velar repro: ${displayInput(parsed.input, reproConfig)} checks without errors; there is no failure to reproduce\n`);
      return 1;
    }
    const reproduction = await writeReproduction({
      config: reproConfig,
      input: parsed.input,
      checked,
      outputDirectory: parsed.outputDirectory,
      toolchainEntry,
    });
    process.stdout.write(`Wrote a minimal reproduction of ${checked.errors.length} diagnostic${checked.errors.length === 1 ? "" : "s"} -> ${reproduction.directory}\n`);
    // Discipline 3: the bundle was re-checked in an extracted copy, and a
    // bundle that stopped reproducing says so instead of being handed over
    // as a clean report.
    process.stdout.write(reproduction.reproduced
      ? "The extracted bundle produces the same diagnostics.\n"
      : "Reproduces on this machine but not in the extracted bundle; the README says what the copy reported instead.\n");
    return 0;
  } catch (error) {
    process.stderr.write(`velar repro: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
