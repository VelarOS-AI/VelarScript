import assert from "node:assert/strict";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveVelarProject } from "../../packages/cli/src/config.ts";
import { resolveBrowserNpm } from "../../packages/cli/src/npm.ts";
import { checkResolvedProject } from "../../packages/cli/src/project-check.ts";
import { buildProductionFramework } from "../../packages/cli/src/production-build.ts";
import { standardModuleRoute } from "../../packages/cli/src/standard-modules.ts";
import {
  createFrozenCompilerRuntimeLibrary,
  frozenRuntimePackageName,
  linkFrozenCompilerRuntimeLibrary,
  runCli,
} from "../support/frozen-artifact.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

const webPackageRoot = fileURLToPath(new URL("../../packages/web", import.meta.url));

test("Web dev and production route frozen compiler runtimes through Standard modules", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-runtime-browser-");
  const library = await createFrozenCompilerRuntimeLibrary(root);
  const projectRoot = join(root, "web-app");
  const created = runCli(["create", projectRoot, "--template", "web"], root);
  assert.equal(created.status, 0, `${created.stdout}${created.stderr}`);
  await linkFrozenCompilerRuntimeLibrary(projectRoot, library);
  const extensionScope = join(projectRoot, "node_modules", "@velarscript");
  await mkdir(extensionScope, { recursive: true });
  await symlink(webPackageRoot, join(extensionScope, "web"), "dir");
  await writeFile(join(projectRoot, "src", "app.vel"), [
    `import {artifactLabel} from "${frozenRuntimePackageName}"`,
    "export const appName = artifactLabel()",
    'export const frameworkPosition = "JavaScript ecosystem"',
    "export component App:",
    "    return <main><h1>{appName}</h1></main>",
    "",
  ].join("\n"), "utf8");

  const config = await resolveVelarProject(projectRoot);
  const checked = await checkResolvedProject(config, config.entryPath);
  assert.deepEqual(checked.errors, []);
  const development = await resolveBrowserNpm(checked.project);
  assert.deepEqual(development.failures, []);
  assert.equal(development.imports["velar/hash"], standardModuleRoute("velar/hash"));
  assert.match(development.imports[frozenRuntimePackageName] ?? "", /\/@npm\/@fixture\/compiler-runtime-artifact\//u);
  assert.equal(development.packages.some((package_) => package_.name === "velar"), false);

  const output = join(root, "browser-release");
  const production = await buildProductionFramework(checked.project, output, "readable", false);
  assert.match(production.entryPath, /^assets\//u);
  const javascript = (await readdir(join(output, "assets")))
    .filter((path) => path.endsWith(".js"))
    .map(async (path) => readFile(join(output, "assets", path), "utf8"));
  const emitted = (await Promise.all(javascript)).join("\n");
  assert.match(emitted, /artifact-runtime/u);
  assert.doesNotMatch(emitted, /from\s*["']velar\/hash["']/u);
});
