import { readdir, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { readBoundedText } from "./bounded-text.ts";
import { isHostErrorCode } from "./host-error.ts";
import { byCodeUnit } from "./stable-order.ts";

export const WORKSPACE_TEXT_EXTENSIONS = Object.freeze([
  ".vel", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".json", ".md", ".css",
] as const);
export const MAX_WORKSPACE_TEXT_FILES = 50_000;
export const MAX_WORKSPACE_TEXT_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_WORKSPACE_TEXT_BYTES = 128 * 1024 * 1024;
export const MAX_WORKSPACE_SEARCH_QUERY_CODE_UNITS = 1_024;
export const MAX_WORKSPACE_SEARCH_RESULTS = 10_000;
export const MAX_WORKSPACE_SEARCH_PREVIEW_CODE_UNITS = 256;
export const MAX_WORKSPACE_CHANGE_PATHS = 4_096;
export const MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS = 4_096;
export const MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS = 2 * 1024 * 1024;

const extensions = new Set<string>(WORKSPACE_TEXT_EXTENSIONS);
const ignoredDirectories = new Set([".git", ".velar", "dist", "node_modules"]);

export interface WorkspaceIndexPosition {
  readonly line: number;
  readonly utf16Character: number;
  readonly utf32Character: number;
}

export interface WorkspaceTextMatch {
  readonly path: string;
  readonly start: WorkspaceIndexPosition;
  readonly end: WorkspaceIndexPosition;
  readonly preview: string;
}

export interface WorkspaceTextSearchResult {
  readonly matches: readonly WorkspaceTextMatch[];
  readonly limitReached: boolean;
  readonly filesSearched: number;
  readonly indexedFiles: number;
  readonly indexedBytes: number;
  readonly revision: number;
  readonly durationMs: number;
  readonly coverageComplete: boolean;
}

export interface WorkspaceTextSearchOptions {
  readonly caseSensitive?: boolean;
  readonly maximumResults?: number;
  readonly cancelled?: () => boolean;
}

export interface WorkspaceIndexActivity {
  readonly strategy: "rescan" | "known-changes";
  readonly filesRead: number;
  readonly indexedFiles: number;
  readonly indexedBytes: number;
  readonly skippedLargeFiles: number;
  readonly skippedByAggregateBudget: number;
  readonly changesReceived: number;
  readonly changeRoots: number;
  readonly recordsRemoved: number;
  readonly revision: number;
}

interface IndexedDocument {
  readonly path: string;
  readonly text: string;
  readonly bytes: number;
}

interface OpenDocumentOverlay {
  readonly text: string | null;
  readonly exclusion: "large-file" | "aggregate-budget" | null;
}

interface MutableActivity {
  filesRead: number;
  skippedLargeFiles: number;
  skippedByAggregateBudget: number;
  changesReceived: number;
  changeRoots: number;
  recordsRemoved: number;
}

export class WorkspaceTextIndex {
  private roots: string[] = [];
  private documents = new Map<string, IndexedDocument>();
  private readonly overlays = new Map<string, OpenDocumentOverlay>();
  private indexedBytes = 0;
  private revision = 0;
  private coverageComplete = false;

  configure(roots: readonly string[]): void {
    const normalized: string[] = [];
    for (const root of [...new Set(roots.map((value) => resolve(value)))].sort((left, right) => left.length - right.length || byCodeUnit(left, right))) {
      if (!normalized.some((owner) => within(owner, root))) normalized.push(root);
    }
    if (normalized.length === this.roots.length && normalized.every((root, index) => root === this.roots[index])) return;
    this.roots = normalized;
    this.documents = new Map();
    this.overlays.clear();
    this.indexedBytes = 0;
    this.coverageComplete = false;
    this.revision += 1;
  }

  workspaceRoots(): readonly string[] {
    return this.roots;
  }

  paths(extension?: string): readonly string[] {
    const expected = extension?.toLowerCase();
    return [...this.documents.keys()].filter((path) => expected === undefined || extname(path).toLowerCase() === expected).sort();
  }

  openDocument(path: string, text: string): void {
    const target = resolve(path);
    if (!this.accepts(target)) return;
    if (!this.documents.has(target) && this.documents.size >= MAX_WORKSPACE_TEXT_FILES) {
      this.coverageComplete = false;
      this.revision += 1;
      return;
    }
    const exclusion = this.replaceDocument(target, text);
    this.overlays.set(target, {
      text: exclusion === null ? text : null,
      exclusion,
    });
  }

  changeDocument(path: string, text: string): void {
    this.openDocument(path, text);
  }

  async closeDocument(path: string): Promise<WorkspaceIndexActivity> {
    const target = resolve(path);
    this.overlays.delete(target);
    return this.update(new Set([target]));
  }

  async rescan(cancelled: () => boolean = () => false): Promise<WorkspaceIndexActivity> {
    const next = new Map<string, IndexedDocument>();
    const activity = emptyActivity();
    const visitedPaths = new Set<string>();
    let bytes = 0;
    let visited = 0;
    for (const root of this.roots) {
      await this.visit(root, async (path) => {
        if (cancelled()) throw new WorkspaceIndexCancelledError();
        visitedPaths.add(path);
        visited += 1;
        if (visited % 128 === 0) await yieldToHost();
        const document = await this.readDocument(path, activity);
        if (!document) return;
        if (bytes + document.bytes > MAX_WORKSPACE_TEXT_BYTES) {
          activity.skippedByAggregateBudget += 1;
          return;
        }
        next.set(path, document);
        bytes += document.bytes;
        if (next.size > MAX_WORKSPACE_TEXT_FILES) {
          throw new RangeError(`A language-server workspace cannot contain more than ${MAX_WORKSPACE_TEXT_FILES} indexed text files`);
        }
      });
    }
    for (const [path, overlay] of this.overlays) {
      if (!this.accepts(path)) continue;
      if (visitedPaths.has(path)) continue;
      if (overlay.text === null) {
        recordOverlayExclusion(activity, overlay.exclusion);
        continue;
      }
      const previous = next.get(path);
      if (previous) bytes -= previous.bytes;
      const document = indexedDocument(path, overlay.text);
      if (!document || bytes + document.bytes > MAX_WORKSPACE_TEXT_BYTES) {
        if (!document) activity.skippedLargeFiles += 1;
        else activity.skippedByAggregateBudget += 1;
        next.delete(path);
        continue;
      }
      next.set(path, document);
      bytes += document.bytes;
    }
    this.documents = next;
    this.indexedBytes = bytes;
    this.coverageComplete = activity.skippedLargeFiles === 0 && activity.skippedByAggregateBudget === 0;
    this.revision += 1;
    return this.activity("rescan", activity);
  }

  async update(changedPaths: ReadonlySet<string>): Promise<WorkspaceIndexActivity> {
    if (changedPaths.size > MAX_WORKSPACE_CHANGE_PATHS) {
      throw new RangeError(`A workspace index update cannot contain more than ${MAX_WORKSPACE_CHANGE_PATHS} changed paths`);
    }
    const resolvedChanges = [...changedPaths].map((path) => resolve(path));
    if (resolvedChanges.some((path) => path.length > MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS)
      || resolvedChanges.reduce((total, path) => total + path.length, 0) > MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS) {
      throw new RangeError("A workspace index update exceeds its changed-path text budget");
    }
    const next = new Map(this.documents);
    const activity = emptyActivity();
    activity.changesReceived = resolvedChanges.length;
    const normalizedChanges = new Set<string>();
    for (const value of resolvedChanges.sort((left, right) => left.length - right.length || byCodeUnit(left, right))) {
      const root = this.workspaceRootFor(value);
      if (!root || changedBy(value, normalizedChanges, root)) continue;
      normalizedChanges.add(value);
    }
    activity.changeRoots = normalizedChanges.size;
    let visited = 0;
    let examined = 0;
    for (const path of next.keys()) {
      const root = this.workspaceRootFor(path);
      if (root && changedBy(path, normalizedChanges, root)) {
        next.delete(path);
        activity.recordsRemoved += 1;
      }
      examined += 1;
      if (examined % 128 === 0) await yieldToHost();
    }
    for (const value of [...normalizedChanges].sort()) {
      const overlay = this.overlays.get(value);
      if (overlay && this.accepts(value)) {
        if (overlay.text === null) {
          recordOverlayExclusion(activity, overlay.exclusion);
          continue;
        }
        const document = indexedDocument(value, overlay.text);
        if (document) next.set(value, document);
        else activity.skippedLargeFiles += 1;
        continue;
      }
      try {
        const metadata = await stat(value);
        if (metadata.isDirectory() && !this.ignored(value)) {
          await this.visit(value, async (path) => {
            visited += 1;
            if (visited % 128 === 0) await yieldToHost();
            const document = await this.readDocument(path, activity);
            if (document) next.set(path, document);
          });
        } else if (metadata.isFile() && this.accepts(value)) {
          const document = await this.readDocument(value, activity);
          if (document) next.set(value, document);
        }
      } catch (error) {
        if (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR")) throw error;
      }
    }
    for (const [path, overlay] of this.overlays) {
      if (!this.accepts(path)) continue;
      if (overlay.text === null) continue;
      const document = indexedDocument(path, overlay.text);
      if (document) next.set(path, document);
    }
    const bounded = new Map<string, IndexedDocument>();
    let bytes = 0;
    for (const [path, document] of [...next].sort(([left], [right]) => byCodeUnit(left, right))) {
      if (bounded.size >= MAX_WORKSPACE_TEXT_FILES) {
        throw new RangeError(`A language-server workspace cannot contain more than ${MAX_WORKSPACE_TEXT_FILES} indexed text files`);
      }
      if (bytes + document.bytes > MAX_WORKSPACE_TEXT_BYTES) {
        activity.skippedByAggregateBudget += 1;
        continue;
      }
      bounded.set(path, document);
      bytes += document.bytes;
    }
    this.documents = bounded;
    this.indexedBytes = bytes;
    this.coverageComplete = this.coverageComplete
      && activity.skippedLargeFiles === 0 && activity.skippedByAggregateBudget === 0;
    this.revision += 1;
    return this.activity("known-changes", activity);
  }

  async search(query: string, options: WorkspaceTextSearchOptions = {}): Promise<WorkspaceTextSearchResult> {
    if (query.length === 0) throw new RangeError("Workspace search query cannot be empty");
    if (query.length > MAX_WORKSPACE_SEARCH_QUERY_CODE_UNITS) {
      throw new RangeError(`Workspace search query cannot exceed ${MAX_WORKSPACE_SEARCH_QUERY_CODE_UNITS} UTF-16 code units`);
    }
    const maximumResults = options.maximumResults ?? 1_000;
    if (!Number.isSafeInteger(maximumResults) || maximumResults < 1 || maximumResults > MAX_WORKSPACE_SEARCH_RESULTS) {
      throw new RangeError(`Workspace search maximumResults must be an integer from 1 through ${MAX_WORKSPACE_SEARCH_RESULTS}`);
    }
    const started = performance.now();
    const matcher = new RegExp(escapeRegularExpression(query), options.caseSensitive ? "gu" : "giu");
    const matches: WorkspaceTextMatch[] = [];
    let filesSearched = 0;
    let sinceYield = 0;
    for (const document of this.documents.values()) {
      if (options.cancelled?.()) throw new WorkspaceIndexCancelledError();
      if (filesSearched > 0 && filesSearched % 128 === 0) await yieldToHost();
      filesSearched += 1;
      matcher.lastIndex = 0;
      let lineStarts: readonly number[] | null = null;
      // One cursor per file. `positionAt` counted code points from the start
      // of the line on every call, so a file with very long lines — a minified
      // bundle, a single-line JSON, both indexed extensions — cost O(offset)
      // per match and O(matches x size) per file. Matches arrive in increasing
      // offset order, so a cursor that only ever advances makes the file one
      // O(size) pass.
      let cursor: CodePointCursor | null = null;
      while (true) {
        const match = matcher.exec(document.text);
        if (!match) break;
        lineStarts ??= lineStartsFor(document.text);
        cursor ??= { line: -1, offset: 0, count: 0 };
        const start = positionAt(document.text, lineStarts, match.index, cursor);
        const end = positionAt(document.text, lineStarts, match.index + match[0].length, cursor);
        matches.push({ path: document.path, start, end, preview: previewAt(document.text, lineStarts, start.line) });
        if (matches.length >= maximumResults) {
          return this.searchResult(matches, true, filesSearched, started);
        }
        // A file with thousands of matches is one host turn's worth of work on
        // its own, so the poll cannot live only in the per-file loop: a single
        // large file answered no cancellation and served no other request.
        sinceYield += 1;
        if (sinceYield >= 128) {
          sinceYield = 0;
          if (options.cancelled?.()) throw new WorkspaceIndexCancelledError();
          await yieldToHost();
        }
      }
    }
    return this.searchResult(matches, false, filesSearched, started);
  }

  private searchResult(
    matches: readonly WorkspaceTextMatch[],
    limitReached: boolean,
    filesSearched: number,
    started: number,
  ): WorkspaceTextSearchResult {
    return {
      matches,
      limitReached,
      filesSearched,
      indexedFiles: this.documents.size,
      indexedBytes: this.indexedBytes,
      revision: this.revision,
      durationMs: performance.now() - started,
      coverageComplete: this.coverageComplete,
    };
  }

  private activity(strategy: WorkspaceIndexActivity["strategy"], value: MutableActivity): WorkspaceIndexActivity {
    return {
      strategy,
      ...value,
      indexedFiles: this.documents.size,
      indexedBytes: this.indexedBytes,
      revision: this.revision,
    };
  }

  private replaceDocument(path: string, text: string): OpenDocumentOverlay["exclusion"] {
    const previous = this.documents.get(path);
    const document = indexedDocument(path, text);
    if (!document) {
      this.coverageComplete = false;
      if (previous) {
        this.documents.delete(path);
        this.indexedBytes -= previous.bytes;
      }
      this.revision += 1;
      return "large-file";
    }
    const nextBytes = this.indexedBytes - (previous?.bytes ?? 0) + document.bytes;
    if (nextBytes > MAX_WORKSPACE_TEXT_BYTES) {
      this.coverageComplete = false;
      if (previous) {
        this.documents.delete(path);
        this.indexedBytes -= previous.bytes;
      }
      this.revision += 1;
      return "aggregate-budget";
    }
    this.documents.set(path, document);
    this.indexedBytes = nextBytes;
    this.revision += 1;
    return null;
  }

  private async readDocument(path: string, activity: MutableActivity): Promise<IndexedDocument | null> {
    const overlay = this.overlays.get(path);
    if (overlay) {
      if (overlay.text === null) {
        recordOverlayExclusion(activity, overlay.exclusion);
        return null;
      }
      const document = indexedDocument(path, overlay.text);
      if (!document) activity.skippedLargeFiles += 1;
      return document;
    }
    try {
      const text = await readBoundedText(path, MAX_WORKSPACE_TEXT_FILE_BYTES, "workspace text file");
      activity.filesRead += 1;
      const currentOverlay = this.overlays.get(path);
      if (currentOverlay?.text === null) {
        recordOverlayExclusion(activity, currentOverlay.exclusion);
        return null;
      }
      return indexedDocument(path, currentOverlay?.text ?? text);
    } catch (error) {
      if (error instanceof RangeError) {
        activity.skippedLargeFiles += 1;
        return null;
      }
      if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
      throw error;
    }
  }

  private async visit(directory: string, accept: (path: string) => Promise<void>, depth = 0): Promise<void> {
    if (depth > 64) throw new RangeError("A language-server workspace directory cannot exceed 64 levels");
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return;
      throw error;
    }
    entries.sort((left, right) => byCodeUnit(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await this.visit(path, accept, depth + 1);
      } else if (entry.isFile() && this.accepts(path)) {
        await accept(path);
      }
    }
  }

  private accepts(path: string): boolean {
    return this.withinWorkspace(path) && !this.ignored(path) && extensions.has(extname(path).toLowerCase());
  }

  private withinWorkspace(path: string): boolean {
    return this.workspaceRootFor(path) !== null;
  }

  private workspaceRootFor(path: string): string | null {
    return this.roots.find((root) => within(root, path)) ?? null;
  }

  private ignored(path: string): boolean {
    for (const root of this.roots) {
      if (!within(root, path)) continue;
      return relative(root, path).split(/[/\\]/u).some((segment) => ignoredDirectories.has(segment));
    }
    return true;
  }
}

export class WorkspaceIndexCancelledError extends Error {
  constructor() {
    super("Workspace index request cancelled");
    this.name = "WorkspaceIndexCancelledError";
  }
}

function indexedDocument(path: string, text: string): IndexedDocument | null {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_WORKSPACE_TEXT_FILE_BYTES) return null;
  return { path, text, bytes };
}

function recordOverlayExclusion(activity: MutableActivity, exclusion: OpenDocumentOverlay["exclusion"]): void {
  if (exclusion === "large-file") activity.skippedLargeFiles += 1;
  else if (exclusion === "aggregate-budget") activity.skippedByAggregateBudget += 1;
}

function emptyActivity(): MutableActivity {
  return {
    filesRead: 0,
    skippedLargeFiles: 0,
    skippedByAggregateBudget: 0,
    changesReceived: 0,
    changeRoots: 0,
    recordsRemoved: 0,
  };
}

function changedBy(path: string, changes: ReadonlySet<string>, root: string): boolean {
  let current = path;
  for (let depth = 0; depth <= 65; depth += 1) {
    if (changes.has(current)) return true;
    if (current === root) return false;
    const parent = dirname(current);
    if (parent === current || !within(root, parent)) return false;
    current = parent;
  }
  throw new RangeError("A workspace index change cannot exceed 64 directory levels");
}

function lineStartsFor(text: string): readonly number[] {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\r") {
      if (text[index + 1] === "\n") index += 1;
      lineStarts.push(index + 1);
    } else if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return lineStarts;
}

/**
 * How far into its line the last position was, in code points. Advancing it
 * is only valid forward within one line, so a request that moves backwards or
 * changes line restarts it at that line's start.
 */
interface CodePointCursor {
  line: number;
  offset: number;
  count: number;
}

function positionAt(
  text: string,
  lineStarts: readonly number[],
  offset: number,
  cursor: CodePointCursor | null = null,
): WorkspaceIndexPosition {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle]! <= offset) low = middle;
    else high = middle;
  }
  const lineStart = lineStarts[low] ?? 0;
  if (cursor === null) {
    return { line: low, utf16Character: offset - lineStart, utf32Character: codePointCount(text, lineStart, offset) };
  }
  if (cursor.line !== low || cursor.offset > offset) {
    cursor.line = low;
    cursor.offset = lineStart;
    cursor.count = 0;
  }
  cursor.count += codePointCount(text, cursor.offset, offset);
  cursor.offset = offset;
  return { line: low, utf16Character: offset - lineStart, utf32Character: cursor.count };
}

function previewAt(text: string, lineStarts: readonly number[], lineIndex: number): string {
  const start = lineStarts[lineIndex] ?? 0;
  const next = lineStarts[lineIndex + 1] ?? text.length;
  const end = next > start && text[next - 1] === "\n"
    ? next > start + 1 && text[next - 2] === "\r" ? next - 2 : next - 1
    : next;
  const line = text.slice(start, end);
  if (line.length <= MAX_WORKSPACE_SEARCH_PREVIEW_CODE_UNITS) return line;
  let clipped = line.slice(0, MAX_WORKSPACE_SEARCH_PREVIEW_CODE_UNITS - 1);
  const final = clipped.charCodeAt(clipped.length - 1);
  if (final >= 0xd800 && final <= 0xdbff) clipped = clipped.slice(0, -1);
  return `${clipped}…`;
}

function codePointCount(text: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; count += 1) {
    const point = text.codePointAt(index);
    index += point !== undefined && point > 0xffff ? 2 : 1;
  }
  return count;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function yieldToHost(): Promise<void> {
  return new Promise((resolveYield) => setImmediate(resolveYield));
}
