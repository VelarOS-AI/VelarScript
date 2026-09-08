import { lstat, opendir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CommandArguments } from "./arguments.ts";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import type { VelarProjectConfig } from "./config.ts";
import { isHostErrorCode } from "./host-error.ts";
import { readVelarLibraryPackageManifestSource } from "./library-artifact-build.ts";
import { VELAR_LIBRARY_ARTIFACT_LIMITS } from "./library-artifact-snapshot.ts";
import { readOrdinaryFileSnapshot } from "./ordinary-file-snapshot.ts";
import { isExplicitProjectSourceInput } from "./project-source-package.ts";

/** A source library's execution target is independent of its frozen artifact declaration. */
export async function declaresVelarLibraryArtifacts(config: VelarProjectConfig): Promise<boolean> {
  if (config.kind !== "library") return false;
  const path = join(config.root, "package.json");
  let source: string;
  try {
    source = await readVelarLibraryPackageManifestSource(path);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) {
      // A source library need not publish an npm contract. A dangling symlink
      // is a present but unreadable contract and must still fail closed.
      try {
        await lstat(path);
      } catch (inspectionError) {
        if (isHostErrorCode(inspectionError, "ENOENT")) return false;
        throw inspectionError;
      }
    }
    throw error;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new Error(`${path} is not valid JSON; cannot determine library output ownership`);
  }
  const object = plainRecord(manifest);
  if (object === null) throw new Error(`${path} must contain an object; cannot determine library output ownership`);
  const declaration = plainRecord(object.velar);
  if (object.velar !== undefined && declaration === null) {
    throw new Error(`${path}#velar must contain an object; cannot determine library output ownership`);
  }
  return declaration !== null && Object.hasOwn(declaration, "artifacts");
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Output ownership, independent of the source package's execution target. */
export async function libraryBuildRefusal(config: VelarProjectConfig, parsed: CommandArguments): Promise<string | null> {
  if (config.kind !== "library") return null;
  const declared = await declaresVelarLibraryArtifacts(config);
  const directories = new Set([resolve(config.outDir)]);
  if (parsed.outputDirectory) directories.add(resolve(parsed.outputDirectory));
  const protectedDirectories: string[] = [];
  for (const directory of directories) {
    if ((declared && directory === resolve(config.outDir)) || await containsLibraryReceipt(directory)) {
      protectedDirectories.push(directory);
    }
  }
  if (protectedDirectories.length === 0) return null;
  if (parsed.output && isExplicitProjectSourceInput(config)) {
    const output = resolve(parsed.output);
    const canonicalOutput = await canonicalizePotentialPath(output);
    let outside = true;
    for (const directory of protectedDirectories) {
      if (inside(directory, output) || inside(await canonicalizePotentialPath(directory), canonicalOutput)) outside = false;
    }
    if (outside) return null;
  }
  return `Library output ${protectedDirectories.join(", ")} is reserved for a frozen artifact set; use 'velar build-library' to write that frozen ABI-1 artifact set`;
}

function inside(directory: string, path: string): boolean {
  const value = relative(directory, path);
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

/** Receipts live directly under outDir, including package-declared custom names. */
async function containsLibraryReceipt(directory: string): Promise<boolean> {
  let entries: Awaited<ReturnType<typeof opendir>>;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) return false;
    throw error;
  }
  let count = 0;
  let bytesRead = 0;
  for await (const entry of entries) {
    if (++count > 4096) throw new RangeError(`${directory} exceeds the 4096-entry library ownership inspection budget`);
    if (entry.name === "velar-library.json") return true;
    if (!entry.name.endsWith(".json") || entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    const { bytes } = await readOrdinaryFileSnapshot(path, VELAR_LIBRARY_ARTIFACT_LIMITS.receiptBytes, path);
    bytesRead += bytes.byteLength;
    if (bytesRead > VELAR_LIBRARY_ARTIFACT_LIMITS.fileBytes) {
      throw new RangeError(`${directory} exceeds the library ownership inspection byte budget`);
    }
    let receipt: unknown;
    try {
      receipt = JSON.parse(bytes.toString("utf8"));
    } catch {
      // A corrupt receipt still owns its directory. Unrelated JSON assets do not.
      if (/"kind"\s*:\s*"velar-library-artifact"/u.test(bytes.toString("utf8"))) return true;
      continue;
    }
    if (receipt !== null && typeof receipt === "object"
      && Reflect.get(receipt, "kind") === "velar-library-artifact") return true;
  }
  return false;
}
