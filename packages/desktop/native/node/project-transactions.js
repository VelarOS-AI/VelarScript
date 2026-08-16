import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { FileProjectChangeFeed } from "@velaros-ai/project/changes";
import { createProjectKernel } from "@velaros-ai/project/runtime";
import { createProjectTransactionController } from "@velaros-ai/project/transaction-controller";

const MAX_PROJECT_CHANGE_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_PROJECT_CHANGE_PAGE_BYTES = 32 * 1024 * 1024;
const MAX_PROJECT_CHANGE_ITEMS = 1_000;
const projectChangeLifecycles = new Set([
  "prepared",
  "amended",
  "validated",
  "validation_failed",
  "applied",
  "rolled_back",
  "discarded",
]);
const riskLevels = new Set(["low", "medium", "high"]);

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function text(value, label, maximumBytes, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.includes("\0") || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function optionalText(value, label, maximumBytes) {
  return value === undefined ? null : text(value, label, maximumBytes);
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${label} must be a safe integer`);
  return value;
}

function list(value, label) {
  if (!Array.isArray(value) || value.length > MAX_PROJECT_CHANGE_ITEMS) throw new TypeError(`${label} must be a bounded list`);
  return value;
}

function intentView(value) {
  value = record(value, "Project change intent");
  const operation = record(value.operation, "Project change operation");
  return Object.freeze({
    type: text(operation.type, "Project change operation type", 128),
    path: optionalText(operation.path, "Project change operation path", 4096),
    from: optionalText(operation.from, "Project change operation source path", 4096),
    to: optionalText(operation.to, "Project change operation target path", 4096),
    targetId: optionalText(value.targetId, "Project change target id", 512),
    reason: optionalText(value.reason, "Project change intent reason", 64 * 1024),
  });
}

function patchView(value) {
  value = record(value, "Project change patch");
  if (!riskLevels.has(value.risk)) throw new TypeError("Project change patch risk is invalid");
  return Object.freeze({
    patchId: text(value.patchId, "Project change patch id", 512),
    strategyId: text(value.strategyId, "Project change strategy id", 512),
    path: text(value.path, "Project change patch path", 4096),
    baseRevision: optionalText(value.baseRevision, "Project change patch base revision", 512),
    diff: text(value.diff, "Project change patch diff", MAX_PROJECT_CHANGE_RECORD_BYTES, true),
    changedLines: safeInteger(value.changedLines, "Project change patch changed lines"),
    risk: value.risk,
    operation: optionalText(value.operation, "Project change patch operation", 128),
  });
}

function revisionView(value) {
  value = record(value, "Project change revision");
  return Object.freeze({
    path: text(value.path, "Project change revision path", 4096),
    before: optionalText(value.before, "Project change prior revision", 512),
    after: optionalText(value.after, "Project change next revision", 512),
  });
}

export function desktopProjectChangeView(value) {
  value = record(value, "Project change");
  if (!projectChangeLifecycles.has(value.lifecycle)) throw new TypeError("Project change lifecycle is invalid");
  if (!riskLevels.has(value.risk)) throw new TypeError("Project change risk is invalid");
  const output = Object.freeze({
    transactionId: text(value.transactionId, "Project change transaction id", 512),
    sequence: safeInteger(value.sequence, "Project change sequence", 1),
    lifecycle: value.lifecycle,
    reason: optionalText(value.reason, "Project change reason", 64 * 1024),
    intents: Object.freeze(list(value.intents, "Project change intents").map(intentView)),
    patches: Object.freeze(list(value.patches, "Project change patches").map(patchView)),
    changedFiles: Object.freeze(list(value.changedFiles, "Project change files")
      .map((path) => text(path, "Project change file path", 4096))),
    diff: text(value.diff, "Project change diff", MAX_PROJECT_CHANGE_RECORD_BYTES, true),
    changedLines: safeInteger(value.changedLines, "Project change changed lines"),
    risk: value.risk,
    revisions: Object.freeze(list(value.revisions, "Project change revisions").map(revisionView)),
    createdAt: safeInteger(value.createdAt, "Project change creation time"),
    updatedAt: safeInteger(value.updatedAt, "Project change update time"),
    appliedAt: value.appliedAt === undefined ? null : safeInteger(value.appliedAt, "Project change apply time"),
  });
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_PROJECT_CHANGE_RECORD_BYTES) {
    throw new RangeError("Project change record exceeds 16 MiB");
  }
  return output;
}

export function desktopProjectChangePage(values, requestedLimit) {
  const limit = safeInteger(requestedLimit, "Project change page limit", 1);
  if (limit > 100) throw new RangeError("Project change page limit cannot exceed 100");
  const changes = [];
  let bytes = 0;
  let truncated = false;
  for (const value of values) {
    if (changes.length >= limit) { truncated = true; break; }
    const change = desktopProjectChangeView(value);
    const changeBytes = Buffer.byteLength(JSON.stringify(change), "utf8");
    if (bytes + changeBytes > MAX_PROJECT_CHANGE_PAGE_BYTES) { truncated = true; break; }
    changes.push(change);
    bytes += changeBytes;
  }
  return Object.freeze({ changes: Object.freeze(changes), truncated });
}

/**
 * One host-private owner per canonical project root. The renderer never sees
 * the root-derived key, state path, feed path, policy or underlying kernel.
 */
export async function createDesktopProjectTransactionOwner(projectRoot, appDataRoot) {
  const key = createHash("sha256").update(projectRoot).digest("hex");
  const directory = resolve(appDataRoot, "project-transactions", key);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const feed = new FileProjectChangeFeed({ path: resolve(directory, "changes.jsonl") });
  try {
    const project = await createProjectKernel({
      root: projectRoot,
      changeFeed: feed,
      transactionStatePath: resolve(directory, "transactions.json"),
      // Desktop's project grant is the outer write authority. The finite
      // apply/rollback call is already explicit and cannot choose an operation.
      corePolicy: { approval: { requireForHighRiskPatch: false } },
    });
    return {
      root: projectRoot,
      controller: createProjectTransactionController(project),
      close() { feed.close(); },
    };
  } catch (error) {
    feed.close();
    throw error;
  }
}
