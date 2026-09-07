import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryRoot } from "./repository-root.ts";
import { type CommandOutcome, runCommandOutcome } from "./run-command.ts";
import { linkVelarExtension } from "./web-project.ts";

/**
 * D115 P5 — the one-page Web project the Web runtime hotfix probes run
 * `velar test` over, from `tests/web/runtime.slow.test.ts` before it was split
 * at 1,214 lines.
 *
 * Half of those probes assert that a run *fails* in a particular bounded way,
 * so the exit code comes back rather than throwing: what the run reported is
 * the evidence. `tests/support/web-marathon-fixture.ts` is the sibling for the
 * probes that assert a run passes. The two are not one helper because the
 * project title reaches the emitted page and the test file's name reaches the
 * run's own report, and both are read by the assertions.
 */
interface Fixture {
  readonly application: string;
  readonly tests?: string;
  readonly browserTests?: string;
}

/**
 * `true` runs the fixture's browser tests in Chromium, which is what the paths
 * measured here were measured in; `"all"` runs Chromium, Firefox and WebKit,
 * for the one path whose evidence is that every engine agrees.
 */
type BrowserRun = boolean | "all";

export async function runFixture(prefix: string, fixture: Fixture, browser: BrowserRun): Promise<CommandOutcome> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await linkVelarExtension(directory, "web");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "Web runtime hardening" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), fixture.application, "utf8");
    if (fixture.tests !== undefined) {
      await writeFile(join(directory, "src", "runtime.test.vel"), fixture.tests, "utf8");
    }
    if (fixture.browserTests !== undefined) {
      await writeFile(join(directory, "src", "runtime.browser.test.vel"), fixture.browserTests, "utf8");
    }
    return await runCommandOutcome(process.execPath, [
      join(repositoryRoot, "packages", "cli", "src", "cli.ts"), "test", directory,
      ...(browser ? ["--browser", browser === "all" ? "all" : "chromium"] : []),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
