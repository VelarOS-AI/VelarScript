/** `velar verify`: the exact Web or Node production manifest, inventory and hashes. */

import { parseSingleOptionalInput } from "../arguments.ts";
import { verifyApplicationBuild } from "../application-verifier.ts";
import { hostErrorMessage } from "../host-error.ts";

export async function runVerifyCommand(rest: readonly string[]): Promise<number> {
  const input = parseSingleOptionalInput(rest);
  if (input !== null && typeof input === "object") {
    process.stderr.write(`velar verify: ${input.error}\n`);
    return 2;
  }
  try {
    const verified = await verifyApplicationBuild(input);
    if (verified.kind === "framework") {
      // 保留既有 Web CLI 的成功输出契约；统一分派只扩展可校验的产物类型，
      // 不应让依赖这段稳定文本的脚本因为内部重构而失效。
      process.stdout.write(`Verified production ${verified.build.manifest.framework.capability} build ${verified.build.manifest.buildId} -> ${verified.build.directory}\n`);
    } else {
      process.stdout.write(`Verified node build ${verified.build.manifest.buildId} -> ${verified.build.directory}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`velar verify: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
