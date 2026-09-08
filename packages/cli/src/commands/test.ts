/** `velar test`: Core tests, or explicit browser tests under a real engine. */

import { parseTestArguments } from "../arguments.ts";
import { resolveVelarProject, type VelarProjectConfig } from "../config.ts";
import { hostErrorMessage, isMissingHostModule } from "../host-error.ts";
import { runTests } from "../test-runner.ts";

export async function runTestCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseTestArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar test: ${parsed}\n`);
    return 2;
  }
  if (!parsed.browser && parsed.input?.endsWith(".browser.test.vel")) {
    process.stderr.write("velar test: .browser.test.vel files require --browser\n");
    return 2;
  }
  if (parsed.browser && parsed.input?.endsWith(".test.vel") && !parsed.input.endsWith(".browser.test.vel")) {
    process.stderr.write("velar test: --browser accepts a project or .browser.test.vel file\n");
    return 2;
  }
  let projectConfig: VelarProjectConfig;
  try {
    projectConfig = await resolveVelarProject(parsed.input);
    if (parsed.browser && parsed.input?.endsWith(".browser.test.vel") && projectConfig.manifestPath) {
      projectConfig = await resolveVelarProject(projectConfig.root);
    }
  } catch (error) {
    process.stderr.write(`velar test: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  if (parsed.browser) {
    // D111 rule 6: Playwright is an optional peer, so a project that never
    // declared it reaches here with nothing to load. That is a missing
    // install rather than a crash, and it is told the same way the engine
    // download below it is: name the command that fixes it.
    let runBrowserTests;
    try {
      ({ runBrowserTests } = await import("../browser-test-runner.ts"));
    } catch (error) {
      if (!isMissingHostModule(error, "playwright")) throw error;
      process.stderr.write("velar test: --browser drives real browsers through Playwright, which this project does not install.\nInstall it with: npm install --save-dev playwright\n");
      return 1;
    }
    return runBrowserTests(projectConfig, parsed.input, parsed.browser, { fullStack: parsed.fullStack });
  }
  return runTests(projectConfig, parsed.input, { fullStack: parsed.fullStack });
}
