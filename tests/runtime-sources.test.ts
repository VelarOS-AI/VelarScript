import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateAllRuntimeSources, RUNTIME_PACKAGES } from "../scripts/generate-runtime-sources.mjs";

/**
 * D115 §一.4 / D114 R2, R2b, R2c and R2d — the JavaScript the packages emit is real source.
 *
 * The reason these assertions exist as a test and not only as a gate is that
 * the gate answers "is the transcription current"; this answers "is the source
 * JavaScript at all". Before the split, neither question could be asked: a
 * missing brace inside a `String.raw` template was a syntax error in every
 * program the compiler emitted, and the only thing that found it was whichever
 * acceptance test happened to run that helper.
 *
 * Every assertion is written over `RUNTIME_PACKAGES`, so a package root added to
 * the generator is covered here on the day it is added.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generated = await generateAllRuntimeSources(root);

/** The `src/` modules whose `String.raw` templates each package root replaced. */
const RETIRED_SOURCES: Readonly<Record<string, readonly string[]>> = {
  compiler: [
    "class-runtime.ts", "collection-runtime.ts", "collection-lowering-runtime.ts", "error-runtime.ts",
    "json-runtime.ts", "narrowing-runtime.ts", "number-runtime.ts", "primitive-runtime.ts",
    "promise-runtime.ts", "range-runtime.ts", "reactive-bridge-runtime.ts", "text-runtime.ts",
    "type-registry-runtime.ts", "type-validation-runtime.ts", "utf8-runtime.ts",
  ],
  core: ["hash-runtime.ts", "validation-runtime.ts"],
  desktop: [],
  web: [
    "browser-host-runtime.ts", "reactive-bridge-runtime.ts", "realtime-client-runtime.ts",
    "runtime-foundation.ts", "websocket-runtime.ts", "worker-runtime.ts",
  ],
  node: [
    "environment-runtime.ts", "filesystem-runtime.ts", "host-runtime.ts", "http-runtime.ts",
    "node-host-runtime.ts", "node-host-static-file-runtime.ts", "node-host-worker-runtime.ts",
    "process-runtime.ts", "process-worker-runtime.ts", "serve-listener-runtime.ts",
    "serve-runtime.ts", "serve-test-runtime.ts", "terminal-runtime.ts",
    "terminal-worker-runtime.ts", "websocket-runtime.ts", "worker-runtime.ts",
  ],
  server: ["realtime-runtime.ts"],
};

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

test("every package root the generator names has a manifest and a generated module", () => {
  assert.deepEqual([...generated.keys()], [...RUNTIME_PACKAGES]);
  for (const [name, sources] of generated) {
    assert.ok(existsSync(join(sources.base, "manifest.json")), `packages/${name}/runtime/manifest.json does not exist`);
    assert.ok(existsSync(sources.generated), `${sources.manifest.generated} does not exist`);
    assert.equal(sources.manifest.generator, "scripts/generate-runtime-sources.mjs");
    assert.equal(sources.manifest.gate, "scripts/check-runtime-sources.mjs");
    assert.ok(name in RETIRED_SOURCES, `packages/${name} has no retired-source roster in this test`);
  }
});

for (const [name, sources] of generated) {
  test(`packages/${name}: the generated runtime sources match a fresh generation`, () => {
    assert.deepEqual(sources.problems, [], "the runtime sources disagree with the constants they were resolved from");
    assert.equal(
      readFileSync(sources.generated, "utf8"),
      sources.text,
      "run `node scripts/generate-runtime-sources.mjs` and commit what it writes",
    );
  });

  test(`packages/${name}: every manifest entry names a file that exists and a constant that is generated`, async () => {
    const module = await import(sources.generated) as Record<string, unknown>;
    const constants = new Map(sources.manifest.constants.map((entry) => [entry.name, entry]));
    assert.ok(constants.size > 0, "the manifest declares no constants");
    for (const entry of sources.manifest.files) {
      assert.ok(existsSync(join(sources.base, entry.file)), `manifest names ${entry.file}, which does not exist`);
      assert.ok(constants.has(entry.constant), `${entry.file} names constant ${entry.constant}, which the manifest does not declare`);
      assert.ok(entry.family.length > 0, `${entry.file} declares no family`);
    }
    for (const entry of sources.manifest.constants) {
      assert.ok(entry.parts.length > 0, `${entry.name} is composed of nothing`);
      assert.ok(entry.name in module, `${entry.name} is declared by the manifest but not exported by the generated module`);
      assert.equal(module[entry.name], sources.values.get(entry.name), `${entry.name} in the generated module is not what the manifest assembles`);
    }
    const declared = new Set(sources.manifest.files.map((entry) => entry.file));
    for (const file of readdirSync(sources.base)) {
      if (!file.endsWith(".js")) continue;
      assert.ok(declared.has(file), `packages/${name}/runtime/${file} exists but no manifest entry names it`);
    }
  });

  test(`packages/${name}: every runtime source parses as JavaScript, in a module it belongs to`, () => {
    const covered = new Set<string>();
    // A constant an assembly is built from is a run of one module, cut at the
    // line above and below a grant. It is not a module, so its parse unit is the
    // assembled module below rather than itself.
    const fragments = new Set((sources.manifest.assemblies ?? [])
      .flatMap((entry) => entry.parts.flatMap((part) => "constant" in part ? [part.constant] : [])));
    for (const entry of sources.manifest.constants) {
      const parts = entry.parts.flatMap((part) => "file" in part ? [part.file] : []);
      for (const file of parts) covered.add(file);
      if (fragments.has(entry.name)) continue;
      if (parts.length === 1 && entry.parts.length === 1) {
        // A constant that is exactly one file: the file is a parse unit on its own.
        parses(sources.files.get(parts[0]!)!, `packages/${name}/runtime/${parts[0]}`);
      }
      // …and every constant is a parse unit, which is how an `export` block that
      // names a sibling's declarations gets checked at all.
      parses(sources.values.get(entry.name)!, entry.name);
    }
    // A module whose text is only complete at compile time is a parse unit with a
    // sample in each per-compilation hole; that is what covers a fragment cut at
    // the line above and below a grant, which cannot parse on its own.
    for (const entry of sources.manifest.assemblies ?? []) {
      parses(sources.assemblies.get(entry.name)!, entry.name);
      for (const part of entry.parts) {
        if (!("constant" in part)) continue;
        const constant = sources.manifest.constants.find((candidate) => candidate.name === part.constant);
        for (const inner of constant?.parts ?? []) if ("file" in inner) covered.add(inner.file);
      }
    }
    for (const entry of sources.manifest.files) {
      assert.ok(covered.has(entry.file), `packages/${name}/runtime/${entry.file} is in no parse unit`);
    }
  });

  test(`packages/${name}: no runtime source interpolates`, () => {
    for (const [file, source] of sources.files) {
      assert.equal(source.includes("${"), false, `packages/${name}/runtime/${file} interpolates; the text is emitted verbatim`);
      assert.notEqual(source, "", `packages/${name}/runtime/${file} is empty`);
    }
  });

  test(`packages/${name}: the runtime templates this package used to hold are gone`, () => {
    for (const file of RETIRED_SOURCES[name] ?? []) {
      const path = join(root, "packages", name, "src", file);
      assert.equal(existsSync(path), false, `packages/${name}/src/${file} still exists; the runtime source is packages/${name}/runtime/`);
    }
  });

  test(`packages/${name}: each runtime file declares the helpers it defines and the ones it expects from a sibling`, () => {
    const defined = new Map<string, Set<string>>();
    for (const entry of sources.manifest.files) {
      const family = defined.get(entry.family) ?? new Set<string>();
      for (const helper of entry.defines) {
        assert.equal(family.has(helper), false, `${entry.file} redeclares '${helper}' inside the ${entry.family} runtime`);
        family.add(helper);
      }
      defined.set(entry.family, family);
    }
    for (const entry of sources.manifest.files) {
      for (const helper of entry.requires) {
        assert.equal(entry.defines.includes(helper), false, `${entry.file} lists '${helper}' as both defined and required`);
      }
      for (const helper of entry.defines) {
        assert.ok(sources.files.get(entry.file)!.includes(helper), `${entry.file} claims to define '${helper}' and does not mention it`);
      }
    }
  });

  test(`packages/${name}: every constant a part borrows is one this package generates or imports`, () => {
    const own = new Set(sources.manifest.constants.map((entry) => entry.name));
    const borrowed = new Set(Object.values(sources.manifest.imports ?? {}).flat());
    for (const entry of [...sources.manifest.constants, ...sources.manifest.assemblies ?? []]) {
      for (const part of entry.parts) {
        // A `json` part borrows a constant too: it is that constant, encoded as
        // the string literal a module launching a Worker carries its source in.
        const name_ = "constant" in part ? part.constant : "json" in part ? part.json : undefined;
        if (name_ === undefined) continue;
        assert.ok(own.has(name_) || borrowed.has(name_), `${entry.name} borrows '${name_}', which is neither generated here nor imported`);
      }
      for (const part of entry.parts) {
        if (!("json" in part)) continue;
        assert.equal(
          sources.values.get(entry.name)?.includes(JSON.stringify(sources.values.get(part.json))),
          true,
          `${entry.name} does not carry ${part.json} as the string literal it was composed to hold`,
        );
      }
    }
    for (const [specifier, names] of Object.entries(sources.manifest.imports ?? {})) {
      for (const helper of names) {
        assert.equal(typeof sources.values.get(helper), "string", `${specifier} was to publish '${helper}' and did not`);
      }
    }
  });

  test(`packages/${name}: every assembled module names the TypeScript that puts its grants back`, () => {
    for (const entry of sources.manifest.assemblies ?? []) {
      const [file, symbol] = entry.assembled.split("#");
      assert.ok(symbol !== undefined && symbol.length > 0, `${entry.name} does not name the function that assembles it`);
      assert.ok(existsSync(join(root, file!)), `${entry.name} names ${file}, which does not exist`);
      const source = readFileSync(join(root, file!), "utf8");
      assert.ok(source.includes(`function ${symbol}`), `${file} does not declare ${symbol}`);
      for (const part of entry.parts) {
        if (!("constant" in part)) continue;
        assert.ok(source.includes(part.constant), `${file} does not use ${part.constant}, which ${entry.name} is assembled from`);
      }
      assert.ok(entry.parts.some((part) => "sample" in part), `${entry.name} has no per-compilation hole and is therefore an ordinary constant`);
    }
  });
}
