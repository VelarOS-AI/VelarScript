import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  installedPackageTreeClosure,
  MAX_INSTALLED_PACKAGE_CLOSURE,
  MAX_INSTALLED_PACKAGE_DEPENDENCIES,
} from "../../packages/cli/src/installed-package-closure.ts";

test("an installed package manifest has a bounded dependency roster", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-package-roster-bound-"));
  const manifestPath = join(root, "package.json");
  try {
    const dependencies = Object.fromEntries(Array.from(
      { length: MAX_INSTALLED_PACKAGE_DEPENDENCIES + 1 },
      (_, index) => [`dependency-${index}`, "1.0.0"],
    ));
    await writePackageManifest(manifestPath, "root-package", dependencies);
    await assert.rejects(
      installedPackageTreeClosure([{ manifestPath, label: "fixture" }]),
      new RegExp(`cannot declare more than ${MAX_INSTALLED_PACKAGE_DEPENDENCIES} dependencies`, "u"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the installed toolchain dependency closure has a total package bound", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-package-closure-bound-"));
  const manifestPath = join(root, "package.json");
  try {
    const names = Array.from({ length: MAX_INSTALLED_PACKAGE_CLOSURE }, (_, index) => `package-${index + 1}`);
    const firstLayer = names.slice(0, MAX_INSTALLED_PACKAGE_DEPENDENCIES);
    const secondLayer = names.slice(MAX_INSTALLED_PACKAGE_DEPENDENCIES);
    await writePackageManifest(manifestPath, "root-package", ranges(firstLayer));
    await Promise.all(names.map(async (name, index) => {
      const dependencies = index < 3
        ? ranges(secondLayer.slice(
            index * MAX_INSTALLED_PACKAGE_DEPENDENCIES,
            (index + 1) * MAX_INSTALLED_PACKAGE_DEPENDENCIES,
          ))
        : {};
      await writePackageManifest(join(root, "node_modules", name, "package.json"), name, dependencies);
    }));

    await assert.rejects(
      installedPackageTreeClosure([{ manifestPath, label: "fixture" }]),
      new RegExp(`cannot exceed ${MAX_INSTALLED_PACKAGE_CLOSURE} installed packages`, "u"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function ranges(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, "1.0.0"]));
}

async function writePackageManifest(
  path: string,
  name: string,
  dependencies: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ name, version: "1.0.0", dependencies })}\n`, "utf8");
}
