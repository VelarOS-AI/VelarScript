import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D114 0.29.0 LC-D1. `publicConfig(Type)` is a *build input*: the same run reads
// `velar.json` and compiles the module, and web-api says the value is "baked
// into the content-hashed application entry at build time". Both sides were in
// the compiler's hands and nothing put them together, so a manifest that did
// not satisfy the declared type compiled clean —
//
//   --- check with NO publicConfig in velar.json ---
//   Checked 1 module from /…/cfg
//   --- build ---
//   Built readable Web app -> /…/cfg/dist
//
// — and then failed at run time, during *module evaluation*, ahead of `@main`:
//
//   HOST-UNCAUGHT: Value does not match RuntimeConfig — field 'apiBase' is missing
//
// That is earlier than `velar/app`'s error chain exists, so the accessible fatal
// state web-api promises for a failed initial render never got its turn. The
// user got a blank page.
//
// The proof is now at the call site, in the runtime validator's own sentence,
// with the two edits that fix it. Runtime validation stays, because a manifest
// a build baked in can be hand-edited afterwards — this only moves the answer
// to where the mistake is.

const CONFIG_TYPES = `import {publicConfig} from "velar/config"

type Features:
    realtime: bool

type RuntimeConfig:
    apiBase: string
    releaseChannel: string
    features: Features
    label: string?
`;

const MAIN = (declaration: string): string => `${CONFIG_TYPES}
${declaration}

component App():
    return <p>hi</p>

@main: mount(<App />, "#app")
`;

/**
 * Compiles one module against a `web` manifest section, the way the CLI does:
 * `extensionConfig` is what `velar.json` parsed to, and it reaches analysis
 * through the compile the project driver runs.
 */
async function check(main: string, publicConfig?: Readonly<Record<string, unknown>>): Promise<readonly string[]> {
  const directory = await mkdtemp(join(tmpdir(), "velar-lc-d1-"));
  try {
    const entry = join(directory, "main.vel");
    const project = await compileProject(entry, new Map([[entry, main]]), {
      extensions: [velarCompilerExtension],
      extensionConfig: new Map<string, unknown>([[
        "@velarscript/web",
        publicConfig === undefined ? { title: "probe" } : { title: "probe", publicConfig },
      ]]),
    });
    assert.deepEqual(project.failures.map((item) => item.message), []);
    return project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const REMEDY = " 'publicConfig' reads the manifest's 'web.publicConfig', which this build bakes into the application entry,"
  + " so the value is already known here: add the field to 'web.publicConfig' in velar.json, or widen the declared type";

const satisfied = { apiBase: "/api", releaseChannel: "beta", features: { realtime: false } };

test("[LC-D1] a manifest with no publicConfig at all is the missing-field case", async () => {
  assert.deepEqual(await check(MAIN("const config = publicConfig(RuntimeConfig)")), [
    `VEL5080 Value does not match RuntimeConfig — field 'apiBase' is missing.${REMEDY}`,
  ]);
});

test("[LC-D1] a missing field is named", async () => {
  assert.deepEqual(await check(MAIN("const config = publicConfig(RuntimeConfig)"), { apiBase: "/api" }), [
    `VEL5080 Value does not match RuntimeConfig — field 'releaseChannel' is missing.${REMEDY}`,
  ]);
});

test("[LC-D1] a field of the wrong type is named", async () => {
  assert.deepEqual(await check(MAIN("const config = publicConfig(RuntimeConfig)"), {
    ...satisfied,
    releaseChannel: 123,
  }), [
    `VEL5080 Value does not match RuntimeConfig — field 'releaseChannel' does not match string.${REMEDY}`,
  ]);
});

test("[LC-D1] a nested record field is named by its path", async () => {
  assert.deepEqual(await check(MAIN("const config = publicConfig(RuntimeConfig)"), {
    ...satisfied,
    features: {},
  }), [
    `VEL5080 Value does not match RuntimeConfig — field 'features.realtime' is missing.${REMEDY}`,
  ]);
  assert.deepEqual(await check(MAIN("const config = publicConfig(RuntimeConfig)"), {
    ...satisfied,
    features: { realtime: "yes" },
  }), [
    `VEL5080 Value does not match RuntimeConfig — field 'features.realtime' does not match bool.${REMEDY}`,
  ]);
});

test("[LC-D1] an absent optional field is not a mismatch", async () => {
  // `label: string?` is declared and the manifest omits it, which is what an
  // optional field is for.
  assert.deepEqual(await check(MAIN("const config = publicConfig(RuntimeConfig)"), satisfied), []);
});

test("[LC-D1] a manifest that satisfies the type is silent", async () => {
  assert.deepEqual(await check(MAIN("const config = publicConfig(RuntimeConfig)"), {
    ...satisfied,
    label: "beta",
  }), []);
});

test("[LC-D1] a runtime type the call does not name makes no build-time claim", async () => {
  // A qualified type carries no spelling for the diagnostic to quote and no
  // claim the compile can hold to, so this stays the runtime's case.
  const directory = await mkdtemp(join(tmpdir(), "velar-lc-d1-ns-"));
  try {
    const entry = join(directory, "main.vel");
    const shapes = join(directory, "shapes.vel");
    const project = await compileProject(entry, new Map([
      [shapes, "export type RuntimeConfig:\n    apiBase: string\n"],
      [entry, `import {publicConfig} from "velar/config"
import * as shapes from "./shapes.vel"

const config = publicConfig(shapes.RuntimeConfig)

component App():
    return <p>{config.apiBase}</p>

@main: mount(<App />, "#app")
`],
    ]), {
      extensions: [velarCompilerExtension],
      extensionConfig: new Map<string, unknown>([["@velarscript/web", { title: "probe" }]]),
    });
    assert.deepEqual(project.failures.map((item) => item.message), []);
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics.map((item) => item.code)), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[LC-D1] a compile with no project manifest makes no claim either", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-lc-d1-bare-"));
  try {
    const entry = join(directory, "main.vel");
    // No `extensionConfig`: there is no manifest, so there is nothing to check
    // against — which is not the same as an empty section, and must stay silent.
    const project = await compileProject(entry, new Map([[entry, MAIN("const config = publicConfig(RuntimeConfig)")]]), {
      extensions: [velarCompilerExtension],
    });
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics.map((item) => item.code)), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
