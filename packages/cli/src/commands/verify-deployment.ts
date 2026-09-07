/** `velar verify-deployment`: verified local bytes against an HTTPS deployment. */

import { parseDeploymentVerificationArguments } from "../arguments.ts";
import { createDeploymentVerificationReport, verifyRemoteDeployment } from "../deployment-verifier.ts";
import { hostErrorMessage } from "../host-error.ts";
import { verifyProductionBuild } from "../production-verifier.ts";

export async function runVerifyDeploymentCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseDeploymentVerificationArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar verify-deployment: ${parsed}\n`);
    return 2;
  }
  const url = parsed.url ?? process.env.VELAR_DEPLOYMENT_URL?.trim() ?? "";
  if (!url) {
    process.stderr.write("velar verify-deployment: provide --url <deployment-origin> or VELAR_DEPLOYMENT_URL\n");
    return 2;
  }
  try {
    const verified = await verifyProductionBuild(parsed.input);
    const deployment = await verifyRemoteDeployment(verified, url);
    if (parsed.json) {
      process.stdout.write(`${JSON.stringify(createDeploymentVerificationReport(verified, deployment), null, 2)}\n`);
    } else {
      process.stdout.write(
        `Verified deployed ${verified.manifest.framework.capability} build ${deployment.buildId} at ${deployment.url} `
        + `(${deployment.checkedFiles} files, ${deployment.checkedRoutes} routes, ${deployment.checkedHeaders} headers)\n`,
      );
    }
    return 0;
  } catch (error) {
    process.stderr.write(`velar verify-deployment: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
