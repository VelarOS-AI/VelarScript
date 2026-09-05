import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

export interface VelarLibraryArtifactJavaScriptSnapshot {
  /** Canonical identity authorized while the receipt was verified. */
  readonly path: string;
  readonly code: string;
  readonly sourceMapPath: string;
  readonly sourceMap: string;
}

export interface AuthorizedArtifactFile {
  readonly path: string;
  readonly identity: string;
  readonly size: number;
  readonly device: number;
  readonly inode: number;
  readonly maximum: number;
  readonly label: string;
}

/** One canonical set of byte ceilings for both installed and packed artifacts. */
export const VELAR_LIBRARY_ARTIFACT_LIMITS = Object.freeze({
  receiptBytes: 4 * 1024 * 1024,
  fileBytes: 64 * 1024 * 1024,
  interfaceBytes: 8 * 1024 * 1024,
  javascriptBytes: 16 * 1024 * 1024,
  setBytes: 256 * 1024 * 1024,
});

export interface VelarLibraryArtifactBudgetFile {
  readonly size: number;
  readonly interface: boolean;
  readonly javascript: boolean;
}

export interface VelarLibraryArtifactBudget {
  readonly receiptBytes: number;
  readonly totalBytes: number;
  readonly interfaceBytes: number;
  readonly javascriptBytes: number;
}

/** Authorizes one ordinary package file and records the exact inode to read. */
export async function authorizeArtifactFile(
  rootIdentity: string,
  path: string,
  maximum: number,
  label: string,
): Promise<AuthorizedArtifactFile> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be an ordinary file`);
  if (metadata.size > maximum) throw new RangeError(`${label} exceeds ${maximum} bytes`);
  const identity = await realpath(path);
  const fromRoot = relative(rootIdentity, identity);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} escapes its package directory`);
  }
  const identityMetadata = await lstat(identity);
  if (!sameFile(metadata, identityMetadata)) throw new Error(`${label} changed while it was being authorized`);
  return {
    path,
    identity,
    size: metadata.size,
    device: metadata.dev,
    inode: metadata.ino,
    maximum,
    label,
  };
}

/** Reads exact bytes from the same authorized inode instead of trusting a path again. */
export async function readAuthorizedArtifactBytes(file: AuthorizedArtifactFile): Promise<Buffer> {
  const handle = await open(file.path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.dev !== file.device || metadata.ino !== file.inode || metadata.size !== file.size) {
      throw new Error(`${file.label} changed after it was authorized`);
    }
    if (metadata.size > file.maximum) throw new RangeError(`${file.label} exceeds ${file.maximum} bytes`);
    const bytes = await handle.readFile();
    const finalMetadata = await handle.stat();
    if (bytes.byteLength !== file.size || finalMetadata.size !== file.size
      || finalMetadata.dev !== file.device || finalMetadata.ino !== file.inode) {
      throw new Error(`${file.label} changed while it was being read`);
    }
    if (bytes.byteLength > file.maximum) throw new RangeError(`${file.label} exceeds ${file.maximum} bytes`);
    return bytes;
  } finally {
    await handle.close();
  }
}

/** Decodes an authenticated textual artifact without replacement characters. */
export function decodeArtifactUtf8(bytes: Uint8Array, label: string): string {
  try {
    // Preserve a leading BOM in the snapshot so re-encoding remains byte-exact.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8`);
  }
}

/** Checks one already-owned byte view against its canonical per-file ceiling. */
export function assertArtifactByteLength(bytes: Uint8Array, maximum: number, label: string): void {
  if (bytes.byteLength > maximum) throw new RangeError(`${label} exceeds ${maximum} bytes`);
}

/** Authenticates already-owned bytes before exposing their strict UTF-8 text. */
export function authenticateArtifactTextBytes(
  bytes: Uint8Array,
  maximum: number,
  expectedSha256: string,
  label: string,
  hashLabel: string,
): string {
  assertArtifactByteLength(bytes, maximum, label);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
    throw new Error(`Velar library artifact ${hashLabel} hash mismatch; the package is incomplete or was modified after its receipt was written`);
  }
  return decodeArtifactUtf8(bytes, label);
}

/** Reads and strictly decodes one authorized textual artifact. */
export async function readAuthorizedArtifactText(file: AuthorizedArtifactFile): Promise<string> {
  return decodeArtifactUtf8(await readAuthorizedArtifactBytes(file), file.label);
}

/** Verifies the receipt digest over raw bytes before any text decoding occurs. */
export async function readAuthenticatedArtifactText(
  file: AuthorizedArtifactFile,
  expectedSha256: string,
  hashLabel: string,
): Promise<string> {
  const bytes = await readAuthorizedArtifactBytes(file);
  return authenticateArtifactTextBytes(bytes, file.maximum, expectedSha256, file.label, hashLabel);
}

/** Applies the ABI's artifact-set, interface, and JavaScript aggregate budgets. */
export function assertVelarLibraryArtifactBudgets(
  files: readonly VelarLibraryArtifactBudgetFile[],
  receiptBytes: number,
): void {
  checkedVelarLibraryArtifactBudget(
    receiptBytes,
    files.reduce((total, file) => total + file.size, receiptBytes),
    files.reduce((total, file) => total + (file.interface ? file.size : 0), 0),
    files.reduce((total, file) => total + (file.javascript ? file.size : 0), 0),
  );
}

/** Starts a checked aggregate budget before any output bytes are retained. */
export function createVelarLibraryArtifactBudget(receiptBytes: number): VelarLibraryArtifactBudget {
  return checkedVelarLibraryArtifactBudget(receiptBytes, receiptBytes, 0, 0);
}

/** Accounts one output and rejects it before a caller adds its bytes to the artifact set. */
export function addVelarLibraryArtifactBudgetFile(
  budget: VelarLibraryArtifactBudget,
  file: VelarLibraryArtifactBudgetFile,
): VelarLibraryArtifactBudget {
  return checkedVelarLibraryArtifactBudget(
    budget.receiptBytes,
    budget.totalBytes + file.size,
    budget.interfaceBytes + (file.interface ? file.size : 0),
    budget.javascriptBytes + (file.javascript ? file.size : 0),
  );
}

function checkedVelarLibraryArtifactBudget(
  receiptBytes: number,
  totalBytes: number,
  interfaceBytes: number,
  javascriptBytes: number,
): VelarLibraryArtifactBudget {
  const limits = VELAR_LIBRARY_ARTIFACT_LIMITS;
  if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.setBytes) {
    throw new RangeError(`Velar library artifact set exceeds ${limits.setBytes} bytes`);
  }
  if (!Number.isSafeInteger(interfaceBytes) || interfaceBytes > limits.interfaceBytes) {
    throw new RangeError(`Velar library artifact interface set exceeds ${limits.interfaceBytes} bytes`);
  }
  if (!Number.isSafeInteger(javascriptBytes) || javascriptBytes > limits.javascriptBytes) {
    throw new RangeError(`Velar library artifact JavaScript set exceeds ${limits.javascriptBytes} bytes`);
  }
  return { receiptBytes, totalBytes, interfaceBytes, javascriptBytes };
}

/** Verifies that one authenticated JavaScript snapshot names a valid external source-map v3 file. */
export function assertVelarLibraryArtifactSourceMap(snapshot: VelarLibraryArtifactJavaScriptSnapshot): void {
  const expected = relative(dirname(snapshot.path), snapshot.sourceMapPath).replaceAll("\\", "/");
  const directives = [...snapshot.code.matchAll(/^[\t ]*\/\/#[\t ]+sourceMappingURL=([^\s]+)[\t ]*$/gmu)];
  const directive = directives[0];
  if (directives.length !== 1 || directive?.index === undefined) {
    throw new Error(`Velar library JavaScript artifact '${snapshot.path}' must contain exactly one sourceMappingURL directive`);
  }
  const trailing = snapshot.code.slice(directive.index + directive[0].length);
  if (trailing.trim() !== "" || directive[1] !== expected) {
    throw new Error(`Velar library JavaScript artifact '${snapshot.path}' must link source map '${expected}'`);
  }
  validateSourceMapV3(snapshot.sourceMap, snapshot.sourceMapPath);
}

function validateSourceMapV3(text: string, path: string): void {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Velar library source map '${path}' must contain valid JSON`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Velar library source map '${path}' must be a source-map v3 object`);
  }
  const map = value as Record<string, unknown>;
  if (map.version !== 3 || !stringArray(map.sources) || !stringArray(map.names) || typeof map.mappings !== "string") {
    throw new Error(`Velar library source map '${path}' must contain version 3, string sources/names, and string mappings`);
  }
  if (map.file !== undefined && typeof map.file !== "string") throw new Error(`Velar library source map '${path}' file must be a string`);
  if (map.sourceRoot !== undefined && typeof map.sourceRoot !== "string") throw new Error(`Velar library source map '${path}' sourceRoot must be a string`);
  if (map.sourcesContent !== undefined && (!Array.isArray(map.sourcesContent)
    || map.sourcesContent.length !== map.sources.length
    || map.sourcesContent.some((item) => item !== null && typeof item !== "string"))) {
    throw new Error(`Velar library source map '${path}' sourcesContent must align with sources`);
  }
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Supplies an authenticated JS snapshot without asking esbuild to reopen its map. */
export function artifactSnapshotContents(
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
  sourceMaps: boolean,
): string {
  const code = snapshot.code.replace(/\n?\/\/# sourceMappingURL=[^\r\n]*\r?\n?$/u, "");
  if (!sourceMaps) return code.endsWith("\n") ? code : `${code}\n`;
  const encoded = Buffer.from(snapshot.sourceMap, "utf8").toString("base64");
  return `${code.endsWith("\n") ? code : `${code}\n`}//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}

/** Rejects a run/test launch if its installed artifact changed after checking. */
export async function assertArtifactSnapshotCurrent(snapshot: VelarLibraryArtifactJavaScriptSnapshot): Promise<void> {
  const [code, sourceMap] = await Promise.all([
    readCurrentSnapshotFile(snapshot.path, snapshot.code, "Velar library JavaScript artifact"),
    readCurrentSnapshotFile(snapshot.sourceMapPath, snapshot.sourceMap, "Velar library source map"),
  ]);
  if (!code || !sourceMap) {
    throw new Error("Velar library artifact changed after it was checked; restart the command with an unchanged installation");
  }
}

async function readCurrentSnapshotFile(path: string, expected: string, label: string): Promise<boolean> {
  const expectedBytes = Buffer.from(expected, "utf8");
  const maximum = expectedBytes.byteLength;
  const identity = await realpath(path);
  if (identity !== resolve(path)) throw new Error(`${label} changed into a symbolic link after it was checked`);
  const authorization = await authorizeArtifactFile(resolve(path, ".."), path, maximum, label);
  const current = await readAuthorizedArtifactBytes(authorization);
  decodeArtifactUtf8(current, label);
  return current.equals(expectedBytes);
}

function sameFile(left: { readonly dev: number; readonly ino: number }, right: { readonly dev: number; readonly ino: number }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
