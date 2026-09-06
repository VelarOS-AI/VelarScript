import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runVelarProject } from "../support/velar-project.ts";

/**
 * SV-D3/SV-I2/FS-D1: a byte-order mark is text.
 *
 * Every Node text reader — `velar/fs.readText`, `velar/http`'s `text()`/`json()`,
 * and `velar/serve`'s `request.text()`/`json()` — shared one incremental UTF-8
 * decoder built without `ignoreBOM`, which is the WHATWG spelling for "remove a
 * leading U+FEFF". The documented promise is that malformed bytes are never
 * repaired; a well-formed character being deleted is the same silent edit from
 * the other direction, and it made `sha256Text(await readText(path))` disagree
 * with the digest of the file it read.
 */

test("a leading U+FEFF survives velar/fs, velar/http, and velar/serve, and stays out of JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-bom-"));
  const bomFile = join(directory, "bom.txt");
  await writeFile(bomFile, "\u{FEFF}BOMTEXT\n", "utf8");
  const onDisk = createHash("sha256").update(await readFile(bomFile)).digest("hex");

  const run = await runVelarProject({
    "src/main.vel": `
import {readText} from "velar/fs"
import {sha256Text} from "velar/hash"
import {http} from "velar/http"
import {Request, serve, text} from "velar/serve"

type Payload:
    a: number

export server app:
    @get bom(p"/bom") => text("\\u{FEFF}hello")
    @post echo(p"/echo", request: Request):
        const body = await request.text()
        return {size: body.size, leads: body.startsWith("\\u{FEFF}")}
    @post typed(p"/typed", input: Payload) => {a: input.a}

@main:
    const disk = await readText(${JSON.stringify(bomFile)})
    print(f"disk: {Json.stringify(disk)}")
    print(f"digest: {sha256Text(disk)}")
    const withBom = "\\u{FEFF}{\\"a\\":1}"
    try:
        const parsed = Json.parse(withBom, Payload)
        print(f"core: accepted a={parsed.a}")
    catch failure:
        print("core: rejected")

    const server = await serve(app, port=0)
    const base = f"http://127.0.0.1:{server.port}"
    const got = await http.get(base + "/bom").text()
    const raw = await http.get(base + "/bom").bytes()
    print(f"http: text={got.size} bytes={raw.size} leads={got.startsWith("\\u{FEFF}")}")
    const echoed = await http.post(base + "/echo", {body: withBom}).text()
    print(f"echo: {echoed}")
    try:
        const typed = await http.post(base + "/typed", {body: withBom}).text()
        print(f"typed: unexpected {typed}")
    catch failure:
        print(f"typed: {failure.message}")
    const good = await http.post(base + "/typed", {body: "{\\"a\\":1}"}).text()
    print(f"typed-good: {good}")
    await server.stop()
`.trimStart(),
  }, { prefix: "velar-bom-" });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  // FS-D1: the text is the file's text, so its digest is the file's digest.
  assert.match(run.stdout, /^disk: "﻿BOMTEXT\\n"$/mu, run.stdout);
  assert.match(run.stdout, new RegExp(`^digest: ${onDisk}$`, "mu"), `${run.stdout}\nfile digest ${onDisk}`);
  // SV-I2: Core and the Node transport give one verdict on the same bytes.
  assert.match(run.stdout, /^core: rejected$/mu, run.stdout);
  // SV-D3: `text()` keeps the mark, and `bytes()` and `text()` describe one body.
  assert.match(run.stdout, /^http: text=6 bytes=8 leads=true$/mu, run.stdout);
  assert.match(run.stdout, /^echo: \{"size":8,"leads":true\}$/mu, run.stdout);
  // The framework's own answer for a body that is not JSON, not an opaque 500.
  assert.match(run.stdout, /^typed: HTTP 400 for http:\/\/127\.0\.0\.1:\d+\/typed$/mu, run.stdout);
  assert.match(run.stdout, /^typed-good: \{"a":1\}$/mu, run.stdout);
});
