import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../../packages/cli/src/project.ts";
import { projectSymbolAt } from "../../packages/cli/src/project-semantic.ts";

/**
 * What a class member declaration publishes about itself.
 *
 * A `def` at module level publishes its callable type at the span it is
 * declared on, and the hover reads it back from there. A method published
 * nothing: the symbol carried a name, a kind and a container, and no type at
 * all — so the hover showed `method push` with no signature, and the
 * bound-constraint display D114 I-I2 built had no type to render. The class
 * shape already holds the callable type of every method; the declaration
 * symbol now reads it from there rather than going without.
 *
 * The reference display is the module-level `def` in each of these programs:
 * the assertion below it is the same shape, which is the point.
 */

const source = `class Stack<T: Comparable>:
    private let items: List<T> = []

    def push(value: T): self.items.append(value)

    def top() -> T?:
        return self.items[0]

    get size() -> number:
        return self.items.size

    private def holds(value: T) -> bool:
        return self.items.has(value)

    static def empty() -> number:
        return 0

    def convert<U: Comparable>(select: (T) -> U) -> List<U>:
        return self.items.map(select)

def free<T: Comparable>(values: List<T>) -> T?:
    return values[0]

const stack: Stack<number> = Stack()
stack.push(1)
print(str(stack.top()))
print(str(stack.size))
print(str(Stack.empty()))
print(str(free([1, 2])))
print(Json.stringify(stack.convert((value) => value)))
`;

/**
 * The language server's own hover line, so each assertion reads what the author
 * sees rather than an internal shape.
 */
async function hovers(): Promise<{
  readonly hover: (needle: string, offset: number) => string | null;
  readonly close: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "velar-method-symbol-"));
  const path = join(directory, "main.vel");
  await writeFile(path, source, "utf8");
  const project = await compileProject(path, new Map(), {});
  assert.deepEqual(
    project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)),
    [],
  );
  return {
    hover: (needle, offset) => {
      const symbol = projectSymbolAt(project, path, source.indexOf(needle) + offset);
      return symbol === null ? null : `${symbol.kind} ${symbol.name}${symbol.type ? `: ${symbol.type}` : ""}`;
    },
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

test("[F4] a method declaration publishes the callable type its class computed", async () => {
  const { hover, close } = await hovers();
  try {
    assert.equal(hover("def free", 5), "function free: <T: Comparable>(values: List<T>) -> T?");
    assert.equal(hover("def push", 5), "method push: (value: T) -> null");
    assert.equal(hover("def top", 5), "method top: () -> T?");
  } finally {
    await close();
  }
});

test("[F4] a static method and a private method publish theirs too", async () => {
  const { hover, close } = await hovers();
  try {
    assert.equal(hover("static def empty", 12), "method empty: () -> number");
    assert.equal(hover("private def holds", 13), "method holds: (value: T) -> bool");
  } finally {
    await close();
  }
});

test("[F4] a getter publishes what reading it answers with", async () => {
  const { hover, close } = await hovers();
  try {
    // A getter is a field position, not a callable one, so it publishes the
    // result rather than a signature — which is what the class shape stored.
    assert.equal(hover("get size", 5), "field size: number");
  } finally {
    await close();
  }
});

test("[F4] a generic method on a generic class shows its parameters and their bounds", async () => {
  const { hover, close } = await hovers();
  try {
    // D114 F2's declaration/type split reaches methods: a *declaration* shows
    // the list the author wrote, bounds included. `describeType` still erases
    // them everywhere else, which is why `free` above reads the same way.
    assert.equal(hover("def convert", 5), "method convert: <U: Comparable>(select: (T) -> U) -> List<U>");
  } finally {
    await close();
  }
});

test("[F4] a method's declaration symbol answers the same type the checker resolved", async () => {
  // The point of reading the type back from the class shape rather than
  // recomputing it: the hover cannot describe a member the checker resolved
  // differently, because there is only one answer to describe.
  const directory = await mkdtemp(join(tmpdir(), "velar-method-symbol-inferred-"));
  try {
    const path = join(directory, "main.vel");
    const inferred = `class Counter:
    private let count: number = 0

    def bump():
        self.count = self.count + 1

    def read():
        return self.count

const counter = Counter()
counter.bump()
print(str(counter.read()))
`;
    await writeFile(path, inferred, "utf8");
    const project = await compileProject(path, new Map(), {});
    assert.deepEqual(
      project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)),
      [],
    );
    const symbol = projectSymbolAt(project, path, inferred.indexOf("def read") + 5);
    // The result is inferred from the body, and the settled inference — not the
    // placeholder the declaration started with — is what the symbol carries.
    assert.equal(symbol?.type, "() -> number");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
