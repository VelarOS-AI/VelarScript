import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectSymbolAt } from "../packages/cli/src/project-semantic.ts";

// Editor-facing behaviour of generic classes: what the language server shows.
// The declaration and inference rules live in generic-classes.test.ts; this
// file holds the hover/completion surface so neither exceeds the file budget.

test("[I-I2] the hover on a generic class carries its type parameters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-generic-class-hover-"));
  try {
    const path = join(directory, "main.vel");
    const source = `class Ranked<T: Comparable, U>:
    private let items: List<T> = []

    def add(value: T, label: U): self.items.append(value)

class Plain:
    def go(): print("plain")

const ranked: Ranked<number, string> = Ranked()
ranked.add(2, "two")
Plain().go()
`;
    await writeFile(path, source, "utf8");
    const project = await compileProject(path, new Map(), {});
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)), []);
    // The language server's own hover line, so this reads what the author sees.
    const hover = (offset: number): string | null => {
      const symbol = projectSymbolAt(project, path, offset);
      return symbol === null ? null : `${symbol.kind} ${symbol.name}${symbol.type ? `: ${symbol.type}` : ""}`;
    };
    assert.equal(hover(source.indexOf("class Ranked") + 8), "class Ranked: Ranked<T: Comparable, U>");
    // A construction resolves to the same declaration symbol, which is why one
    // display answers both of the positions the audit found empty.
    assert.equal(hover(source.indexOf("= Ranked()") + 3), "class Ranked: Ranked<T: Comparable, U>");
    // A class with no type parameters keeps the display its binding describes.
    assert.equal(hover(source.indexOf("class Plain") + 8), "class Plain: Plain");
    // The binding position was already right and stays the instantiation.
    assert.equal(hover(source.indexOf("const ranked") + 8), "variable ranked: Ranked<number, string>");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
