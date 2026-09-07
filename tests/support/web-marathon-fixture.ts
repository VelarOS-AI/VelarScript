import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryRoot } from "./repository-root.ts";
import { runCommand } from "./run-command.ts";
import { linkVelarExtension } from "./web-project.ts";

/**
 * D115 P5 — the one-page Web project the marathon defect ledger's browser
 * probes run `velar test --browser chromium` over, from
 * `tests/web/reactive-graph-and-runtime-abi.slow.test.ts` before it was split
 * at 881 lines.
 *
 * Every one of those probes asserts that the run passes, so a non-zero exit is
 * a failure of the test and carries the run's whole report as its message.
 * `tests/support/web-runtime-fixture.ts` is the sibling for the probes that
 * assert a run fails; the two stay apart because the project title reaches the
 * emitted page and the test file's name reaches the run's report.
 */
interface BrowserFixture {
  readonly application: string;
  readonly tests: string;
}

export async function runBrowserFixture(prefix: string, fixture: BrowserFixture): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await linkVelarExtension(directory, "web");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "Marathon Web hardening" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), fixture.application, "utf8");
    await writeFile(join(directory, "src", "marathon.browser.test.vel"), fixture.tests, "utf8");
    return await runCommand(process.execPath, [
      join(repositoryRoot, "packages", "cli", "src", "cli.ts"), "test", directory, "--browser", "chromium",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
