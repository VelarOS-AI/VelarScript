import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { variadicCliRunner } from "../support/run-cli.ts";
import { linkVelarExtension } from "../support/web-project.ts";
import { VelarProjectSessions } from "../../packages/cli/src/project-session.ts";
import { projectSessionDiagnostics } from "../../packages/cli/src/project-session-diagnostics.ts";

after(removeTemporaryDirectories);

const runCli = variadicCliRunner({ timeout: 120_000 });

/**
 * GA-D2 / GA-I4 / DT-D1 — every project-level rule reports in the shape
 * `docs/getting-started.md` calls the shape of *every* diagnostic:
 * `file:line:column error VELxxxx`, followed by the source line and a caret.
 *
 * Each of these rules is about something somebody wrote — a manifest line, a
 * module, an import — so each of them has a site. Before this, the whole family
 * reached the author as prose: a bare Node `ENOENT` string carrying the path
 * twice, or `path: sentence` with no code and no position, printed in the same
 * run as compiler diagnostics that had all three.
 */

/** The `file:line:column error CODE: message` header of the first report. */
function firstReport(output: string): string {
  return output.split("\n")[0] ?? "";
}

async function project(prefix: string, files: Readonly<Record<string, string>>): Promise<string> {
  const root = await makeTemporaryDirectory(prefix);
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  return root;
}

function manifest(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ formatVersion: 2, kind: "application", entry: "src/main.vel", outDir: "dist", ...fields }, null, 2)}\n`;
}

test("[GA-D2] a missing entry file reports on the manifest line that declared it", async () => {
  const root = await project("velar-missing-entry-", { "velar.json": manifest({ extensions: [] }) });

  const checked = runCli(root, "check");
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(
    firstReport(checked.stderr),
    /velar\.json:4:13 error VEL6001: Entry module "src\/main\.vel" does not exist$/u,
    checked.stderr,
  );
  // The frame is cut from the manifest, and the caret marks the declared path.
  assert.match(checked.stderr, /\n {2}"entry": "src\/main\.vel",\n {12}\^{12}\n/u, checked.stderr);
  // The path is named once by the message; the header names `velar.json`. The
  // host's own `stat` sentence used to print the entry a second time.
  assert.equal(checked.stderr.match(/src\/main\.vel/gu)?.length, 2, checked.stderr);
  assert.doesNotMatch(checked.stderr, /ENOENT/u, checked.stderr);
});

test("[GA-I4] the application-entry rule reports with a code and the entry's own site", async () => {
  const root = await project("velar-application-entry-rule-", {
    "velar.json": manifest({ extensions: ["@velarscript/web"], web: { title: "App", base: "/" } }),
    "src/main.vel": "print(\"first\")\nprint(\"second\")\n",
  });
  await linkVelarExtension(root, "web");

  const checked = runCli(root, "check");
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(
    firstReport(checked.stderr),
    /src\/main\.vel:1:1 error VEL6011: Application entry must declare '@main' and perform startup inside that region$/u,
    checked.stderr,
  );
  assert.match(checked.stderr, /\nprint\("first"\)\n\^\n/u, checked.stderr);
  // Two startup statements are an ordering the author owns, so this one stays
  // a diagnostic rather than migrating; `fix` reports it in the same shape.
  const fixed = runCli(root, "fix");
  assert.equal(fixed.status, 1, fixed.stdout + fixed.stderr);
  assert.match(fixed.stderr, /src\/main\.vel:1:1 error VEL6011: Application entry must declare '@main'/u, fixed.stderr);
});

test("[GA-I4] serve reports the application-entry rule the way check does", async () => {
  const root = await project("velar-application-entry-serve-", {
    "velar.json": manifest({ extensions: ["@velarscript/server"], server: { configuration: "application.yml" } }),
    "application.yml": "server:\n  host: 127.0.0.1\n  port: 3000\n",
    "src/main.vel": "print(\"no main region here\")\n",
  });
  await linkVelarExtension(root, "server");

  const served = runCli(root, "serve");
  assert.equal(served.status, 1, served.stdout + served.stderr);
  assert.match(
    firstReport(served.stderr),
    /src\/main\.vel:1:1 error VEL6011: Application entry must declare '@main' and perform startup inside that region$/u,
    served.stderr,
  );
});

test("[GA-I4] the Server configuration rule reports on the manifest key that declared the file", async () => {
  const root = await project("velar-server-configuration-rule-", {
    "velar.json": manifest({ extensions: ["@velarscript/server"], server: { configuration: "config/app.yml" } }),
    "src/main.vel": "@main:\n    print(\"ready\")\n",
  });
  await linkVelarExtension(root, "server");

  const checked = runCli(root, "check");
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(
    firstReport(checked.stderr),
    /velar\.json:\d+:\d+ error VEL6013: Server configuration 'config\/app\.yml' does not exist$/u,
    checked.stderr,
  );
  assert.match(checked.stderr, /\n {4}"configuration": "config\/app\.yml"\n {22}\^{14}\n/u, checked.stderr);
  // The subject is named once, and its first two words no longer repeat.
  assert.doesNotMatch(checked.stderr, /Configured Server configuration/u, checked.stderr);
  for (const command of ["fix", "serve"]) {
    const result = runCli(root, command);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(firstReport(result.stderr), firstReport(checked.stderr));
  }

  const sessions = new VelarProjectSessions();
  const entry = join(root, "src/main.vel");
  const initial = await sessions.snapshot(entry);
  const manifestPath = join(root, "velar.json");
  assert.equal(projectSessionDiagnostics(initial, manifestPath)[0]?.code, "VEL6013");
  await mkdir(join(root, "config"));
  await writeFile(join(root, "config/app.yml"), "server:\n  port: 0\n", "utf8");
  const valid = await sessions.snapshot(entry);
  assert.deepEqual(projectSessionDiagnostics(valid, manifestPath), []);
  assert.equal(valid.activity.projectReused, true);
  await rm(join(root, "config/app.yml"));
  const missing = await sessions.snapshot(entry);
  assert.equal(projectSessionDiagnostics(missing, manifestPath)[0]?.code, "VEL6013");
  assert.equal(missing.activity.projectReused, true);
});

test("missing entry diagnostics survive a shared project session refresh", async () => {
  const root = await project("velar-session-missing-entry-", {
    "velar.json": manifest({ extensions: [] }),
    "src/probe.vel": "export const ready = true\n",
  });
  const sessions = new VelarProjectSessions();
  const snapshot = await sessions.snapshot(join(root, "src/probe.vel"));
  assert.equal(projectSessionDiagnostics(snapshot, join(root, "velar.json"))[0]?.code, "VEL6001");
});

test("missing entry messages decode the winning JSON key and retain its authored source span", async () => {
  const source = manifest({ extensions: [] }).replace('"entry": "src/main.vel"', '"entry": "shadowed.vel",\n  "ent\\u0072y": "src\\u002fmain.vel"');
  const root = await project("velar-missing-entry-escape-", { "velar.json": source, src: "not a directory" });
  const checked = runCli(root, "check");
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(firstReport(checked.stderr), /velar\.json:5:18 error VEL6001: Entry module "src\/main\.vel" does not exist$/u);
  assert.match(checked.stderr, /"ent\\u0072y": "src\\u002fmain\.vel"/u);
});

test("[DT-D1] a Desktop permission refusal reports on the import that reached for it", async () => {
  const root = await makeTemporaryDirectory("velar-desktop-permission-rule-");
  const created = runCli(root, "create", root, "--template", "desktop");
  assert.equal(created.status, 0, created.stdout + created.stderr);
  await writeFile(join(root, "src", "probe.vel"), [
    'import {NotificationActivation} from "velar/notification"',
    "",
    "export def activated(value: NotificationActivation) -> NotificationActivation:",
    "    return value",
    "",
  ].join("\n"), "utf8");

  const checked = runCli(root, "check");
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(
    firstReport(checked.stderr),
    /src\/probe\.vel:1:39 error VEL6014: Desktop source imports 'velar\/notification' but desktop\.permissions\.notifications is not true$/u,
    checked.stderr,
  );
  // The caret marks the specifier, not the whole import statement.
  assert.match(checked.stderr, /\nimport \{NotificationActivation\} from "velar\/notification"\n {38}\^{18}\n/u, checked.stderr);

  // Granting the permission the report names is all it takes.
  const manifestPath = join(root, "velar.json");
  const declared = JSON.parse(await readFile(manifestPath, "utf8")) as {
    desktop: { permissions: Record<string, unknown> };
  };
  declared.desktop.permissions.notifications = true;
  await writeFile(manifestPath, `${JSON.stringify(declared, null, 2)}\n`, "utf8");
  const granted = runCli(root, "check");
  assert.equal(granted.status, 0, granted.stdout + granted.stderr);
  await rm(root, { recursive: true, force: true });
});
