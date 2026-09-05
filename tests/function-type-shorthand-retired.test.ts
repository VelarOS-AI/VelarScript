import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyMechanicalFixes, compile, formatSource } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";

/**
 * D114 ③: `Function`, `Function<R>` and `Function<A, …, R>` were a second
 * spelling of the arrow function type. The family is retired — a function type
 * has one spelling — so every type position reports the retirement, recovers as
 * the arrow the annotation meant, and names the mechanical rewrite.
 */

const retired = (message: string): boolean => /type shorthand is retired/u.test(message);

function retirements(source: string): { readonly message: string; readonly written: string; readonly title: string | undefined }[] {
  return compile(source).diagnostics
    .filter((item) => retired(item.message))
    .map((item) => ({ message: item.message, written: source.slice(item.span.start, item.span.end), title: item.fix?.title }));
}

test("every shorthand arity reports the retirement and names its arrow rewrite", () => {
  const source = [
    "type Cleanup = Function",
    "type Reader = Function<string>",
    "type Writer = Function<string, null>",
    "type Compare = Function<string, number, bool>",
    "",
  ].join("\n");
  const result = compile(source);

  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2012", "VEL2012", "VEL2012", "VEL2012"]);
  assert.deepEqual(result.diagnostics.map((item) => item.recovered), [true, true, true, true]);
  assert.deepEqual(result.diagnostics.map((item) => item.message), [
    "The 'Function' type shorthand is retired; a function type has one spelling, the arrow — write '() -> null'",
    "The 'Function<...>' type shorthand is retired; a function type has one spelling, the arrow — write '() -> string'",
    "The 'Function<...>' type shorthand is retired; a function type has one spelling, the arrow — write '(string) -> null'",
    "The 'Function<...>' type shorthand is retired; a function type has one spelling, the arrow — write '(string, number) -> bool'",
  ]);
  assert.deepEqual(result.diagnostics.map((item) => source.slice(item.span.start, item.span.end)), [
    "Function",
    "Function<string>",
    "Function<string, null>",
    "Function<string, number, bool>",
  ]);
  assert.equal(result.code, null, "a recovered guidance diagnostic still fails the build");

  assert.equal(applyMechanicalFixes(source, result.diagnostics).text, [
    "type Cleanup = () -> null",
    "type Reader = () -> string",
    "type Writer = (string) -> null",
    "type Compare = (string, number) -> bool",
    "",
  ].join("\n"));
});

test("the retirement recovers as the arrow type, so analysis continues in the same compile", () => {
  const result = compile([
    "type Reader = Function<string>",
    "const reader: Reader = () => 7",
    "",
  ].join("\n"));

  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2012", "VEL4001"]);
  assert.ok(retired(result.diagnostics[0]!.message));
  assert.equal(result.diagnostics[1]!.message, "Cannot assign () -> number to () -> string");
});

test("a nested occurrence rewrites where it stands", () => {
  const source = [
    "const handlers: List<Function<string>> = []",
    "const nested: Function<Function<string>, number> = fn => fn().size",
    "type Pair:",
    "    close: Function",
    "class Terminal:",
    "    let onClose: Function<string, null> = value => print(value)",
    "def apply(transform: Function<string, number>) -> number:",
    "    return transform(\"ab\")",
    "",
  ].join("\n");

  assert.deepEqual(retirements(source).map((item) => item.written), [
    "Function<string>",
    "Function<Function<string>, number>",
    "Function<string>",
    "Function",
    "Function<string, null>",
    "Function<string, number>",
  ]);
  // The parser recovers bottom-up, so the enclosing rewrite already carries the
  // rewritten inner one and a single `velar fix` pass settles the file.
  const fixed = applyMechanicalFixes(source, compile(source).diagnostics);
  assert.equal(fixed.text, [
    "const handlers: List<() -> string> = []",
    "const nested: (() -> string) -> number = fn => fn().size",
    "type Pair:",
    "    close: () -> null",
    "class Terminal:",
    "    let onClose: (string) -> null = value => print(value)",
    "def apply(transform: (string) -> number) -> number:",
    "    return transform(\"ab\")",
    "",
  ].join("\n"));
  assert.deepEqual(compile(fixed.text).diagnostics, []);
});

test("an extern contract written with the shorthand rewrites too", () => {
  const source = [
    'extern module "node:timers":',
    "    export def setTimeout(handler: Function, delay: number) -> number",
    "    export def setInterval(handler: Function<number, null>, delay: number) -> number",
    "",
  ].join("\n");
  assert.deepEqual(retirements(source).map((item) => item.written), ["Function", "Function<number, null>"]);
  assert.equal(applyMechanicalFixes(source, compile(source).diagnostics).text, [
    'extern module "node:timers":',
    "    export def setTimeout(handler: () -> null, delay: number) -> number",
    "    export def setInterval(handler: (number) -> null, delay: number) -> number",
    "",
  ].join("\n"));
});

test("a module that exports an alias written with the shorthand fixes cleanly", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-function-shorthand-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const libraryPath = join(directory, "library.vel");
  const consumerPath = join(directory, "consumer.vel");

  const librarySource = [
    "export type Transform = Function<string, number>",
    "export const transform: Transform = value => value.size",
    "",
  ].join("\n");
  const fixed = applyMechanicalFixes(librarySource, compile(librarySource).diagnostics);
  assert.equal(fixed.text, [
    "export type Transform = (string) -> number",
    "export const transform: Transform = value => value.size",
    "",
  ].join("\n"));

  await writeFile(libraryPath, fixed.text, "utf8");
  await writeFile(consumerPath, [
    'import {Transform, transform} from "./library.vel"',
    "",
    "const canonical: (string) -> number = transform",
    "const wrapped: Transform = canonical",
    'print(str(wrapped("Velar")))',
    "",
  ].join("\n"), "utf8");

  const project = await compileProject(consumerPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const symbols = project.modules.find((module) => module.inputPath === consumerPath)?.result.semanticIndex.symbols;
  assert.equal(symbols?.find((item) => item.name === "wrapped")?.type, "(string) -> number");
});

test("'Function<>' stays the invalid form and names the arrow without a rewrite", () => {
  const result = compile("const callback: Function<> = () => null\n");
  assert.deepEqual(result.diagnostics.map((item) => ({ code: item.code, message: item.message, fix: item.fix })), [
    {
      code: "VEL2012",
      message: "'Function<>' names no type; a function type is written as an arrow — '() -> null' takes no input and answers null",
      fix: undefined,
    },
  ]);
});

test("the retired name is not a value, and bare Promise is untouched", () => {
  assert.ok(compile("Function()\n").diagnostics.some((item) => item.message === "Unknown name 'Function'"));

  const promise = compile([
    "async def save():",
    "    pass",
    "",
    "type Done = Promise",
    "const pending: Done = save()",
    "await pending",
    "",
  ].join("\n"));
  assert.deepEqual(promise.diagnostics, []);
});

test("the formatter is untouched: it still spaces the retired spelling as type syntax", () => {
  const formatted = formatSource("const callback: Function < string, number, bool > = (text, size) => true\n");
  assert.equal(formatted, "const callback: Function<string, number, bool> = (text, size) => true\n");
  assert.equal(formatSource(formatted), formatted);
});
