import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { VELAR_PROJECT_FORMAT_VERSION } from "../../packages/create/src/types.ts";
import type { BuildOutputCommitAuthorization } from "../../packages/cli/src/build-output-commit.ts";
import {
  commitBuildOutputDirectory,
  prepareClaimedBuildStaging,
  reserveBuildStaging,
  validateBuildOutputTarget,
  writeBuildOutputReceipt,
  type PreparedBuildStaging,
} from "../../packages/cli/src/build-output-directory.ts";
import {
  writeNodeProductionManifest,
} from "../../packages/cli/src/node-production-build.ts";
import {
  checkVelarLibraryEntries,
  resolveVelarLibraryBuild,
  writeVelarLibraryArtifact,
} from "../../packages/cli/src/library-artifact-build.ts";
import { verifyVelarLibraryBuildForCommit } from "../../packages/cli/src/library-artifact-verifier.ts";
import { resolveVelarProject } from "../../packages/cli/src/config.ts";
import { verifyNodeProductionBuildForCommit } from "../../packages/cli/src/node-production-verifier.ts";
import {
  writeProductionManifest,
  type ProductionBuildResult,
  type ProductionFrameworkIdentity,
} from "../../packages/cli/src/production-build.ts";
import { verifyProductionBuildForCommit } from "../../packages/cli/src/production-verifier.ts";
import { writeStaticDeployment } from "../../packages/cli/src/static-deployment.ts";

interface CommitFixture {
  readonly authorization: BuildOutputCommitAuthorization;
  readonly mutationPath: string;
}

async function prepareOutput(root: string, name: string): Promise<PreparedBuildStaging> {
  return prepareOutputPath(join(root, name));
}

async function prepareOutputPath(output: string): Promise<PreparedBuildStaging> {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "old.txt"), "old output\n", "utf8");
  const reserved = await reserveBuildStaging(output);
  return prepareClaimedBuildStaging(
    reserved,
    await validateBuildOutputTarget(output, async () => {}),
  );
}

async function libraryFixture(root: string): Promise<{
  readonly staging: PreparedBuildStaging;
  readonly fixture: CommitFixture;
}> {
  const packageRoot = join(root, "library");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: "commit-authorization-library",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(packageRoot, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(
    join(packageRoot, "src", "index.vel"),
    'export def value() -> string: return "verified"\n',
    "utf8",
  );
  const library = await resolveVelarLibraryBuild(await resolveVelarProject(packageRoot));
  const checked = await checkVelarLibraryEntries(library, packageRoot);
  assert.equal(checked.failed, false, checked.output);
  const staging = await prepareOutputPath(library.outputRoot);
  await writeVelarLibraryArtifact(library, checked.projects, staging.directory, "readable");
  const mutationPath = join(staging.directory, "index.js");
  return {
    staging,
    fixture: {
      authorization: await verifyVelarLibraryBuildForCommit(library, staging.directory),
      mutationPath,
    },
  };
}

async function genericFixture(staging: PreparedBuildStaging): Promise<CommitFixture> {
  const mutationPath = join(staging.directory, "main.js");
  await writeFile(mutationPath, "generic output\n", "utf8");
  return {
    authorization: await writeBuildOutputReceipt(staging.directory, staging.outputDirectory),
    mutationPath,
  };
}

async function nodeFixture(staging: PreparedBuildStaging): Promise<CommitFixture> {
  const mutationPath = join(staging.directory, "main.js");
  await writeFile(mutationPath, "node output\n", "utf8");
  await writeNodeProductionManifest(staging.directory, {
    mode: "readable",
    entry: "main.js",
    configuration: null,
    sourceMaps: false,
  });
  return {
    authorization: await verifyNodeProductionBuildForCommit(staging.directory, process.cwd(), {
      allowBuildStagingMarker: true,
    }),
    mutationPath,
  };
}

async function frameworkFixture(staging: PreparedBuildStaging): Promise<CommitFixture> {
  const framework: ProductionFrameworkIdentity = {
    id: "fixture-framework",
    capability: "web",
    target: "browser",
    protocolVersion: 1,
    apiVersion: "1.0",
    artifactKind: "site",
  };
  const html = "<!doctype html><title>fixture</title>\n";
  const mutationPath = join(staging.directory, "assets", "main.js");
  await mkdir(join(staging.directory, "assets"), { recursive: true });
  await writeFile(join(staging.directory, "index.html"), html, "utf8");
  await writeFile(mutationPath, "framework output\n", "utf8");
  const deployment = await writeStaticDeployment(staging.directory, html, {
    base: "/",
    spaFallback: false,
    contentSecurityPolicy: null,
  }, framework);
  const build: ProductionBuildResult = {
    framework,
    entryPath: "assets/main.js",
    stylesheetPath: null,
    modules: { total: 1, application: 1, packages: [] },
    dependencies: { velar: [], javascript: [] },
    inputPaths: [],
    sourceMaps: false,
    mode: "readable",
  };
  await writeProductionManifest(staging.directory, build, deployment);
  return {
    authorization: await verifyProductionBuildForCommit(staging.directory, process.cwd(), {
      allowBuildStagingMarker: true,
    }),
    mutationPath,
  };
}

test("generic, framework, and Node commits reject a staging tree changed after verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-build-commit-authorization-"));
  const fixtures = [genericFixture, frameworkFixture, nodeFixture] as const;
  try {
    for (const [index, createFixture] of fixtures.entries()) {
      const staging = await prepareOutput(root, `dist-${index}`);
      const fixture = await createFixture(staging);
      await assert.rejects(commitBuildOutputDirectory(staging, fixture.authorization, {
        beforeStagingCommitValidation: async () => {
          await writeFile(fixture.mutationPath, "changed after verification\n", "utf8");
        },
      }), /changed physical identity or contents/u);
      assert.equal(await readFile(join(staging.outputDirectory, "old.txt"), "utf8"), "old output\n");
      await assert.rejects(lstat(fixture.mutationPath), (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generic, framework, and Node commits install an unchanged authenticated tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-build-commit-success-"));
  const fixtures = [genericFixture, frameworkFixture, nodeFixture] as const;
  try {
    for (const [index, createFixture] of fixtures.entries()) {
      const staging = await prepareOutput(root, `dist-${index}`);
      const fixture = await createFixture(staging);
      const installedMutationPath = join(
        staging.outputDirectory,
        relative(staging.directory, fixture.mutationPath),
      );
      await commitBuildOutputDirectory(staging, fixture.authorization);
      assert.notEqual(await readFile(installedMutationPath, "utf8"), "");
      await assert.rejects(lstat(join(staging.outputDirectory, "old.txt")), (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the final staging revalidation restores an old output changed after its first rename", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-build-commit-final-validation-"));
  try {
    const staging = await prepareOutput(root, "dist");
    const fixture = await genericFixture(staging);
    await assert.rejects(commitBuildOutputDirectory(staging, fixture.authorization, {
      afterFirstRename: async () => {
        await writeFile(fixture.mutationPath, "changed at final commit boundary\n", "utf8");
      },
    }), /changed physical identity or contents/u);
    assert.equal(await readFile(join(staging.outputDirectory, "old.txt"), "utf8"), "old output\n");
    await assert.rejects(lstat(fixture.mutationPath), (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("library commit installs an unchanged authenticated frozen artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-library-commit-success-"));
  try {
    const { staging, fixture } = await libraryFixture(root);
    const installedPath = join(staging.outputDirectory, relative(staging.directory, fixture.mutationPath));
    await commitBuildOutputDirectory(staging, fixture.authorization);
    assert.match(await readFile(installedPath, "utf8"), /verified/u);
    await assert.rejects(lstat(join(staging.outputDirectory, "old.txt")), (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("library post-install validation catches a mutation inside the staging rename and restores the old output", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-build-commit-rename-race-"));
  try {
    const { staging, fixture } = await libraryFixture(root);
    let injected = false;
    await assert.rejects(commitBuildOutputDirectory(staging, fixture.authorization, {
      renamePath: async (source, destination) => {
        if (source === staging.directory && destination === staging.outputDirectory) {
          injected = true;
          await writeFile(fixture.mutationPath, "changed inside final rename\n", "utf8");
        }
        await rename(source, destination);
      },
    }), /changed physical identity or contents/u);
    assert.equal(injected, true);
    assert.equal(await readFile(join(staging.outputDirectory, "old.txt"), "utf8"), "old output\n");
    await assert.rejects(lstat(fixture.mutationPath), (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
