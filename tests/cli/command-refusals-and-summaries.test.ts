import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { variadicCliRunner } from "../support/run-cli.ts";
import { linkVelarExtension } from "../support/web-project.ts";

after(removeTemporaryDirectories);

const runCli = variadicCliRunner({ timeout: 120_000 });

async function project(prefix: string, files: Readonly<Record<string, string>>): Promise<string> {
  const root = await makeTemporaryDirectory(prefix);
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  return root;
}

const CORE_MANIFEST = `${JSON.stringify({
  formatVersion: 2,
  kind: "application",
  entry: "src/main.vel",
  outDir: "dist",
  extensions: [],
}, null, 2)}\n`;

/**
 * CO-I16: the noun counts the files that were read; the verb agrees with the
 * subject, which is the files that need formatting. Pluralizing only the noun
 * wrote "1 of 1 VelarScript source file require formatting".
 */
test("[CO-I16] format --check makes its verb agree with the count that needs formatting", async () => {
  const root = await project("velar-format-check-agreement-", {
    "velar.json": CORE_MANIFEST,
    // The canonical layout of a one-statement region is the inline body.
    "src/main.vel": "@main: print(\"one\")\n",
    "src/second.vel": "export const second = 2\n",
  });
  const green = runCli(root, "format", "--check");
  assert.equal(green.status, 0, green.stdout + green.stderr);

  await writeFile(join(root, "src", "main.vel"), "@main:  print(\"one\")\n", "utf8");
  const one = runCli(root, "format", "--check");
  assert.equal(one.status, 1, one.stdout + one.stderr);
  assert.match(one.stderr, /\n1 of 2 VelarScript source files requires formatting\n$/u, one.stderr);

  await writeFile(join(root, "src", "second.vel"), "export const second  = 2\n", "utf8");
  const two = runCli(root, "format", "--check");
  assert.equal(two.status, 1, two.stdout + two.stderr);
  assert.match(two.stderr, /\n2 of 2 VelarScript source files require formatting\n$/u, two.stderr);
});

/**
 * GA-U6: which commands a project can run is decided by one list in one file,
 * so a refusal says which file and which key. A reader told a project "does not
 * declare a Web target" still has to guess where that declaration would go.
 */
test("[GA-U6] a command-level refusal names velar.json and its extensions entry", async () => {
  const web = await project("velar-refusal-web-", {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "application",
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "App", base: "/" },
    }, null, 2)}\n`,
    "src/main.vel": "@main:\n    print(\"web\")\n",
  });
  await linkVelarExtension(web, "web");
  const ran = runCli(web, "run");
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  // The CLI runs in the project root, so the manifest is named the way the
  // reader typed their way there.
  assert.equal(
    ran.stderr,
    "velar run: velar.json lists '@velarscript/web' in 'extensions', which makes this a Web application; use 'velar dev' or 'velar build' instead\n",
  );

  const core = await project("velar-refusal-core-", {
    "velar.json": CORE_MANIFEST,
    "src/main.vel": "@main:\n    print(\"core\")\n",
  });
  const served = runCli(core, "serve");
  assert.equal(served.status, 1, served.stdout + served.stderr);
  assert.equal(
    served.stderr,
    "velar serve: velar.json 'extensions' does not activate a Node-capable application target such as '@velarscript/server' or '@velarscript/node'\n",
  );

  const developed = runCli(core, "dev");
  assert.equal(developed.status, 1, developed.stdout + developed.stderr);
  assert.equal(
    developed.stderr,
    "velar dev: velar.json 'extensions' does not declare a Web, Desktop, or Node application target\n",
  );
});

/**
 * GA-U5: `--port 0` means "any free port" for `preview` for the same reason it
 * does for `dev` — both servers report the port they bound rather than the one
 * they were asked for — so the two commands take one rule. `dev` accepted it
 * and `preview` refused it with exit 2.
 */
test("[GA-U5] preview accepts --port 0 the way dev does", async () => {
  const root = await project("velar-preview-port-zero-", {
    "velar.json": CORE_MANIFEST,
    "src/main.vel": "@main:\n    print(\"ready\")\n",
  });
  // The port is parsed before anything is verified, so a project with no build
  // proves which of the two refusals the argument now earns.
  const zero = runCli(root, "preview", "--port", "0");
  assert.notEqual(zero.status, 2, zero.stdout + zero.stderr);
  assert.doesNotMatch(zero.stderr, /--port requires/u, zero.stderr);

  const negative = runCli(root, "preview", "--port", "-1");
  assert.equal(negative.status, 2, negative.stdout + negative.stderr);
  assert.match(negative.stderr, /velar preview: --port requires an integer from 0 to 65535, where 0 is any free port\n/u, negative.stderr);

  const help = runCli(root, "preview", "--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /velar preview \[project-directory \| build-directory\] \[--port <0-65535>\]/u, help.stdout);
});
