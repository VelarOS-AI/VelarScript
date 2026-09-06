import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  symlink,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES,
  readPackageOwnedJavaScriptSnapshot,
} from "../../packages/cli/src/javascript-dependency-target.ts";
import {
  authorizeArtifactFile,
  readAuthorizedArtifactBytes,
} from "../../packages/cli/src/library-artifact-snapshot.ts";
import { readOrdinaryFileSnapshot } from "../../packages/cli/src/ordinary-file-snapshot.ts";
import {
  MAX_PACKAGE_MANIFEST_BYTES,
  MAX_TYPESCRIPT_DECLARATION_BYTES,
} from "../../packages/cli/src/typescript-declaration-source.ts";
import { loadTypeScriptDeclarations } from "../../packages/cli/src/typescript-declarations.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

const PRESERVED_OUTPUT = "author output\n";

async function preserveOutput(root: string): Promise<string> {
  const output = join(root, "existing-output.txt");
  await writeFile(output, PRESERVED_OUTPUT, "utf8");
  return output;
}

async function assertOutputPreserved(output: string): Promise<void> {
  assert.equal(await readFile(output, "utf8"), PRESERVED_OUTPUT);
}

test("package-owned JavaScript snapshots reject oversize, replacement, and growth without touching output", async () => {
  const root = await makeTemporaryDirectory("velar-owned-js-snapshot-");
  const source = join(root, "module.mjs");
  const displaced = join(root, "module.original.mjs");
  const output = await preserveOutput(root);

  await writeFile(source, "export const value = 1;\n", "utf8");
  await truncate(source, MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES + 1);
  await assert.rejects(
    readPackageOwnedJavaScriptSnapshot(source, root),
    /exceeds 16777216 bytes/u,
  );
  assert.equal((await lstat(source)).size, MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES + 1);

  await writeFile(source, "export const original = 1;\n", "utf8");
  await assert.rejects(readPackageOwnedJavaScriptSnapshot(source, root, {
    afterPathInspection: async () => {
      await rename(source, displaced);
      await writeFile(source, "export const replacement = 2;\n", "utf8");
    },
  }), /changed physical identity or contents while it was read/u);
  assert.equal(await readFile(displaced, "utf8"), "export const original = 1;\n");
  assert.equal(await readFile(source, "utf8"), "export const replacement = 2;\n");

  await assert.rejects(readPackageOwnedJavaScriptSnapshot(source, root, {
    afterPathInspection: async () => truncate(source, MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES + 1),
  }), /changed physical identity or contents while it was read/u);
  assert.equal((await lstat(source)).size, MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES + 1);
  await assertOutputPreserved(output);
});

async function installDeclarationPackage(root: string): Promise<{
  readonly packageRoot: string;
  readonly manifest: string;
  readonly declaration: string;
  readonly importer: string;
}> {
  const packageRoot = join(root, "node_modules", "snapshot-types");
  const manifest = join(packageRoot, "package.json");
  const declaration = join(packageRoot, "index.d.ts");
  const importer = join(root, "main.vel");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(manifest, `${JSON.stringify({
    name: "snapshot-types",
    type: "module",
    exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
  })}\n`, "utf8");
  await writeFile(join(packageRoot, "index.js"), "export const value = 1;\n", "utf8");
  await writeFile(declaration, "export declare const value: number;\n", "utf8");
  await writeFile(importer, "", "utf8");
  return { packageRoot, manifest, declaration, importer };
}

test("TypeScript bridge manifests and declarations reject bounded snapshot races as unknown", async () => {
  const root = await makeTemporaryDirectory("velar-types-snapshot-");
  const fixture = await installDeclarationPackage(root);
  const output = await preserveOutput(root);

  await truncate(fixture.manifest, MAX_PACKAGE_MANIFEST_BYTES + 1);
  assert.equal(await loadTypeScriptDeclarations("snapshot-types", fixture.importer), null);
  assert.equal((await lstat(fixture.manifest)).size, MAX_PACKAGE_MANIFEST_BYTES + 1);
  await writeFile(fixture.manifest, Uint8Array.from([0xff, 0xfe, 0xfd]));
  assert.equal(await loadTypeScriptDeclarations("snapshot-types", fixture.importer), null);

  const restored = await installDeclarationPackage(root);
  const displaced = `${restored.declaration}.original`;
  const swapped = await loadTypeScriptDeclarations("snapshot-types", restored.importer, {
    afterPathInspection: async (path) => {
      if (!path.endsWith("/index.d.ts")) return;
      await rename(restored.declaration, displaced);
      await writeFile(restored.declaration, "export declare const replacement: string;\n", "utf8");
    },
  });
  assert.equal(swapped, null);
  assert.equal(await readFile(displaced, "utf8"), "export declare const value: number;\n");
  assert.equal(await readFile(restored.declaration, "utf8"), "export declare const replacement: string;\n");

  const grown = await loadTypeScriptDeclarations("snapshot-types", restored.importer, {
    afterPathInspection: async (path) => {
      if (path.endsWith("/index.d.ts")) await truncate(path, MAX_TYPESCRIPT_DECLARATION_BYTES + 1);
    },
  });
  assert.equal(grown, null);
  assert.equal((await lstat(restored.declaration)).size, MAX_TYPESCRIPT_DECLARATION_BYTES + 1);

  await writeFile(restored.declaration, Uint8Array.from([0xff, 0xfe, 0xfd]));
  assert.equal(await loadTypeScriptDeclarations("snapshot-types", restored.importer), null);
  await assertOutputPreserved(output);
});

test("TypeScript declaration graph budget counts stable bytes actually read", async () => {
  const root = await makeTemporaryDirectory("velar-types-aggregate-");
  const fixture = await installDeclarationPackage(root);
  const output = await preserveOutput(root);
  const child = join(fixture.packageRoot, "child.d.ts");
  const padding = " ".repeat(1024 * 1024 + 32);
  await writeFile(fixture.declaration, `export declare const root: string;\nexport * from "./child";\n${padding}`, "utf8");
  await writeFile(child, `export declare const child: string;\n${padding}`, "utf8");

  const bridge = await loadTypeScriptDeclarations("snapshot-types", fixture.importer);
  assert.ok(bridge);
  assert.equal(bridge.exports.get("root")?.kind, "string");
  assert.equal(bridge.exports.has("child"), false);
  assert.ok(bridge.warnings.some((warning) => /graph exceeds the 2 MiB aggregate limit/u.test(warning)));
  await assertOutputPreserved(output);
});

test("artifact reads reject same-inode symlink and FIFO replacements without blocking", {
  skip: process.platform === "win32",
  timeout: 5_000,
}, async () => {
  const root = await makeTemporaryDirectory("velar-artifact-special-file-");
  const rootIdentity = await realpath(root);
  const source = join(root, "artifact.js");
  const displaced = `${source}.original`;
  const output = await preserveOutput(root);
  await writeFile(source, "export const value = 1;\n", "utf8");

  let authorized = await authorizeArtifactFile(rootIdentity, source, 1024, "artifact");
  await rename(source, displaced);
  await symlink(displaced, source);
  await assert.rejects(readAuthorizedArtifactBytes(authorized), /ELOOP|symbolic link/u);

  const fifo = join(root, "fifo.js");
  const fifoOriginal = `${fifo}.original`;
  await writeFile(fifo, "export const fifo = 1;\n", "utf8");
  authorized = await authorizeArtifactFile(rootIdentity, fifo, 1024, "artifact FIFO");
  await rename(fifo, fifoOriginal);
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  let release: ReturnType<typeof setTimeout> | undefined;
  let writer: Promise<void> | undefined;
  const started = Date.now();
  try {
    release = setTimeout(() => {
      writer = writeFile(fifo, "release\n", "utf8").then(() => undefined, () => undefined);
    }, 1_000);
    await assert.rejects(readAuthorizedArtifactBytes(authorized), /changed after it was authorized/u);
    assert.ok(Date.now() - started < 750, "artifact FIFO must be rejected before a writer appears");
  } finally {
    if (release) clearTimeout(release);
    await writer;
  }
  assert.equal(await readFile(fifoOriginal, "utf8"), "export const fifo = 1;\n");
  await assertOutputPreserved(output);
});

test("artifact reads bind full metadata and bound growth before allocation", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-read-snapshot-");
  const source = join(root, "artifact.js");
  const displaced = join(root, "artifact.original.js");
  const output = await preserveOutput(root);
  const maximum = 64 * 1024;
  const rootIdentity = await realpath(root);

  await writeFile(source, "export const value = 1;\n", "utf8");
  await truncate(source, maximum + 1);
  await assert.rejects(authorizeArtifactFile(rootIdentity, source, maximum, "artifact"), /exceeds 65536 bytes/u);
  assert.equal((await lstat(source)).size, maximum + 1);

  await writeFile(source, "export const original = 1;\n", "utf8");
  let authorized = await authorizeArtifactFile(rootIdentity, source, maximum, "artifact");
  await rename(source, displaced);
  await writeFile(source, "export const replacement = 2;\n", "utf8");
  await assert.rejects(readAuthorizedArtifactBytes(authorized), /changed after it was authorized/u);
  assert.equal(await readFile(displaced, "utf8"), "export const original = 1;\n");

  authorized = await authorizeArtifactFile(rootIdentity, source, maximum, "artifact");
  const replacedDuringRead = `${source}.during-read`;
  await assert.rejects(readAuthorizedArtifactBytes(authorized, {
    afterDescriptorInspection: async () => {
      await rename(source, replacedDuringRead);
      await writeFile(source, "export const next = 3;\n", "utf8");
    },
  }), /changed while it was being read/u);
  assert.equal(await readFile(replacedDuringRead, "utf8"), "export const replacement = 2;\n");

  authorized = await authorizeArtifactFile(rootIdentity, source, maximum, "artifact");
  await utimes(source, new Date(1_000), new Date(2_000));
  await assert.rejects(readAuthorizedArtifactBytes(authorized), /changed after it was authorized/u);

  await truncate(source, maximum);
  authorized = await authorizeArtifactFile(rootIdentity, source, maximum, "artifact");
  await assert.rejects(readAuthorizedArtifactBytes(authorized, {
    afterDescriptorInspection: async () => truncate(source, maximum + 1),
  }), /exceeds 65536 bytes/u);
  assert.equal((await lstat(source)).size, maximum + 1);
  await assertOutputPreserved(output);
});

test("ordinary snapshots reject a FIFO replacement without waiting for a writer", {
  skip: process.platform === "win32",
  timeout: 5_000,
}, async () => {
  const root = await makeTemporaryDirectory("velar-ordinary-fifo-");
  const source = join(root, "manifest.json");
  const displaced = `${source}.original`;
  await writeFile(source, "{}\n", "utf8");
  let release: ReturnType<typeof setTimeout> | undefined;
  let writer: Promise<void> | undefined;
  const started = Date.now();
  try {
    await assert.rejects(readOrdinaryFileSnapshot(source, 1024, "manifest", {
      afterPathInspection: async () => {
        await rename(source, displaced);
        const created = spawnSync("mkfifo", [source], { encoding: "utf8" });
        assert.equal(created.status, 0, created.stderr);
        release = setTimeout(() => {
          writer = writeFile(source, "release\n", "utf8").then(() => undefined, () => undefined);
        }, 1_000);
      },
    }), /changed physical identity or contents while it was read/u);
    assert.ok(Date.now() - started < 750, "FIFO replacement must be rejected before a writer appears");
  } finally {
    if (release) clearTimeout(release);
    await writer;
  }
  assert.equal(await readFile(displaced, "utf8"), "{}\n");
  await assert.rejects(access(join(root, "dist")));
});
