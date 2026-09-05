import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const gatePath = fileURLToPath(new URL("../scripts/check-fence-format.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * D114 — the documents that state the language hold their examples in the
 * language's one formatted form.
 *
 * A gate is a claim about a repository, and an unexercised gate is the weakest
 * kind: this file points `check-fence-format.mjs` at small fixture documents
 * and watches each of its verdicts, so a change that made it pass vacuously
 * would go red here rather than in a release.
 */

interface Fixture {
  readonly path: string;
  read(): Promise<string>;
  run(...args: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string };
}

async function fixture(markdown: string): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "velar-fence-format-"));
  const path = join(directory, "document.md");
  await writeFile(path, markdown, "utf8");
  return {
    path,
    read: () => readFile(path, "utf8"),
    run(...args) {
      const result = spawnSync(process.execPath, [gatePath, ...args, path], { cwd: repositoryRoot, encoding: "utf8" });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
  };
}

const NON_CANONICAL = `Prose above the fence.

\`\`\`velar
def run():
    print("ready")
\`\`\`

Prose below the fence.
`;

const CANONICAL = `Prose above the fence.

\`\`\`velar
def run(): print("ready")
\`\`\`

Prose below the fence.
`;

test("a fence the formatter would rewrite is reported, and --write rewrites it", async () => {
  const document = await fixture(NON_CANONICAL);
  try {
    const reported = document.run();
    assert.equal(reported.status, 1);
    assert.match(reported.stderr, /document\.md:3: this fence is not in canonical `velar format` form/u);
    // Reporting alone changes nothing: the document is the one it read.
    assert.equal(await document.read(), NON_CANONICAL);

    const written = document.run("--write");
    assert.equal(written.status, 0);
    assert.match(written.stdout, /Rewrote 1 of 1 VelarScript documentation fences/u);
    assert.equal(await document.read(), CANONICAL);

    // The rewrite is a fixed point, which is what makes the gate stable.
    const again = document.run();
    assert.equal(again.status, 0);
    assert.match(again.stdout, /Checked 1 VelarScript documentation fences; every one is in canonical `velar format` form/u);
  } finally {
    await rm(join(document.path, ".."), { recursive: true, force: true });
  }
});

test("a fence already in canonical form passes and is left byte-identical", async () => {
  const document = await fixture(CANONICAL);
  try {
    const checked = document.run();
    assert.equal(checked.status, 0);
    assert.match(checked.stdout, /Checked 1 VelarScript documentation fences/u);
    const written = document.run("--write");
    assert.equal(written.status, 0);
    assert.match(written.stdout, /All 1 VelarScript documentation fences were already in canonical `velar format` form/u);
    assert.equal(await document.read(), CANONICAL);
  } finally {
    await rm(join(document.path, ".."), { recursive: true, force: true });
  }
});

test("a fence that does not parse is reported as unparsed and left alone", async () => {
  // The formatter answers source it cannot parse with that source unchanged,
  // so "already canonical" and "never parsed" look identical from the text.
  // They are two different failures with two different fixes.
  const unparsed = `\`\`\`velar
def run(
\`\`\`
`;
  const document = await fixture(unparsed);
  try {
    const reported = document.run();
    assert.equal(reported.status, 1);
    assert.match(reported.stderr, /document\.md:1: this fence does not parse, so the formatter left it unchanged/u);
    const written = document.run("--write");
    assert.equal(written.status, 1);
    assert.equal(await document.read(), unparsed, "a fence the gate could not read must not be rewritten");
  } finally {
    await rm(join(document.path, ".."), { recursive: true, force: true });
  }
});

test("a fragment is formatted behind its declared preamble", async () => {
  // A fragment that borrows a name does not parse on its own, so without the
  // preamble the formatter would hand it back unchanged and the gate would
  // call an unformatted fence canonical.
  const document = await fixture(`<!-- velar-preamble
const ready = true

def start():
    pass
-->
\`\`\`velar fragment
if ready:
    start()
\`\`\`
`);
  try {
    assert.equal(document.run().status, 1);
    assert.equal(document.run("--write").status, 0);
    const rewritten = await document.read();
    assert.match(rewritten, /```velar fragment\nif ready: start\(\)\n```/u);
    // The preamble itself is context, not content: it is not rewritten into
    // the fence, and it is still the preamble the next run reads.
    assert.match(rewritten, /<!-- velar-preamble\nconst ready = true\n\ndef start\(\):\n    pass\n-->/u);
    assert.equal(document.run().status, 0);
  } finally {
    await rm(join(document.path, ".."), { recursive: true, force: true });
  }
});

test("the gate is wired into gate:check after check:docs", async () => {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(manifest.scripts["check:fence-format"], "node scripts/check-fence-format.mjs");
  const gate = manifest.scripts["gate:check"] ?? "";
  const docs = gate.indexOf("npm run check:docs");
  const fenceFormat = gate.indexOf("npm run check:fence-format");
  assert.ok(docs >= 0 && fenceFormat > docs, `gate:check must run check:fence-format after check:docs: ${gate}`);
});
