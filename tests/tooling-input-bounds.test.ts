import assert from "node:assert/strict";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { inspectJavaScriptModule } from "@velarscript/compiler";
import {
  createJavaScriptModuleGraphBudget,
  inspectJavaScriptModuleWithinBudget,
} from "../packages/cli/src/javascript-module-budget.ts";
import {
  MAX_PACKAGE_IMPORT_COPY_DEPTH,
  MAX_PACKAGE_IMPORT_COPY_FILE_BYTES,
  MAX_PACKAGE_IMPORT_COPY_FILES,
  MAX_PACKAGE_IMPORT_TARGETS,
  packageImportTargets,
} from "../packages/cli/src/package-import-sandbox.ts";
import { resolvePackageImportsSpecifier } from "../packages/cli/src/package-imports.ts";
import { parseDependencyArguments, runDependencyCommand } from "../packages/cli/src/package-manager.ts";
import { createCompiledSandbox, removeCompiledSandbox } from "../packages/cli/src/test-output.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const oneMiB = 1024 * 1024;

function updateArguments() {
  const parsed = parseDependencyArguments("update", []);
  assert.notEqual(typeof parsed, "string");
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
}

async function writePackageProject(root: string): Promise<string> {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "bounded-tooling-project",
    private: true,
    type: "module",
  }), "utf8");
  const source = `${JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    extensions: [],
  }, null, 2)}\n`;
  await writeFile(join(root, "velar.json"), source, "utf8");
  await writeFile(join(root, "src", "main.vel"), "const ready = true\n", "utf8");
  return source;
}

async function writeCompilerExtension(root: string, name: string, parserBody = "return value ?? Object.freeze({})"): Promise<void> {
  const extensionRoot = join(root, "node_modules", name);
  await mkdir(extensionRoot, { recursive: true });
  await writeFile(join(extensionRoot, "package.json"), JSON.stringify({
    name,
    version: "1.0.0",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { kind: "language", apiVersion: "1.0", manifestKey: "bounded" } },
  }), "utf8");
  await writeFile(join(extensionRoot, "compiler.js"), [
    `export const velarCompilerExtension = Object.freeze({id: ${JSON.stringify(name)}, contract: Object.freeze({protocolVersion: 1, apiVersion: "1.0", kind: "language", extends: Object.freeze({})})})`,
    `export const velarProjectExtension = Object.freeze({id: ${JSON.stringify(name)}, manifestKey: "bounded", parse(value) { ${parserBody} }})`,
    "",
  ].join("\n"), "utf8");
}

function dependencyArguments(action: "add" | "remove", name: string) {
  const parsed = parseDependencyArguments(action, [name]);
  assert.notEqual(typeof parsed, "string");
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
}

async function transactionDirectories(root: string): Promise<readonly string[]> {
  return (await readdir(root)).filter((name) => name.startsWith(".velar-manifest-transaction-"));
}

test("dependency commands bound both project manifests before npm runs", async () => {
  for (const manifestName of ["velar.json", "package.json"] as const) {
    const root = await makeTemporaryDirectory(`velar-package-command-${manifestName}-`);
    await writePackageProject(root);
    const manifestPath = join(root, manifestName);
    await truncate(manifestPath, oneMiB + 1);
    let npmCalled = false;
    await assert.rejects(
      runDependencyCommand("update", updateArguments(), {
        cwd: root,
        executeNpm: async () => { npmCalled = true; },
      }),
      /(?:VelarScript project|package) manifest exceeds 1 MiB/u,
    );
    assert.equal(npmCalled, false);
    assert.equal((await lstat(manifestPath)).size, oneMiB + 1);
  }
});

test("dependency activation refuses a same-content project-manifest path replacement", async () => {
  const root = await makeTemporaryDirectory("velar-package-command-swap-");
  const original = await writePackageProject(root);
  await writeCompilerExtension(root, "bounded-extension");
  const parsed = dependencyArguments("add", "bounded-extension");
  const manifestPath = join(root, "velar.json");
  const displaced = join(root, "displaced-velar.json");
  await assert.rejects(
    runDependencyCommand("add", parsed, {
      cwd: root,
      executeNpm: async () => {
        await rename(manifestPath, displaced);
        await writeFile(manifestPath, original, "utf8");
      },
    }),
    /project declaration changed while npm was running and was not overwritten/u,
  );
  assert.equal(await readFile(displaced, "utf8"), original);
  assert.equal(await readFile(manifestPath, "utf8"), original);
  assert.deepEqual((await readdir(root)).filter((name) => name.startsWith(".velar-") && name.endsWith(".json")), []);
});

test("dependency activation cannot overwrite an editor save in the final replacement window", async () => {
  const root = await makeTemporaryDirectory("velar-package-command-final-swap-");
  const original = await writePackageProject(root);
  await writeCompilerExtension(root, "bounded-extension");
  const parsed = dependencyArguments("add", "bounded-extension");
  const manifestPath = join(root, "velar.json");
  const displacedOriginal = join(root, "editor-displaced-original.json");
  const edited = `${JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    extensions: [],
    editorValue: "must survive",
  }, null, 2)}\n`;
  let swapped = false;
  await assert.rejects(
    runDependencyCommand("add", parsed, {
      cwd: root,
      executeNpm: async () => undefined,
      manifestReplacement: {
        beforeCurrentMove: async () => {
          if (swapped) return;
          swapped = true;
          const editorTemporary = join(root, ".editor-velar.json");
          await writeFile(editorTemporary, edited, "utf8");
          await rename(manifestPath, displacedOriginal);
          await rename(editorTemporary, manifestPath);
        },
      },
    }),
    /project declaration changed while npm was running and was not overwritten/u,
  );
  assert.equal(await readFile(manifestPath, "utf8"), edited);
  assert.equal(await readFile(displacedOriginal, "utf8"), original);
  assert.deepEqual(await transactionDirectories(root), []);
});

test("dependency manifest transactions commit, roll back, and preserve recovery evidence", async () => {
  const root = await makeTemporaryDirectory("velar-package-command-transaction-");
  const original = await writePackageProject(root);
  await writeCompilerExtension(root, "transaction-extension");
  await runDependencyCommand("add", dependencyArguments("add", "transaction-extension"), {
    cwd: root,
    executeNpm: async () => undefined,
  });
  const activated = await readFile(join(root, "velar.json"), "utf8");
  assert.deepEqual((JSON.parse(activated) as { extensions: string[] }).extensions, ["transaction-extension"]);
  assert.deepEqual(await transactionDirectories(root), []);

  await assert.rejects(
    runDependencyCommand("remove", dependencyArguments("remove", "transaction-extension"), {
      cwd: root,
      executeNpm: async () => { throw new Error("npm refused transaction"); },
    }),
    /npm refused transaction/u,
  );
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), activated);
  assert.deepEqual(await transactionDirectories(root), []);

  await runDependencyCommand("remove", dependencyArguments("remove", "transaction-extension"), {
    cwd: root,
    executeNpm: async () => undefined,
  });
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), original);
  assert.deepEqual(await transactionDirectories(root), []);

  const invalidRoot = await makeTemporaryDirectory("velar-package-command-invalid-transaction-");
  const invalidOriginal = await writePackageProject(invalidRoot);
  await writeCompilerExtension(invalidRoot, "invalid-transaction-extension", 'throw new Error("invalid transaction extension")');
  await assert.rejects(
    runDependencyCommand("add", dependencyArguments("add", "invalid-transaction-extension"), {
      cwd: invalidRoot,
      executeNpm: async () => undefined,
    }),
    /installed but could not be activated.*invalid transaction extension/u,
  );
  assert.equal(await readFile(join(invalidRoot, "velar.json"), "utf8"), invalidOriginal);
  assert.deepEqual(await transactionDirectories(invalidRoot), []);

  const cleanupRoot = await makeTemporaryDirectory("velar-package-command-cleanup-transaction-");
  const cleanupOriginal = await writePackageProject(cleanupRoot);
  await writeCompilerExtension(cleanupRoot, "cleanup-transaction-extension");
  await assert.rejects(
    runDependencyCommand("add", dependencyArguments("add", "cleanup-transaction-extension"), {
      cwd: cleanupRoot,
      executeNpm: async () => undefined,
      manifestReplacement: {
        afterCurrentMove: async () => { throw new Error("injected install failure"); },
        beforeTransactionCleanup: async () => { throw new Error("injected cleanup failure"); },
      },
    }),
    /installed but its project declaration changed/u,
  );
  const cleanupManifest = join(cleanupRoot, "velar.json");
  assert.equal(await readFile(cleanupManifest, "utf8"), cleanupOriginal);
  assert.equal((await lstat(cleanupManifest)).nlink, 1);
  const cleanupTransactions = await transactionDirectories(cleanupRoot);
  assert.equal(cleanupTransactions.length, 1);
  const cleanupTransaction = join(cleanupRoot, cleanupTransactions[0]!);
  const cleanupEntries = await readdir(cleanupTransaction);
  assert.equal(cleanupEntries.some((name) => name.endsWith(".previous.json")), false);
  const recovery = cleanupEntries.find((name) => name.endsWith(".recovery.json"));
  assert.ok(recovery);
  await writeFile(join(cleanupTransaction, recovery), "changed recovery evidence\n", "utf8");
  assert.equal(await readFile(cleanupManifest, "utf8"), cleanupOriginal);

  const evidenceRoot = await makeTemporaryDirectory("velar-package-command-evidence-");
  const evidenceOriginal = await writePackageProject(evidenceRoot);
  await writeCompilerExtension(evidenceRoot, "evidence-extension");
  const competing = `${JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    extensions: [],
    editorValue: "exclusive path owner",
  }, null, 2)}\n`;
  let failure: unknown;
  try {
    await runDependencyCommand("add", dependencyArguments("add", "evidence-extension"), {
      cwd: evidenceRoot,
      executeNpm: async () => undefined,
      manifestReplacement: {
        afterCurrentMove: async (path) => { await writeFile(path, competing, { encoding: "utf8", flag: "wx" }); },
      },
    });
  } catch (error) {
    failure = error;
  }
  assert.match(String(failure), /displaced project declaration was preserved at/u);
  assert.equal(await readFile(join(evidenceRoot, "velar.json"), "utf8"), competing);
  const transactions = await transactionDirectories(evidenceRoot);
  assert.equal(transactions.length, 1);
  const transactionRoot = join(evidenceRoot, transactions[0]!);
  const previous = (await readdir(transactionRoot)).find((name) => name.endsWith(".previous.json"));
  assert.ok(previous);
  assert.equal(await readFile(join(transactionRoot, previous), "utf8"), evidenceOriginal);
});

test("sandbox imports keep valid relative target graphs working", async () => {
  const root = await makeTemporaryDirectory("velar-sandbox-import-valid-");
  await mkdir(join(root, "src", "vendor"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "sandbox-import-valid",
    private: true,
    type: "module",
    imports: { "#feature": { node: "./src/vendor/feature.mjs" } },
  }), "utf8");
  await writeFile(
    join(root, "src", "vendor", "feature.mjs"),
    'export {label} from "./lab\\u0065l.mjs?variant=ready#module"\n',
    "utf8",
  );
  await writeFile(join(root, "src", "vendor", "label.mjs"), 'export const label = "ready"\n', "utf8");
  const sandbox = await createCompiledSandbox(root, "run");
  try {
    assert.match(await readFile(join(sandbox, "package.json"), "utf8"), /#feature/u);
    assert.match(await readFile(join(sandbox, "src", "vendor", "feature.mjs"), "utf8"), /lab\\u0065l\.mjs\?variant/u);
    assert.match(await readFile(join(sandbox, "src", "vendor", "label.mjs"), "utf8"), /ready/u);
    const entry = pathToFileURL(join(sandbox, "src", "vendor", "feature.mjs"));
    entry.searchParams.set("test", `${Date.now()}`);
    assert.equal((await import(entry.href)).label, "ready");
  } finally {
    await removeCompiledSandbox(sandbox);
  }
});

test("sandbox imports bound manifest bytes, value shape, candidate files, and file bytes", async () => {
  const oversizedRoot = await makeTemporaryDirectory("velar-sandbox-import-manifest-");
  await writeFile(join(oversizedRoot, "package.json"), "author package\n", "utf8");
  await truncate(join(oversizedRoot, "package.json"), oneMiB + 1);
  await assert.rejects(createCompiledSandbox(oversizedRoot, "test"), /Project package manifest .* exceeds 1 MiB/u);
  assert.equal((await lstat(join(oversizedRoot, "package.json"))).size, oneMiB + 1);

  let nested: unknown = "./target.mjs";
  for (let depth = 0; depth <= 64; depth += 1) nested = { default: nested };
  assert.throws(() => packageImportTargets({ "#deep": nested }), /targets exceed 64 levels/u);
  assert.throws(
    () => packageImportTargets(Array.from({ length: MAX_PACKAGE_IMPORT_TARGETS + 1 }, (_, index) => `target-${index}`)),
    /cannot name more than 8192 targets/u,
  );

  const candidatesRoot = await makeTemporaryDirectory("velar-sandbox-import-files-");
  await writeFile(join(candidatesRoot, "package.json"), JSON.stringify({
    imports: Object.fromEntries(Array.from(
      { length: MAX_PACKAGE_IMPORT_COPY_FILES + 1 },
      (_, index) => [`#target-${index}`, `./targets/${index}.mjs`],
    )),
  }), "utf8");
  await assert.rejects(createCompiledSandbox(candidatesRoot, "test"), /file graph exceeds 4096 files/u);

  const fileRoot = await makeTemporaryDirectory("velar-sandbox-import-file-bytes-");
  await mkdir(join(fileRoot, "src"));
  await writeFile(join(fileRoot, "package.json"), JSON.stringify({ imports: { "#large": "./src/large.mjs" } }), "utf8");
  await writeFile(join(fileRoot, "src", "large.mjs"), "author module\n", "utf8");
  await truncate(join(fileRoot, "src", "large.mjs"), MAX_PACKAGE_IMPORT_COPY_FILE_BYTES + 1);
  await assert.rejects(createCompiledSandbox(fileRoot, "test"), /target .* exceeds 16777216 bytes/u);
  assert.equal((await lstat(join(fileRoot, "src", "large.mjs"))).size, MAX_PACKAGE_IMPORT_COPY_FILE_BYTES + 1);

  const syntaxRoot = await makeTemporaryDirectory("velar-sandbox-import-syntax-");
  await mkdir(join(syntaxRoot, "src"));
  await writeFile(join(syntaxRoot, "package.json"), JSON.stringify({ imports: { "#invalid": "./src/invalid.mjs" } }), "utf8");
  await writeFile(join(syntaxRoot, "src", "invalid.mjs"), "export const = 1\n", "utf8");
  await assert.rejects(createCompiledSandbox(syntaxRoot, "test"), /is not a valid ECMAScript module/u);
  await assert.rejects(access(join(syntaxRoot, ".velar")), /ENOENT/u);
});

test("JavaScript module graph budgets charge tokens across module boundaries", () => {
  const source = "first;";
  const probe = inspectJavaScriptModule(source);
  const budget = createJavaScriptModuleGraphBudget();
  budget.remainingSyntaxNodes = probe.syntaxNodes * 2;
  budget.remainingTokens = probe.tokens;
  const inspected = inspectJavaScriptModuleWithinBudget(source, budget);
  assert.equal(inspected.tokens, probe.tokens);
  assert.equal(budget.remainingTokens, 0);
  assert.throws(
    () => inspectJavaScriptModuleWithinBudget("second;", budget),
    /JavaScript module graph exceeds its parse complexity budget/u,
  );
});

test("sandbox imports bound transitive graph depth and reject canonical escapes", async () => {
  const depthRoot = await makeTemporaryDirectory("velar-sandbox-import-depth-");
  await mkdir(join(depthRoot, "graph"));
  await writeFile(join(depthRoot, "package.json"), JSON.stringify({ imports: { "#deep": "./graph/0.mjs" } }), "utf8");
  for (let depth = 0; depth <= MAX_PACKAGE_IMPORT_COPY_DEPTH; depth += 1) {
    await writeFile(
      join(depthRoot, "graph", `${depth}.mjs`),
      `import "./${depth + 1}.mjs"\nexport const depth = ${depth}\n`,
      "utf8",
    );
  }
  await assert.rejects(createCompiledSandbox(depthRoot, "run"), /file graph exceeds 64 levels/u);

  const outside = await makeTemporaryDirectory("velar-sandbox-import-outside-");
  const escapeRoot = await makeTemporaryDirectory("velar-sandbox-import-escape-");
  await mkdir(join(escapeRoot, "src"));
  await writeFile(join(outside, "feature.mjs"), "export const escaped = true\n", "utf8");
  await symlink(outside, join(escapeRoot, "src", "vendor"), "dir");
  await writeFile(join(escapeRoot, "package.json"), JSON.stringify({
    imports: { "#escape": "./src/vendor/feature.mjs" },
  }), "utf8");
  const sandbox = await createCompiledSandbox(escapeRoot, "run");
  try {
    await assert.rejects(access(join(sandbox, "src", "vendor", "feature.mjs")), /ENOENT/u);
  } finally {
    await removeCompiledSandbox(sandbox);
  }
});

test("package-import owner manifests are bounded ordinary snapshots", async () => {
  const oversizedRoot = await makeTemporaryDirectory("velar-import-owner-large-");
  await mkdir(join(oversizedRoot, "src"));
  await writeFile(join(oversizedRoot, "package.json"), "author package\n", "utf8");
  await truncate(join(oversizedRoot, "package.json"), oneMiB + 1);
  await assert.rejects(
    resolvePackageImportsSpecifier("#feature", join(oversizedRoot, "src"), "node"),
    /owner manifest .* exceeds 1048576 bytes/u,
  );

  const shadowRoot = await makeTemporaryDirectory("velar-import-owner-shadow-");
  const child = join(shadowRoot, "child");
  await mkdir(join(child, "src"), { recursive: true });
  await writeFile(join(shadowRoot, "package.json"), JSON.stringify({ imports: { "#feature": "node:fs" } }), "utf8");
  await mkdir(join(child, "package.json"));
  await assert.rejects(
    resolvePackageImportsSpecifier("#feature", join(child, "src"), "node"),
    /owner manifest is not an ordinary file/u,
  );
});
