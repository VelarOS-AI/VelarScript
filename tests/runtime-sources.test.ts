import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateRuntimeSources } from "../scripts/generate-runtime-sources.mjs";
import * as generatedConstants from "../packages/compiler/src/runtime-sources.generated.ts";

/**
 * D115 §一.4 / D114 R2 — the JavaScript the compiler emits is real source.
 *
 * The reason these assertions exist as a test and not only as a gate is that
 * the gate answers "is the transcription current"; this answers "is the source
 * JavaScript at all". Before the split, neither question could be asked: a
 * missing brace inside a `String.raw` template was a syntax error in every
 * program the compiler emitted, and the only thing that found it was whichever
 * acceptance test happened to run that helper.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDirectory = join(root, "packages", "compiler", "runtime");
const generated = await generateRuntimeSources(root);

/** `node --check`, on a file whose extension makes the parse an ESM parse. */
function parses(source: string, label: string): void {
  const scratch = mkdtempSync(join(tmpdir(), "velar-runtime-parse-"));
  try {
    const file = join(scratch, "unit.mjs");
    writeFileSync(file, source, "utf8");
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${label} is not parseable JavaScript:\n${result.stderr}`);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

test("the generated runtime sources match a fresh generation", () => {
  assert.deepEqual(generated.problems, [], "the runtime sources disagree with the constants they were resolved from");
  const committed = readFileSync(join(root, "packages", "compiler", "src", "runtime-sources.generated.ts"), "utf8");
  assert.equal(committed, generated.text, "run `node scripts/generate-runtime-sources.mjs` and commit what it writes");
});

test("every manifest entry names a file that exists and a constant that is generated", () => {
  const constants = new Map(generated.manifest.constants.map((entry) => [entry.name, entry]));
  assert.ok(constants.size > 0, "the manifest declares no constants");
  for (const entry of generated.manifest.files) {
    assert.ok(existsSync(join(runtimeDirectory, entry.file)), `manifest names ${entry.file}, which does not exist`);
    assert.ok(constants.has(entry.constant), `${entry.file} names constant ${entry.constant}, which the manifest does not declare`);
    assert.ok(entry.family.length > 0, `${entry.file} declares no family`);
  }
  for (const entry of generated.manifest.constants) {
    assert.ok(entry.parts.length > 0, `${entry.name} is composed of nothing`);
    assert.ok(entry.name in generatedConstants, `${entry.name} is declared by the manifest but not exported by the generated module`);
    assert.equal(
      (generatedConstants as Record<string, string>)[entry.name],
      generated.values.get(entry.name),
      `${entry.name} in the generated module is not what the manifest assembles`,
    );
  }
  const declared = new Set(generated.manifest.files.map((entry) => entry.file));
  for (const name of readdirSync(runtimeDirectory)) {
    if (!name.endsWith(".js")) continue;
    assert.ok(declared.has(name), `packages/compiler/runtime/${name} exists but no manifest entry names it`);
  }
});

test("every runtime source parses as JavaScript, in the module it belongs to", () => {
  const covered = new Set<string>();
  for (const entry of generated.manifest.constants) {
    const parts = entry.parts.flatMap((part) => "file" in part ? [part.file] : []);
    if (parts.length === 1 && entry.parts.length === 1) {
      // A constant that is exactly one file: the file is a parse unit on its own.
      parses(generated.files.get(parts[0]!)!, `packages/compiler/runtime/${parts[0]}`);
    }
    // …and every constant is a parse unit, which is how an `export` block that
    // names a sibling's declarations gets checked at all.
    parses(generated.values.get(entry.name)!, entry.name);
    for (const file of parts) covered.add(file);
  }
  for (const entry of generated.manifest.files) {
    assert.ok(covered.has(entry.file), `packages/compiler/runtime/${entry.file} is in no parse unit`);
  }
});

test("no runtime source interpolates", () => {
  for (const [file, source] of generated.files) {
    assert.equal(source.includes("${"), false, `packages/compiler/runtime/${file} interpolates; the text is emitted verbatim`);
    assert.notEqual(source, "", `packages/compiler/runtime/${file} is empty`);
  }
});

test("the runtime templates the compiler used to hold are gone", () => {
  for (const name of [
    "class", "collection", "collection-lowering", "error", "json", "narrowing", "number", "primitive",
    "promise", "range", "reactive-bridge", "text", "type-registry", "type-validation", "utf8",
  ]) {
    const path = join(root, "packages", "compiler", "src", `${name}-runtime.ts`);
    assert.equal(existsSync(path), false, `packages/compiler/src/${name}-runtime.ts still exists; the runtime source is packages/compiler/runtime/`);
  }
});

test("each runtime file declares the helpers it defines and the ones it expects from a sibling", () => {
  const defined = new Map<string, Set<string>>();
  for (const entry of generated.manifest.files) {
    const family = defined.get(entry.family) ?? new Set<string>();
    for (const name of entry.defines) {
      assert.equal(family.has(name), false, `${entry.file} redeclares '${name}' inside the ${entry.family} runtime`);
      family.add(name);
    }
    defined.set(entry.family, family);
  }
  for (const entry of generated.manifest.files) {
    for (const name of entry.requires) {
      assert.equal(entry.defines.includes(name), false, `${entry.file} lists '${name}' as both defined and required`);
    }
    for (const name of entry.defines) {
      assert.ok(generated.files.get(entry.file)!.includes(name), `${entry.file} claims to define '${name}' and does not mention it`);
    }
  }
});
