import { lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { CURRENT_PROJECT_FORMAT_VERSION, resolveVelarProject } from "./config.ts";
import { VELAR_VERSION } from "./version.ts";
import { readBoundedText } from "./bounded-text.ts";

export interface UpgradeResult {
  readonly manifestPath: string;
  readonly changed: boolean;
}

export async function createVelarProject(input: string, cwd = process.cwd()): Promise<string> {
  const root = resolve(cwd, input);
  const existing = await pathState(root);
  if (existing !== "missing") {
    if (existing !== "directory") throw new Error(`'${input}' already exists and is not an ordinary directory`);
    const entries = await readdir(root);
    if (entries.length > 0) throw new Error(`'${input}' already exists and is not empty`);
  }
  const name = packageName(basename(root));
  await mkdir(dirname(root), { recursive: true });
  const staging = await mkdtemp(join(dirname(root), ".velar-create-"));
  try {
    await mkdir(join(staging, "src"), { recursive: true });
    await Promise.all([
    writeFile(join(staging, "velar.json"), `${JSON.stringify({
      formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
      entry: "src/main.vel",
      outDir: "dist",
      publicDir: "public",
      web: { title: basename(root), base: "/", publicConfig: {}, build: { sourceMaps: false } },
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
    writeFile(join(staging, "package.json"), `${JSON.stringify({
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        check: "velar check",
        format: "velar format",
        "format:check": "velar format --check",
        dev: "velar dev",
        test: "velar test",
        "test:browser": "velar test --browser",
        build: "velar build",
        verify: "velar verify",
        preview: "velar preview",
        "verify:deployment": "velar verify-deployment",
      },
      devDependencies: { "@velarscript/cli": `^${VELAR_VERSION.replace(/-.+$/u, "")}` },
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
    writeFile(join(staging, ".gitignore"), "node_modules/\ndist/\n", { encoding: "utf8", flag: "wx" }),
    writeFile(join(staging, "src", "app.vel"), `export const appName = "${escapeVelarString(basename(root))}"\n\nexport component App:\n    return <main class="app">\n        <h1>{appName}</h1>\n        <p>Built with VelarScript.</p>\n    </main>\n`, { encoding: "utf8", flag: "wx" }),
    writeFile(join(staging, "src", "main.vel"), `import {App} from "./app.vel"\n\nmount(<App />, "#app")\n`, { encoding: "utf8", flag: "wx" }),
    writeFile(join(staging, "src", "app.test.vel"), `import {expect} from "velar/test"\nimport {appName} from "./app.vel"\n\ndef test_application_name():\n    expect(appName).toBe("${escapeVelarString(basename(root))}")\n`, { encoding: "utf8", flag: "wx" }),
    writeFile(join(staging, "src", "app.browser.test.vel"), `import {browser, expect} from "velar/test"\n\nasync def test_home_page():\n    await browser.open("/")\n    expect(await browser.text("h1")).toBe("${escapeVelarString(basename(root))}")\n`, { encoding: "utf8", flag: "wx" }),
    ]);
    if (existing === "directory") await rmdir(root);
    await rename(staging, root);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (existing === "directory" && await pathState(root) === "missing") await mkdir(root);
    throw error;
  }
  return root;
}

export async function upgradeVelarProject(input: string | null, check: boolean, cwd = process.cwd()): Promise<UpgradeResult> {
  const config = await resolveVelarProject(input, cwd);
  if (!config.manifestPath) throw new Error("A single-file project has no velar.json to upgrade");
  if (!config.needsUpgrade) return { manifestPath: config.manifestPath, changed: false };
  const manifest = JSON.parse(await readBoundedText(config.manifestPath, 1024 * 1024, "Project manifest")) as Record<string, unknown>;
  if (!check) {
    await writeFile(config.manifestPath, `${JSON.stringify({ formatVersion: CURRENT_PROJECT_FORMAT_VERSION, ...manifest }, null, 2)}\n`, "utf8");
  }
  return { manifestPath: config.manifestPath, changed: true };
}

async function pathState(path: string): Promise<"missing" | "directory" | "other"> {
  try {
    const information = await lstat(path);
    return information.isDirectory() && !information.isSymbolicLink() ? "directory" : "other";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "missing";
    throw error;
  }
}

function packageName(value: string): string {
  const normalized = value.toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 214);
  if (!normalized || normalized === "node_modules" || normalized === "favicon.ico") return "velar-app";
  return normalized;
}

function escapeVelarString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r");
}
