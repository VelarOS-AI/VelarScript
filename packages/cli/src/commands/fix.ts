/** `velar fix`: every mechanical rewrite the compiler's own diagnostics name. */

import { parseSingleOptionalInput } from "../arguments.ts";
import { migrateVelarProjectManifest, resolveVelarProject, type VelarProjectConfig } from "../config.ts";
import { displayPath } from "../help.ts";
import { hostErrorMessage } from "../host-error.ts";
import { applyProjectMechanicalFixes } from "../mechanical-fixer.ts";

export async function runFixCommand(rest: readonly string[]): Promise<number> {
  const input = parseSingleOptionalInput(rest);
  if (input !== null && typeof input === "object") {
    process.stderr.write(`velar fix: ${input.error}\n`);
    return 2;
  }
  // The manifest is migrated first, because a retired manifest shape is what
  // fails the project resolution below: the source fixer never gets to run
  // while `velar.json` still names a field this compiler removed.
  const manifestChanges: string[] = [];
  try {
    const migration = await migrateVelarProjectManifest(input);
    if (migration) manifestChanges.push(...migration.changes.map((change) => `${displayPath(migration.manifestPath)} ${change}`));
  } catch (error) {
    process.stderr.write(`velar fix: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  let fixConfig: VelarProjectConfig;
  try {
    fixConfig = await resolveVelarProject(input);
  } catch (error) {
    for (const change of manifestChanges) process.stdout.write(`${change}\n`);
    process.stderr.write(`velar fix: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  let report;
  try {
    report = await applyProjectMechanicalFixes(fixConfig, input, displayPath);
  } catch (error) {
    for (const change of manifestChanges) process.stdout.write(`${change}\n`);
    process.stderr.write(`velar fix: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  for (const change of manifestChanges) process.stdout.write(`${change}\n`);
  for (const change of report.changes) process.stdout.write(`${change}\n`);
  if (report.remainingDiagnostics.length > 0) process.stderr.write(`${report.remainingDiagnostics.join("\n\n")}\n`);
  // D51 item NEW-D8: a write that failed is named, and the summary that says
  // what did change is printed either way — a rewritten tree is never left
  // unreported.
  for (const failure of report.writeFailures) process.stderr.write(`velar fix: could not write ${failure}\n`);
  // The manifest counts as one changed file and each of its migrations as one
  // fix, so the summary reports the whole rewritten tree rather than only its
  // `.vel` half.
  const files = report.changedFiles.length + (manifestChanges.length > 0 ? 1 : 0);
  const applied = report.changes.length + manifestChanges.length;
  // D114 WB-I2: the other channel is in the summary too. `velar fix` used to
  // end on "0 diagnostics remain" over a tree `velar check` still had something
  // to say about — an advisory is not a diagnostic, so the sentence was true
  // and told the author nothing about what was left. Advisories never fail the
  // command; they are counted, not refused.
  const advisories = report.remainingAdvisories;
  const remaining = report.remainingDiagnostics.length;
  process.stdout.write(
    `applied ${applied} mechanical fix${applied === 1 ? "" : "es"}`
    + `${files > 0 ? ` in ${files} file${files === 1 ? "" : "s"}` : ""}`
    + `${report.writeFailures.length > 0 ? `; ${report.writeFailures.length} file${report.writeFailures.length === 1 ? "" : "s"} could not be written` : ""}`
    + `; ${remaining} diagnostic${advisories > 0
      ? `${remaining === 1 ? "" : "s"} and ${advisories} advisor${advisories === 1 ? "y" : "ies"} remain`
      : remaining === 1 ? " remains" : "s remain"}\n`,
  );
  return report.remainingDiagnostics.length > 0 || report.writeFailures.length > 0 ? 1 : 0;
}
