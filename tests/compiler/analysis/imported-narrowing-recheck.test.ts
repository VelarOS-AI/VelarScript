import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * D115 P5 — the flow audit's blocker across module boundaries, one subject of
 * the file that was `class-and-core-correctness.test.ts` before it reached
 * 1,167 lines.
 *
 * Batch N-1 (audit fix wave, core correctness): the flow audit's blocker
 * (FLW-U1, with the first multi-module narrowing coverage). Every test here
 * writes a real multi-module project to disk and runs its entry through the
 * CLI, because a single-module compile is exactly what could not see the
 * defect. The bodies below are the bodies that file had.
 */

const cliPath = fileURLToPath(new URL("../../../packages/cli/src/cli.ts", import.meta.url));

/** Writes a multi-module fixture to disk and runs its entry through the CLI. */
async function runProject(
  modules: Readonly<Record<string, string>>,
  entry: string,
): Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }> {
  const directory = await mkdtemp(join(tmpdir(), "velar-audit-core-"));
  try {
    for (const [name, text] of Object.entries(modules)) {
      await writeFile(join(directory, name), text, "utf8");
    }
    const execution = spawnSync(process.execPath, [cliPath, "run", join(directory, entry)], {
      encoding: "utf8",
      timeout: 120_000,
    });
    return { status: execution.status, stdout: String(execution.stdout), stderr: String(execution.stderr) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// FLW-U1: the first multi-module narrowing coverage. Every existing narrowing
// test compiles a single module, which is why the imported-record recheck
// could degrade to a presence-only check without any test noticing.
// ---------------------------------------------------------------------------

const NARROWING_ERROR = /NarrowingError: Flow narrowing for '\.\w+' no longer holds: expected /u;

test("[FLW-U1] an imported record inside a union throws NarrowingError instead of delivering wrong data", async () => {
  // The audit's mod3 repro printed `Error` where a `User` was promised and
  // exited 0. The recheck now routes through the imported validator.
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Slot:
    value: User | Error

export def replace(slot: Slot):
    slot.value = Error("boom")
    return null
`.trimStart(),
    "main.vel": `
import {User, Slot, replace} from "./shared.vel"

const s: Slot = {value: {name: "Ada"}}
if s.value is User:
    replace(s)
    print(s.value.name)
`.trimStart(),
  }, "main.vel");
  assert.notEqual(execution.status, 0, execution.stdout);
  assert.match(execution.stderr, NARROWING_ERROR);
  assert.match(execution.stderr, /expected User/u);
  assert.doesNotMatch(execution.stdout, /Error/u);
});

test("[FLW-U1] an imported record narrowed from unknown rechecks deeply instead of presence-only", async () => {
  // The other audited leak: a bare host TypeError from
  // `h.payload.name.upper()` after the payload was swapped for a number.
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Holder:
    payload: unknown

export def swap(h: Holder):
    h.payload = 5
    return null
`.trimStart(),
    "main.vel": `
import {User, Holder, swap} from "./shared.vel"

const h: Holder = {payload: {name: "Ada"}}
if h.payload is User:
    swap(h)
    print(h.payload.name.upper())
`.trimStart(),
  }, "main.vel");
  assert.notEqual(execution.status, 0, execution.stdout);
  assert.match(execution.stderr, NARROWING_ERROR);
  assert.doesNotMatch(execution.stderr, /String methods require a string receiver/u);
});

test("[FLW-U1] a List of an imported record rechecks its elements", async () => {
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Bag:
    items: unknown

export def corrupt(b: Bag):
    b.items = [5]
    return null
`.trimStart(),
    "main.vel": `
import {User, Bag, corrupt} from "./shared.vel"

const b: Bag = {items: [{name: "Ada"}]}
if b.items is List<User>:
    corrupt(b)
    for item in b.items:
        print(item.name)
`.trimStart(),
  }, "main.vel");
  assert.notEqual(execution.status, 0, execution.stdout);
  assert.match(execution.stderr, /expected List<User>/u);
});

test("[FLW-U1] a local alias of an imported record rechecks with the imported validator", async () => {
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Holder:
    payload: unknown

export def swap(h: Holder):
    h.payload = 5
    return null
`.trimStart(),
    "main.vel": `
import {User, Holder, swap} from "./shared.vel"

type U2 = User

const h: Holder = {payload: {name: "Ada"}}
if h.payload is U2:
    swap(h)
    print(h.payload.name.upper())
`.trimStart(),
  }, "main.vel");
  assert.notEqual(execution.status, 0, execution.stdout);
  assert.match(execution.stderr, NARROWING_ERROR);
});

test("[FLW-U1] imported class and enum rechecks stay correct (pinned)", async () => {
  const shared = `
export class Robot:
    const name: string

    constructor(name: string):
        self.name = name

export enum Mode:
    fast
    slow

export type Cell:
    value: unknown

export def wipe(c: Cell):
    c.value = "gone"
    return null
`.trimStart();
  const importedClass = await runProject({
    "shared.vel": shared,
    "main.vel": `
import {Robot, Mode, Cell, wipe} from "./shared.vel"

const c: Cell = {value: Robot("r2")}
if c.value is Robot:
    wipe(c)
    print(c.value.name)
`.trimStart(),
  }, "main.vel");
  assert.notEqual(importedClass.status, 0, importedClass.stdout);
  assert.match(importedClass.stderr, /expected Robot/u);

  const importedEnum = await runProject({
    "shared.vel": shared,
    "main.vel": `
import {Robot, Mode, Cell, wipe} from "./shared.vel"

const c: Cell = {value: Mode.fast}
if c.value is Mode:
    wipe(c)
    print(str(c.value == Mode.fast))
`.trimStart(),
  }, "main.vel");
  assert.notEqual(importedEnum.status, 0, importedEnum.stdout);
  assert.match(importedEnum.stderr, /expected Mode/u);
});

test("[FLW-U1] a still-valid imported-record fact reads normally", async () => {
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Holder:
    payload: unknown

export def leave(h: Holder):
    return null
`.trimStart(),
    "main.vel": `
import {User, Holder, leave} from "./shared.vel"

const h: Holder = {payload: {name: "Ada"}}
if h.payload is User:
    leave(h)
    print(h.payload.name.upper())
`.trimStart(),
  }, "main.vel");
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "ADA\n");
});
