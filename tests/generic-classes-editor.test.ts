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

test("[F2] every generic declaration hover shows the parameter list the author wrote", async () => {
  // D114 0.28.0 I-I2 gave the class its parameters and left two halves of the
  // same rule undone: a record declaration hovered as `type Box: Box`, and a
  // `def` published `<T>` where the class beside it published `<T: Comparable>`
  // — `describeType` erases bounds, and the class did not go through it. One
  // rule now: a *declaration* shows the list as declared, bounds included; a
  // *type* display keeps erasing them, so `describeType` is untouched and a
  // binding still hovers as its instantiation.
  const directory = await mkdtemp(join(tmpdir(), "velar-generic-declaration-hover-"));
  try {
    const path = join(directory, "main.vel");
    const source = `type Box<T>:
    value: T

type Plain:
    label: string

class Ranked<T: Comparable>:
    private let items: List<T> = []

    def add(value: T): self.items.append(value)

def top<T: Comparable>(values: List<T>) -> T?:
    return values.max()

def empty<U>() -> List<U>:
    return []

const boxed: Box<number> = {value: 1}
const ranked: Ranked<number> = Ranked()
ranked.add(2)
print(f"{top([1, 2]) ?? 0} {empty().size} {boxed.value}")
`;
    await writeFile(path, source, "utf8");
    const project = await compileProject(path, new Map(), {});
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)), []);
    const hover = (needle: string, offset: number): string | null => {
      const symbol = projectSymbolAt(project, path, source.indexOf(needle) + offset);
      return symbol === null ? null : `${symbol.kind} ${symbol.name}${symbol.type ? `: ${symbol.type}` : ""}`;
    };
    assert.equal(hover("type Box", 6), "type Box: Box<T>");
    assert.equal(hover("type Plain", 6), "type Plain: Plain");
    assert.equal(hover("class Ranked", 7), "class Ranked: Ranked<T: Comparable>");
    assert.equal(hover("def top", 5), "function top: <T: Comparable>(values: List<T>) -> T?");
    // A declaration with no bound is unchanged, and so is a binding's type.
    assert.equal(hover("def empty", 5), "function empty: <U>() -> List<U>");
    assert.equal(hover("const boxed", 8), "variable boxed: Box<number>");
    assert.equal(hover("const ranked", 8), "variable ranked: Ranked<number>");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
