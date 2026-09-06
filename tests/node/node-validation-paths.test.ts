import assert from "node:assert/strict";
import test from "node:test";
import { runVelarProject } from "../support/velar-project.ts";

/**
 * FS-I1: one `issues` list, one path convention.
 *
 * `safeParse` merges two layers into one list, and they disagreed about how a
 * path is spelled: the structural layer put the type name inside the segment
 * (`["Options.port"]`) while a semantic rule used the bare field name
 * (`["host"]`). A consumer rendering `issue.path` therefore printed one field
 * two ways depending on which layer caught it. The thrown forms disagreed the
 * same way — `Value does not match Options — field 'port' does not match number`
 * beside `value.host: must not be blank`.
 */

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
  // The structural layer reports the field, not the type it failed to match.
  assert.match(run.stdout, /^structural-missing: \{"success":false,"value":null,"issues":\[\{"path":\["port"\],"message":"field 'port' is missing"\}\]\}$/mu, run.stdout);
  assert.match(run.stdout, /^structural-type: \{"success":false,"value":null,"issues":\[\{"path":\["port"\],"message":"field 'port' does not match number"\}\]\}$/mu, run.stdout);
  assert.match(run.stdout, /^structural-nested: \{"success":false,"value":null,"issues":\[\{"path":\["inner"\],"message":"field 'inner' does not match Inner"\}\]\}$/mu, run.stdout);
  // A semantic failure on the same field spells its path exactly the same way.
  assert.match(run.stdout, /^semantic-port: \{"success":false,"value":null,"issues":\[\{"path":\["port"\],"message":"must be an integer from 1 through 65535"\}\]\}$/mu, run.stdout);
  // List-index paths keep their indices under the field name.
  assert.match(run.stdout, /^semantic-index: \{"success":false,"value":null,"issues":\[\{"path":\["ports",1\],"message":"[^"]+"\},\{"path":\["ports",3\],"message":"[^"]+"\}\]\}$/mu, run.stdout);
  // The thrown forms follow the same convention as the issue list.
  assert.match(run.stdout, /^parse: value\.port: field 'port' does not match number$/mu, run.stdout);
  assert.match(run.stdout, /^validate: value\.host: must not be blank or exceed 8 code units$/mu, run.stdout);
});
