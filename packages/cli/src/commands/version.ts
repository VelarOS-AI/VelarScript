/** `velar --version`: the release number and the five surfaces it ships. */

import { formatSurfaceVersions } from "../surface-versions.ts";
import { VELAR_VERSION } from "../version.ts";

export async function runVersionCommand(rest: readonly string[]): Promise<number> {
  if (rest.length > 0) {
    process.stderr.write("velar --version: this option does not accept arguments\n");
    return 2;
  }
  // D110 rule 6: the release number, then the five surfaces it ships. The
  // first line is what you installed; the second is what an upgrade actually
  // asks you to re-read, which the release number alone cannot say.
  process.stdout.write(`velar ${VELAR_VERSION}\n  ${await formatSurfaceVersions()}\n`);
  return 0;
}
