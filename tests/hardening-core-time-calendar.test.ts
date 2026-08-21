import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// velar/time used to make a real calendar day unconstructible wherever a
// daylight-saving transition skips local midnight, and used to read a
// conformant sub-millisecond RFC 3339 timestamp as invalid text.

after(async () => {
  await removeTemporaryDirectories();
});

/**
 * Compiles one Vel module and runs it against the real standard module sources
 * in an explicit zone, which is where the calendar rules live.
 */
async function run(source: string, timeZone = "UTC"): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-time-calendar-");
  const project = await compileProject(join(directory, "main.vel"), new Map([[join(directory, "main.vel"), source.trimStart()]]), {});
  assert.deepEqual(project.failures.map((item) => item.message), []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const compiled = project.modules[0]!.result;
  const files = new Map([...standardModuleClosure([
    ...compiled.runtimeModules,
    ...compiled.dependencies.map((dependency) => dependency.source),
  ])].map((name, index) => [name, `module-${index}.js`]));
  const link = (text: string): string => {
    let linked = text;
    for (const [name, file] of files) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(`./${file}`));
    return linked;
  };
  for (const [name, file] of files) await writeFile(join(directory, file), link(standardModuleSource(name) ?? ""), "utf8");
  await writeFile(join(directory, "main.js"), link(compiled.code ?? ""), "utf8");
  const execution = spawnSync(process.execPath, [join(directory, "main.js")], { encoding: "utf8", env: { ...process.env, TZ: timeZone } });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

test("a calendar day whose local midnight a transition skips is still constructible", async () => {
  const report = (year: number, month: number, day: number): string => `
import { date } from "velar/time"

print(str(date(${year}, ${month}, ${day}) == date(${year}, ${month}, ${day}, 1, 0, 0)))
try:
    print(str(date(${year}, ${month}, ${day}, 0, 30, 0)))
catch error:
    print(error.message)
`;
  const resolved = ["true", "velar/time date parts do not form a real local date", ""].join("\n");
  assert.equal(await run(report(2025, 3, 9), "America/Havana"), resolved);
  assert.equal(await run(report(2018, 11, 4), "America/Sao_Paulo"), resolved);
  assert.equal(await run(report(2022, 3, 22), "Asia/Tehran"), resolved);
});

test("a skipped local midnight resolves to the day's first existing instant, not its first whole hour", async () => {
  const report = (year: number, month: number, day: number): string => `
import { date } from "velar/time"

try:
    print(str(date(${year}, ${month}, ${day})))
catch error:
    print(error.message)
`;
  // Measured against Intl: Vostok's day begins at 07:00, and these two begin at
  // 00:15 and 00:45, which probing whole hours can neither reach nor name.
  assert.equal(await run(report(1994, 11, 1), "Antarctica/Vostok"), "783648000000\n");
  assert.equal(await run(report(1986, 1, 1), "Asia/Katmandu"), "504901800000\n");
  assert.equal(await run(report(1975, 8, 1), "America/Guyana"), "176096700000\n");
  // Apia skipped 2011-12-30 whole, so the search reaches the following day and
  // the rejection stands: resolving forward never invents a day.
  assert.equal(await run(report(2011, 12, 30), "Pacific/Apia"), "velar/time date parts do not form a real local date\n");
});

test("a zone with no gap keeps naming the start of the day midnight, and rollover still rejects", async () => {
  const output = await run(`
import { date, parts } from "velar/time"

const start = parts(date(2024, 5, 1))
print(str(start.hour) + ":" + str(start.minute) + ":" + str(start.second))
try:
    print(str(date(2024, 2, 30)))
catch error:
    print(error.message)
try:
    print(str(date(2024, 4, 31)))
catch error:
    print(error.message)
`, "America/New_York");
  assert.equal(output, [
    "0:0:0",
    "velar/time date parts do not form a real local date",
    "velar/time date parts do not form a real local date",
    "",
  ].join("\n"));
});

test("a local wall clock a fall-back repeats resolves to the earlier, pre-transition instant", async () => {
  const output = await run(`
import { date } from "velar/time"

print(str(date(2024, 11, 3, 1, 30, 0)))
`, "America/New_York");
  assert.equal(output, "1730611800000\n");
});

test("parse reads sub-millisecond fractions by truncating them, and accepts the lowercase spellings", async () => {
  const output = await run(`
import { iso, parse, utc } from "velar/time"

for text in ["2024-05-01T12:00:00.123Z", "2024-05-01T12:00:00.1234Z", "2024-05-01T12:00:00.123456Z", "2024-05-01T12:00:00.123456789Z"]:
    print(str(parse(text) ?? 0.0))
print(str(parse("2024-05-01t12:00:00z") ?? 0.0))
print(str(parse("2024-05-01T12:00:00.999999Z") ?? 0.0))
print(str(parse(iso(utc(2024, 5, 1, 12, 0, 0))) == utc(2024, 5, 1, 12, 0, 0)))
for text in ["2024-13-01", "not a date", "2023-02-29", "2024-01-02T03:04", "2024-01-02T03:04Z+01:00", "2024-01-02T03:04+24:00"]:
    print(str(parse(text) == null))
`);
  assert.equal(output, [
    "1714564800123",
    "1714564800123",
    "1714564800123",
    "1714564800123",
    "1714564800000",
    "1714564800999",
    "true",
    "true",
    "true",
    "true",
    "true",
    "true",
    "true",
    "",
  ].join("\n"));
});

test("parse reads the offset spellings, leap second and long fraction real systems emit", async () => {
  const output = await run(`
import { parse } from "velar/time"

print(str(parse("2024-05-01T12:00:00+0200") ?? 0.0))
print(str(parse("2024-05-01T12:00:00+02") ?? 0.0))
print(str(parse("2024-05-01T10:00:00Z") ?? 0.0))
print(str(parse("2024-05-01T12:00:00-0530") ?? 0.0))
print(str(parse("2016-12-31T23:59:60Z") ?? 0.0))
print(str(parse("2024-05-01T12:00:00.1234567890Z") ?? 0.0))
`);
  // The basic-format and hour-only offsets name the same instant as 'Z' does,
  // the leap second names the second that follows it, and a fraction longer
  // than the widened nine digits truncates rather than falling off a boundary.
  assert.equal(output, [
    "1714557600000",
    "1714557600000",
    "1714557600000",
    "1714584600000",
    "1483228800000",
    "1714564800123",
    "",
  ].join("\n"));
});

test("parse takes ':60' only where a leap second is inserted, and answers null elsewhere", async () => {
  const output = await run(`
import { parse } from "velar/time"

print(str(parse("1990-12-31T15:59:60-08:00") ?? 0.0))
print(str(parse("2017-01-01T05:29:60+05:30") ?? 0.0))
for text in ["2024-05-01T12:34:60Z", "2024-05-01T12:59:60Z", "2024-05-01T12:00:60Z"]:
    print(str(parse(text) == null))
`);
  // A leap second is inserted at the end of a UTC day, which an offset writes as
  // some other wall clock — RFC 3339 §5.7 spells the same instant '15:59:60-08:00'
  // — so the rule is read off the UTC instant, not the written hour. Anywhere
  // else ':60' is a typo, and absorbing it as a one-second shift would be the
  // silence null exists to break.
  assert.equal(output, ["662688000000", "1483228800000", "true", "true", "true", ""].join("\n"));
});
