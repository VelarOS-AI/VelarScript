import assert from "node:assert/strict";
import test from "node:test";
import { runVelarProject } from "../support/velar-project.ts";

/** Structural and semantic failures publish the same typed location segments. */

test("the structural and semantic layers report one field one way, and the thrown forms follow", async () => {
  const run = await runVelarProject({
    "src/main.vel": `
import {each, field, integer, nonBlank, parse, safeParse, validate} from "velar/validation"

type Inner:
    tag: string

type Options:
    host: string
    port: number
    inner: Inner
    ports: List<number>

const hostRule = field("host", (value: Options) => value.host, nonBlank(maximum=8))
const portRule = field("port", (value: Options) => value.port, integer(minimum=1, maximum=65535))
const portsRule = field("ports", (value: Options) => value.ports, each(integer(minimum=1)))

@main:
    const missingPort: unknown = {host: "h", inner: {tag: "t"}, ports: [1]}
    print(f"structural-missing: {Json.stringify(safeParse(missingPort, Options, hostRule))}")
    const wrongType: unknown = {host: "h", port: "x", inner: {tag: "t"}, ports: [1]}
    print(f"structural-type: {Json.stringify(safeParse(wrongType, Options, hostRule))}")
    const nested: unknown = {host: "h", port: 1, inner: {tag: 5}, ports: [1]}
    print(f"structural-nested: {Json.stringify(safeParse(nested, Options, hostRule))}")
    const semanticPort: unknown = {host: "h", port: 0, inner: {tag: "t"}, ports: [1]}
    print(f"semantic-port: {Json.stringify(safeParse(semanticPort, Options, portRule))}")
    const badIndex: unknown = {host: "h", port: 1, inner: {tag: "t"}, ports: [1, 0, 3, 0]}
    print(f"semantic-index: {Json.stringify(safeParse(badIndex, Options, portsRule))}")
    try:
        const value = parse(wrongType, Options, hostRule)
        print("parse: accepted")
    catch failure:
        print(f"parse: {failure.message}")
    try:
        const blank: Options = {host: "", port: 1, inner: {tag: "t"}, ports: [1]}
        const value = validate(blank, hostRule)
        print("validate: accepted")
    catch failure:
        print(f"validate: {failure.message}")
`.trimStart(),
  }, { prefix: "velar-validation-paths-" });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = (name: string) => {
    const line = run.stdout.split("\n").find((value) => value.startsWith(name + ": "));
    assert.ok(line, run.stdout);
    return JSON.parse(line.slice(name.length + 2));
  };
  const fieldPath = (name: string) => ({kind: "field", name});
  const issue = (path: unknown[], message: string) => ({success: false, value: null, issues: [{path, message}]});
  assert.deepEqual(report("structural-missing"), issue([fieldPath("port")], "field 'port' is missing"));
  assert.deepEqual(report("structural-type"), issue([fieldPath("port")], "the value does not match number"));
  assert.deepEqual(report("structural-nested"), issue([fieldPath("inner"), fieldPath("tag")], "the value does not match string"));
  assert.deepEqual(report("semantic-port"), issue([fieldPath("port")], "must be an integer from 1 through 65535"));
  assert.deepEqual(report("semantic-index"), {success: false, value: null, issues: [
    {path: [fieldPath("ports"), {kind: "listIndex", index: 1}], message: "must be an integer of at least 1"},
    {path: [fieldPath("ports"), {kind: "listIndex", index: 3}], message: "must be an integer of at least 1"},
  ]});
  assert.match(run.stdout, /^parse: value\.port: the value does not match number$/mu, run.stdout);
  assert.match(run.stdout, /^validate: value\.host: must not be blank or exceed 8 code units$/mu, run.stdout);
});
