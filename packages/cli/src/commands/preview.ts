/** `velar preview`: a local server that serves only a verified production build. */

import { parsePreviewArguments } from "../arguments.ts";
import { hostErrorMessage } from "../host-error.ts";
import { runProductionPreview } from "../preview-server.ts";
import { verifyProductionBuild } from "../production-verifier.ts";

export async function runPreviewCommand(rest: readonly string[]): Promise<number> {
  const parsed = parsePreviewArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar preview: ${parsed}\n`);
    return 2;
  }
  try {
    const verified = await verifyProductionBuild(parsed.input);
    await runProductionPreview(verified, parsed.port);
    return 0;
  } catch (error) {
    process.stderr.write(`velar preview: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
