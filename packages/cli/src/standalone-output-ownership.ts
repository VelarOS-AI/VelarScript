import { createHash } from "node:crypto";
import { lstat, open, opendir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { readBoundedFileHandle } from "./bounded-text.ts";
import { isHostErrorCode } from "./host-error.ts";
import { MAXIMUM_SERVER_CONFIGURATION_BYTES } from "./server-configuration-limits.ts";

export const STANDALONE_TRANSACTION_MARKER = ".velar-standalone-transaction.json";
export const STANDALONE_TRANSACTION_EVIDENCE_MARKER = ".velar-standalone-transaction-evidence.json";

const RECEIPT_MARKER = "// @velarscript/standalone-output-v2 ";
const EMBEDDED_OWNER_MARKER = "// @velarscript/standalone-embedded-owner-v1 ";
const CSS_OWNER_MARKER = "/* @velarscript/standalone-css-owner-v1 ";
const SOURCE_MAP_OWNER_FIELD = "x_velarStandaloneOwner";
export const MAX_STANDALONE_RECEIPT_BYTES = 4 * 1024 * 1024;
export const MAX_STANDALONE_RECEIPT_FILES = 8192;
export const MAX_STANDALONE_SOURCE_MAP_BYTES = 64 * 1024 * 1024;
const OWNER_MARKER_EDGE_BYTES = 64 * 1024;
const OWNER_SCAN_CHUNK_BYTES = 64 * 1024;

interface StandaloneReceiptV2 {
  readonly formatVersion: 2;
  readonly kind: "velar-standalone-build";
  readonly outputFile: string;
  readonly files: readonly string[];
  readonly configuration: StandaloneConfigurationIdentity | null;
}

export interface StandaloneConfigurationIdentity {
  readonly file: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface StandaloneOutputOwnership {
  readonly files: ReadonlySet<string>;
  readonly configuration: StandaloneConfigurationIdentity | null;
}

interface ConfigurationOutputOperation {
  readonly path: string;
  readonly kind: string;
}

interface ConfigurationJournalOperation {
  readonly previousIdentity: Pick<StandaloneConfigurationIdentity, "sizeBytes" | "sha256"> | null;
}

interface ParsedStandaloneReceipt {
  readonly names: ReadonlySet<string>;
  readonly configuration: StandaloneConfigurationIdentity | null;
}

export type StandaloneFileRole =
  | { readonly kind: "main" }
  | { readonly kind: "source-map"; readonly owner: string }
  | { readonly kind: "css"; readonly owner: string }
  | { readonly kind: "embedded"; readonly owner: string }
  | { readonly kind: "configuration"; readonly owner: string };

const SERVER_CONFIGURATION_EXTENSIONS = Object.freeze([".json", ".yml", ".yaml"] as const);

/** Every Server snapshot name a standalone owner may need to create or retire. */
export function standaloneServerConfigurationPaths(outputPath: string): readonly string[] {
  const output = resolve(outputPath);
  if (extname(output) !== ".js") throw new Error("Standalone Server configuration requires a .js output path");
  return SERVER_CONFIGURATION_EXTENSIONS.map((extension) => `${output.slice(0, -3)}.server${extension}`);
}

/** Stable top-level sidecar name retaining the parser selected by the manifest path. */
export function standaloneServerConfigurationPath(outputPath: string, configurationPath: string): string {
  const extension = extname(configurationPath).toLowerCase();
  const index = SERVER_CONFIGURATION_EXTENSIONS.indexOf(extension as typeof SERVER_CONFIGURATION_EXTENSIONS[number]);
  if (index < 0) throw new Error("Standalone Server configuration must end in .yml, .yaml, or .json");
  return standaloneServerConfigurationPaths(outputPath)[index]!;
}

export async function readStandaloneReceipt(outputPath: string): Promise<ReadonlySet<string>> {
  return (await readStandaloneOutputOwnership(outputPath)).files;
}

/** Reads and verifies the main receipt together with its content-bound configuration owner link. */
export async function readStandaloneOutputOwnership(outputPath: string): Promise<StandaloneOutputOwnership> {
  try {
    // The receipt is always the final line. A giant author file without that
    // bounded tail is rejected without allocating or scanning the file body.
    const inspected = await inspectOrdinaryFileEdges(outputPath, 0, MAX_STANDALONE_RECEIPT_BYTES);
    if (inspected === null) return emptyOwnership();
    const receipt = parseStandaloneReceipt(inspected.tail, outputPath);
    if (receipt === null
      || !await validateReceiptFiles(outputPath, inspected.state, receipt.names, receipt.configuration)) {
      return emptyOwnership();
    }
    return {
      files: new Set([...receipt.names].map((file) => resolve(dirname(outputPath), file))),
      configuration: receipt.configuration,
    };
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || error instanceof SyntaxError) return emptyOwnership();
    throw error;
  }
}

/** Reads only the content identity bound by a candidate main file's receipt. */
export async function readStandaloneConfigurationOwner(
  mainCandidatePath: string,
  outputPath: string,
): Promise<StandaloneConfigurationIdentity | null> {
  try {
    const inspected = await inspectOrdinaryFileEdges(mainCandidatePath, 0, MAX_STANDALONE_RECEIPT_BYTES);
    return inspected === null ? null : parseStandaloneReceipt(inspected.tail, outputPath)?.configuration ?? null;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || error instanceof SyntaxError) return null;
    throw error;
  }
}

function parseStandaloneReceipt(contents: string, outputPath: string): ParsedStandaloneReceipt | null {
  const marker = contents.match(/(?:^|\n)\/\/ @velarscript\/standalone-output-v([12]) ([A-Za-z0-9_-]+)\r?\n?$/u);
  if (!marker) return null;
  const parsed = JSON.parse(Buffer.from(marker[2]!, "base64url").toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  const formatVersion = Number(marker[1]);
  if (value.formatVersion !== formatVersion || formatVersion !== 1 && formatVersion !== 2
    || value.kind !== "velar-standalone-build"
    || value.outputFile !== basename(outputPath) || !Array.isArray(value.files)
    || value.files.length > MAX_STANDALONE_RECEIPT_FILES
    || !value.files.includes(basename(outputPath))) return null;
  const names = new Set<string>();
  for (const file of value.files) {
    if (typeof file !== "string" || basename(file) !== file || names.has(file)) return null;
    names.add(file);
  }
  const configuration = formatVersion === 2 ? configurationIdentity(value.configuration) : null;
  if (formatVersion === 2 && value.configuration !== null && configuration === null) return null;
  const configuredNames = [...names].filter((file) =>
    standaloneFileRole(outputPath, resolve(dirname(outputPath), file))?.kind === "configuration");
  if (formatVersion === 1 && configuredNames.length > 0) return null;
  if (formatVersion === 2 && (configuration === null
    ? configuredNames.length > 0
    : configuredNames.length !== 1 || configuredNames[0] !== configuration.file || !names.has(configuration.file))) {
    return null;
  }
  return {names, configuration};
}

function emptyOwnership(): StandaloneOutputOwnership {
  return {files: new Set(), configuration: null};
}

/** Binds a previously owned sidecar to the exact bytes captured before installation. */
export function assertStandaloneConfigurationReceiptIdentity(
  outputPath: string,
  configuration: StandaloneConfigurationIdentity | null,
  operations: readonly ConfigurationOutputOperation[],
  planned: readonly ConfigurationJournalOperation[],
): void {
  if (configuration === null) return;
  const path = resolve(dirname(outputPath), configuration.file);
  const index = operations.findIndex((candidate) => resolve(candidate.path) === path);
  const operation = operations[index];
  const identity = planned[index]?.previousIdentity ?? null;
  if (!operation || operation.kind !== "file" || identity === null) {
    throw new Error(`Standalone Server configuration '${path}' has no file transaction operation`);
  }
  if (identity.sizeBytes !== configuration.sizeBytes || identity.sha256 !== configuration.sha256) {
    throw new Error(`Standalone Server configuration '${path}' changed after its owner receipt was validated`);
  }
}

export async function writeStandaloneReceipt(
  staging: string,
  outputPath: string,
  generatedSiblingFiles: readonly string[],
  configurationPath: string | null = null,
): Promise<void> {
  const outputName = basename(outputPath);
  const embeddedNames = generatedSiblingFiles.map((path) => basename(path));
  const expected = new Set([
    outputName,
    `${outputName}.map`,
    basename(outputPath.replace(/\.js$/u, ".css")),
    ...embeddedNames.flatMap((name) => [name, `${name}.map`]),
    ...(configurationPath === null ? [] : [basename(configurationPath)]),
  ]);
  const files: string[] = [];
  const directory = await opendir(staging);
  let entryCount = 0;
  for await (const entry of directory) {
    if (entryCount >= MAX_STANDALONE_RECEIPT_FILES) {
      throw new RangeError(`Standalone staging inventory cannot exceed ${MAX_STANDALONE_RECEIPT_FILES} entries`);
    }
    entryCount += 1;
    if (entry.isFile() && entry.name !== STANDALONE_TRANSACTION_MARKER
      && entry.name !== STANDALONE_TRANSACTION_EVIDENCE_MARKER
      && entry.name !== `${STANDALONE_TRANSACTION_MARKER}.next`) files.push(entry.name);
  }
  files.sort();
  const unexpected = files.find((file) => !expected.has(file));
  if (unexpected) throw new Error(`Standalone staging emitted unsupported sidecar '${join(staging, unexpected)}'`);
  let configuration: StandaloneConfigurationIdentity | null = null;
  if (configurationPath !== null) {
    if (standaloneFileRole(outputPath, configurationPath)?.kind !== "configuration") {
      throw new Error(`Standalone Server configuration '${configurationPath}' is not owned by '${outputName}'`);
    }
    configuration = await configurationFileIdentity(
      join(staging, basename(configurationPath)),
      basename(configurationPath),
    );
    if (configuration === null) {
      throw new Error(`Standalone Server configuration '${join(staging, basename(configurationPath))}' is not a regular file`);
    }
  }
  for (const file of files) {
    const path = join(staging, file);
    if (file === `${outputName}.map`) await markSourceMapOwner(path, outputName);
    else if (file === basename(outputPath.replace(/\.js$/u, ".css"))) await markCssOwner(path, outputName);
    else if (embeddedNames.includes(file)) await markEmbeddedOwner(path, outputName);
    else if (file.endsWith(".map") && embeddedNames.includes(file.slice(0, -4))) {
      await markSourceMapOwner(path, file.slice(0, -4));
    }
  }
  const receipt: StandaloneReceiptV2 = {
    formatVersion: 2,
    kind: "velar-standalone-build",
    outputFile: outputName,
    files,
    configuration,
  };
  const stagedOutput = join(staging, outputName);
  const encoded = Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url");
  const marker = `${RECEIPT_MARKER}${encoded}\n`;
  if (Buffer.byteLength(marker, "utf8") > MAX_STANDALONE_RECEIPT_BYTES) {
    throw new RangeError(`Standalone output receipt exceeds ${MAX_STANDALONE_RECEIPT_BYTES} bytes`);
  }
  await appendGeneratedMarker(stagedOutput, marker);
}

export function standaloneFileRole(outputPath: string, target: string): StandaloneFileRole | null {
  if (dirname(resolve(target)) !== dirname(resolve(outputPath))) return null;
  const outputName = basename(outputPath);
  const name = basename(target);
  if (name === outputName) return { kind: "main" };
  if (name === `${outputName}.map`) return { kind: "source-map", owner: outputName };
  if (name === basename(outputPath.replace(/\.js$/u, ".css"))) return { kind: "css", owner: outputName };
  if (standaloneServerConfigurationPaths(outputPath).some((path) => resolve(path) === resolve(target))) {
    return { kind: "configuration", owner: outputName };
  }
  if (embeddedSidecarName(name)) return { kind: "embedded", owner: outputName };
  if (name.endsWith(".map") && embeddedSidecarName(name.slice(0, -4))) {
    return { kind: "source-map", owner: name.slice(0, -4) };
  }
  return null;
}

export async function standaloneFileOwnedByRole(
  path: string,
  role: StandaloneFileRole,
  configurationIdentities: readonly Pick<StandaloneConfigurationIdentity, "sizeBytes" | "sha256">[] = [],
): Promise<boolean> {
  if (role.kind === "main") return isRegularFile(path);
  if (role.kind === "configuration") {
    const actual = await configurationFileIdentity(path, basename(path));
    return actual !== null && configurationIdentities.some((expected) =>
      actual.sizeBytes === expected.sizeBytes && actual.sha256 === expected.sha256);
  }
  if (role.kind === "source-map") return sourceMapOwnedBy(path, role.owner);
  if (role.kind === "css") return cssOwnedBy(path, role.owner);
  return embeddedOwnedBy(path, role.owner);
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return false;
    throw error;
  }
}

async function validateReceiptFiles(
  outputPath: string,
  outputState: OrdinaryFileState,
  files: ReadonlySet<string>,
  configuration: StandaloneConfigurationIdentity | null,
): Promise<boolean> {
  const outputName = basename(outputPath);
  if (!files.has(outputName)) return false;
  const mainReferences: string[] = [];
  for (const file of files) {
    const role = standaloneFileRole(outputPath, resolve(dirname(outputPath), file));
    if (role?.kind === "source-map" && role.owner === outputName) mainReferences.push(`sourceMappingURL=${file}`);
    if (role?.kind === "embedded") mainReferences.push(`./${file}`);
  }
  if (!await ordinaryFileContainsAll(outputPath, outputState, mainReferences)) return false;
  for (const file of files) {
    const path = resolve(dirname(outputPath), file);
    const role = standaloneFileRole(outputPath, path);
    if (role === null) return false;
    if (role.kind === "main") continue;
    if (role.kind === "source-map" && role.owner !== outputName) {
      if (!files.has(role.owner)) return false;
      const embedded = await inspectOrdinaryFileEdges(
        resolve(dirname(outputPath), role.owner),
        0,
        OWNER_MARKER_EDGE_BYTES,
      );
      if (embedded === null || !embedded.tail.includes(`sourceMappingURL=${file}`)) return false;
    }
    if (!await standaloneFileOwnedByRole(
      path,
      role,
      role.kind === "configuration" && configuration !== null ? [configuration] : [],
    )) return false;
  }
  return true;
}

function configurationIdentity(value: unknown): StandaloneConfigurationIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join("\0") !== "file\0sha256\0sizeBytes"
    || typeof candidate.file !== "string" || basename(candidate.file) !== candidate.file
    || !Number.isSafeInteger(candidate.sizeBytes) || (candidate.sizeBytes as number) < 0
    || (candidate.sizeBytes as number) > MAXIMUM_SERVER_CONFIGURATION_BYTES
    || typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.sha256)) return null;
  return candidate as unknown as StandaloneConfigurationIdentity;
}

async function configurationFileIdentity(
  path: string,
  file: string,
): Promise<StandaloneConfigurationIdentity | null> {
  try {
    const before = await lstat(path, {bigint: true});
    if (!before.isFile() || before.isSymbolicLink()
      || before.size > BigInt(MAXIMUM_SERVER_CONFIGURATION_BYTES)) return null;
    const handle = await open(path, "r");
    try {
      const opened = await handle.stat({bigint: true});
      if (!opened.isFile() || !sameFileIdentity(before, opened)) return null;
      let contents: Buffer;
      try {
        contents = await readBoundedFileHandle(
          handle,
          MAXIMUM_SERVER_CONFIGURATION_BYTES,
          `Standalone Server configuration '${path}'`,
        );
      } catch (error) {
        if (error instanceof RangeError) return null;
        throw error;
      }
      const after = await handle.stat({bigint: true});
      const afterPath = await lstat(path, {bigint: true});
      if (!after.isFile() || !afterPath.isFile() || afterPath.isSymbolicLink()
        || !sameFileIdentity(opened, after) || !sameFileIdentity(opened, afterPath)
        || !sameFileSnapshot(opened, after) || !sameFileSnapshot(opened, afterPath)
        || BigInt(contents.byteLength) !== after.size) return null;
      return {
        file,
        sizeBytes: contents.byteLength,
        sha256: createHash("sha256").update(contents).digest("hex"),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  }
}

interface ConfigurationFileState {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

function sameFileIdentity(left: ConfigurationFileState, right: ConfigurationFileState): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileSnapshot(left: ConfigurationFileState, right: ConfigurationFileState): boolean {
  return left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function markSourceMapOwner(path: string, owner: string): Promise<void> {
  const before = await lstat(path, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Invalid generated source map '${path}'`);
  if (before.size > BigInt(MAX_STANDALONE_SOURCE_MAP_BYTES)) {
    throw new RangeError(`Generated source map '${path}' exceeds ${MAX_STANDALONE_SOURCE_MAP_BYTES} bytes`);
  }
  const handle = await open(path, "r+");
  try {
    const opened = await handle.stat({bigint: true});
    if (!opened.isFile() || !sameFileIdentity(before, opened) || !sameFileSnapshot(before, opened)) {
      throw new Error(`Generated source map '${path}' changed before it could be marked`);
    }
    const contents = await readBoundedFileHandle(
      handle,
      MAX_STANDALONE_SOURCE_MAP_BYTES,
      `Generated source map '${path}'`,
    );
    const afterRead = await handle.stat({bigint: true});
    const afterReadPath = await lstat(path, {bigint: true});
    if (!afterRead.isFile() || !afterReadPath.isFile() || afterReadPath.isSymbolicLink()
      || !sameFileIdentity(opened, afterRead) || !sameFileIdentity(opened, afterReadPath)
      || !sameFileSnapshot(opened, afterRead) || !sameFileSnapshot(opened, afterReadPath)
      || BigInt(contents.byteLength) !== afterRead.size) {
      throw new Error(`Generated source map '${path}' changed while it was being marked`);
    }
    const value = JSON.parse(contents.toString("utf8")) as Record<string, unknown>;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Invalid generated source map '${path}'`);
    }
    value[SOURCE_MAP_OWNER_FIELD] = owner;
    const marked = `${JSON.stringify(value)}\n`;
    const markedBytes = Buffer.byteLength(marked, "utf8");
    if (markedBytes > MAX_STANDALONE_SOURCE_MAP_BYTES) {
      throw new RangeError(`Marked source map '${path}' exceeds ${MAX_STANDALONE_SOURCE_MAP_BYTES} bytes`);
    }
    await handle.truncate(0);
    await writeDescriptorContents(handle, Buffer.from(marked, "utf8"));
    const written = await handle.stat({bigint: true});
    const writtenPath = await lstat(path, {bigint: true});
    if (!written.isFile() || !writtenPath.isFile() || writtenPath.isSymbolicLink()
      || !sameFileIdentity(opened, written) || !sameFileIdentity(opened, writtenPath)
      || written.size !== BigInt(markedBytes)) {
      throw new Error(`Generated source map '${path}' changed while its owner marker was written`);
    }
  } finally {
    await handle.close();
  }
}

async function markCssOwner(path: string, owner: string): Promise<void> {
  await appendGeneratedMarker(path, `${cssOwnerMarker(owner)}\n`);
}

async function markEmbeddedOwner(path: string, owner: string): Promise<void> {
  const inspected = await inspectOrdinaryFileEdges(path, OWNER_MARKER_EDGE_BYTES, 0);
  if (inspected === null || !inspected.prefix.includes("// @velarscript/generated-embedded-module")) {
    throw new Error(`Invalid generated embedded JavaScript '${path}'`);
  }
  await appendGeneratedMarker(path, `${embeddedOwnerMarker(owner)}\n`);
}

async function sourceMapOwnedBy(path: string, owner: string): Promise<boolean> {
  const inspected = await inspectOrdinaryFileEdges(path, 0, OWNER_MARKER_EDGE_BYTES);
  return inspected !== null && inspected.tail.trimEnd().endsWith(
    `${JSON.stringify(SOURCE_MAP_OWNER_FIELD)}:${JSON.stringify(owner)}}`,
  );
}

async function cssOwnedBy(path: string, owner: string): Promise<boolean> {
  return (await inspectOrdinaryFileEdges(path, 0, OWNER_MARKER_EDGE_BYTES))
    ?.tail.trimEnd().endsWith(cssOwnerMarker(owner)) ?? false;
}

async function embeddedOwnedBy(path: string, owner: string): Promise<boolean> {
  const inspected = await inspectOrdinaryFileEdges(path, OWNER_MARKER_EDGE_BYTES, OWNER_MARKER_EDGE_BYTES);
  return inspected !== null && inspected.prefix.includes("// @velarscript/generated-embedded-module")
    && inspected.tail.trimEnd().endsWith(embeddedOwnerMarker(owner));
}

interface OrdinaryFileState {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

interface OrdinaryFileEdges {
  readonly prefix: string;
  readonly tail: string;
  readonly state: OrdinaryFileState;
}

async function inspectOrdinaryFileEdges(
  path: string,
  prefixBytes: number,
  tailBytes: number,
): Promise<OrdinaryFileEdges | null> {
  try {
    const before = await lstat(path, {bigint: true});
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const handle = await open(path, "r");
    try {
      const opened = await handle.stat({bigint: true});
      if (!opened.isFile() || !sameFileIdentity(before, opened)) return null;
      const size = Number(opened.size);
      const prefix = await readDescriptorRange(handle, 0, Math.min(prefixBytes, size));
      const tailLength = Math.min(tailBytes, size);
      const tail = await readDescriptorRange(handle, size - tailLength, tailLength);
      const after = await handle.stat({bigint: true});
      const afterPath = await lstat(path, {bigint: true});
      if (!after.isFile() || !afterPath.isFile() || afterPath.isSymbolicLink()
        || !sameFileIdentity(opened, after) || !sameFileIdentity(opened, afterPath)
        || !sameFileSnapshot(opened, after) || !sameFileSnapshot(opened, afterPath)) return null;
      return {prefix: prefix.toString("utf8"), tail: tail.toString("utf8"), state: after};
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  }
}

async function ordinaryFileContainsAll(
  path: string,
  expected: OrdinaryFileState,
  values: readonly string[],
): Promise<boolean> {
  const pending = new Set(values.map((value) => Buffer.from(value, "utf8").toString("hex")));
  const needles = new Map([...pending].map((key) => [key, Buffer.from(key, "hex")]));
  try {
    const before = await lstat(path, {bigint: true});
    if (!before.isFile() || before.isSymbolicLink()
      || !sameFileIdentity(before, expected) || !sameFileSnapshot(before, expected)) return false;
    const handle = await open(path, "r");
    try {
      const opened = await handle.stat({bigint: true});
      if (!opened.isFile() || !sameFileIdentity(opened, expected) || !sameFileSnapshot(opened, expected)) return false;
      const maximumNeedleBytes = Math.max(1, ...[...needles.values()].map((needle) => needle.byteLength));
      let carry = Buffer.alloc(0);
      let position = 0;
      while (pending.size > 0 && position < Number(opened.size)) {
        const length = Math.min(OWNER_SCAN_CHUNK_BYTES, Number(opened.size) - position);
        const chunk = await readDescriptorRange(handle, position, length);
        const window = carry.byteLength === 0 ? chunk : Buffer.concat([carry, chunk]);
        for (const key of pending) if (window.indexOf(needles.get(key)!) >= 0) pending.delete(key);
        carry = Buffer.from(window.subarray(Math.max(0, window.byteLength - maximumNeedleBytes + 1)));
        position += length;
      }
      const after = await handle.stat({bigint: true});
      const afterPath = await lstat(path, {bigint: true});
      return pending.size === 0 && after.isFile() && afterPath.isFile() && !afterPath.isSymbolicLink()
        && sameFileIdentity(opened, after) && sameFileIdentity(opened, afterPath)
        && sameFileSnapshot(opened, after) && sameFileSnapshot(opened, afterPath);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return false;
    throw error;
  }
}

async function readDescriptorRange(
  handle: Awaited<ReturnType<typeof open>>,
  position: number,
  length: number,
): Promise<Buffer> {
  const output = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const {bytesRead} = await handle.read(output, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error("File changed while it was being inspected");
    offset += bytesRead;
  }
  return output;
}

async function writeDescriptorContents(
  handle: Awaited<ReturnType<typeof open>>,
  contents: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < contents.byteLength) {
    const {bytesWritten} = await handle.write(contents, offset, contents.byteLength - offset, offset);
    if (bytesWritten === 0) throw new Error("File stopped accepting generated standalone output");
    offset += bytesWritten;
  }
}

async function appendGeneratedMarker(path: string, marker: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error(`Generated standalone output '${path}' is not a regular file`);
    let separator = "";
    if (metadata.size > 0) {
      const last = await readDescriptorRange(handle, metadata.size - 1, 1);
      if (last[0] !== 0x0a && last[0] !== 0x0d) separator = "\n";
    }
    await handle.write(`${separator}${marker}`, metadata.size, "utf8");
  } finally {
    await handle.close();
  }
}

function embeddedSidecarName(name: string): boolean {
  return /^[A-Za-z0-9._-]+\.[0-9a-z]+\.embedded-[1-9][0-9]*\.js$/u.test(name);
}

function embeddedOwnerMarker(owner: string): string {
  return `${EMBEDDED_OWNER_MARKER}${Buffer.from(owner, "utf8").toString("base64url")}`;
}

function cssOwnerMarker(owner: string): string {
  return `${CSS_OWNER_MARKER}${Buffer.from(owner, "utf8").toString("base64url")} */`;
}
