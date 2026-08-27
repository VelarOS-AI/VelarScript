import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { formatSource } from "@velarscript/compiler";
import { desktopRuntimeCeilingFailure, desktopSizeBudgetFailure } from "../packages/desktop/src/build.ts";
import { uncaughtProgramEntrySource } from "../packages/cli/src/uncaught-program-error.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

async function makeProject(prefix: string, sources: Readonly<Record<string, string>>): Promise<string> {
  const root = await makeTemporaryDirectory(prefix);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "velar.json"), `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`, "utf8");
  for (const [name, text] of Object.entries(sources)) await writeFile(join(root, "src", name), text, "utf8");
  return root;
}

function runCli(root: string, ...command: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliPath, ...command], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// D38 §48: one fixture carrying every mechanical-fix family member, so the
// command's membership is asserted rather than described.
const mechanicalFixture = `const total: int = 3;
const ready = True
const missing = undefined
const absent = none
const flag = False
const same = 1 === 1
const different = 2 !== 3
const both = same && different
const either = same || different
const inverted = !same
const tenth = .1
const whole = 1.
const shade = #3366ff

fn describe(values: string[], counts: List[number]) -> string:
	const size = values.length
	if size === 0:
		return "empty"
	match size:
		case 1:
			return values.at(0) ?? "one"
		else:
			return str(counts.length)

def classify(text: string?) -> string:
    if text is not null:
        return text
    return "none"

def check(value: number) -> number:
    let count = value
    ++count
    assert count > 0, "count must be positive"
    return count

print(describe(["a"], [1]))
print(classify(null))
print(str(check(1)))
print(f"{total}{ready}{missing}{absent}{flag}{both}{either}{inverted}{tenth}{whole}{shade}")
`;

test("[D38 §48] velar fix applies every mechanical rewrite the diagnostics named, and only those", async () => {
  const root = await makeProject("velar-wave-l-fix-", { "main.vel": mechanicalFixture });
  const entry = join(root, "src", "main.vel");

  const fixed = runCli(root, "fix");
  const source = await readFile(entry, "utf8");

  // Each family member, by the spelling it was rewritten to.
  assert.match(source, /const total: number = 3\n/u, source);
  assert.equal(source.includes(";"), false, source);
  assert.match(source, /const ready = true\n/u, source);
  assert.match(source, /const missing = null\n/u, source);
  assert.match(source, /const absent = null\n/u, source);
  assert.match(source, /const flag = false\n/u, source);
  assert.match(source, /const same = 1 == 1\n/u, source);
  assert.match(source, /const different = 2 != 3\n/u, source);
  assert.match(source, /const both = same and different\n/u, source);
  assert.match(source, /const either = same or different\n/u, source);
  assert.match(source, /const inverted = not same\n/u, source);
  assert.match(source, /const tenth = 0\.1\n/u, source);
  assert.match(source, /const whole = 1\.0\n/u, source);
  assert.match(source, /const shade = "#3366ff"\n/u, source);
  assert.match(source, /def describe\(values: List<string>, counts: List<number>\)/u, source);
  assert.match(source, /const size = values\.size\n/u, source);
  assert.match(source, /if size == 0:/u, source);
  assert.match(source, /return values\.get\(0\) \?\? "one"/u, source);
  assert.match(source, /case _:/u, source);
  assert.match(source, /return str\(counts\.size\)/u, source);
  assert.match(source, /if text != null:/u, source);
  assert.match(source, /^ {4}count \+= 1$/mu, source);
  assert.match(source, /assert count > 0 else "count must be positive"/u, source);
  // The tab indentation the fixture opened its function body with is gone.
  assert.equal(source.includes("\t"), false, source);

  assert.match(fixed.stdout, /fixed VEL1005: Use VelarScript strict equality '=='/u, fixed.stdout);
  assert.match(fixed.stdout, /fixed VEL2035: Use 'case _:' for the fallback case/u, fixed.stdout);
  assert.match(fixed.stdout, /fixed VEL4001: Use List size/u, fixed.stdout);
  assert.match(fixed.stdout, /applied \d+ mechanical fixes in 1 file; 0 diagnostics remain\n$/u, fixed.stdout);
  assert.equal(fixed.status, 0, fixed.stderr);

  // The fixed program is the one the author meant: it compiles and runs.
  const ran = runCli(root, "run");
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout, "a\nnone\n2\n3truenullnullfalsetruetruefalse0.11#3366ff\n", ran.stdout);

  // Idempotence: a second run has nothing left to apply and changes no byte.
  const again = runCli(root, "fix");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, "applied 0 mechanical fixes; 0 diagnostics remain\n");
  assert.equal(await readFile(entry, "utf8"), source);
});

test("[D38 §48] velar fix preserves supported bitwise code and leaves := to its diagnostic", async () => {
  const root = await makeProject("velar-wave-l-fix-judgment-", {
    "main.vel": `let counter = 0
const mask = 5 & 3
const power = 2 ^ 3
print(str(counter) + str(mask) + str(power))
`,
    // ':=' names two spellings, so it carries no rewrite either.
    "walrus.vel": "def start() -> number:\n    total := 1\n    return total\n",
  });
  const fixed = runCli(root, "fix");
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.equal(fixed.stdout.includes("fixed"), false, fixed.stdout);
  assert.equal(fixed.stderr, "");
  assert.equal(await readFile(join(root, "src", "main.vel"), "utf8"), `let counter = 0
const mask = 5 & 3
const power = 2 ^ 3
print(str(counter) + str(mask) + str(power))
`);

  const walrus = await makeProject("velar-wave-l-fix-walrus-", {
    "main.vel": "def start() -> number:\n    total := 1\n    return total\n\nprint(str(start()))\n",
  });
  const walrusFixed = runCli(walrus, "fix");
  assert.equal(walrusFixed.stdout.includes("fixed"), false, walrusFixed.stdout);
  assert.match(walrusFixed.stderr, /VelarScript has no ':=' binding operator/u, walrusFixed.stderr);
});

test("[D38 §48] velar fix reports what is left and answers to help", async () => {
  const root = await makeProject("velar-wave-l-fix-remaining-", {
    "main.vel": "const size: int = \"three\"\nprint(str(size))\n",
  });
  const fixed = runCli(root, "fix");
  assert.equal(fixed.status, 1, fixed.stdout);
  assert.match(fixed.stdout, /fixed VEL1005: Use 'number'/u, fixed.stdout);
  assert.match(fixed.stdout, /applied 1 mechanical fix in 1 file; 1 diagnostic remains\n$/u, fixed.stdout);
  assert.match(fixed.stderr, /Cannot assign string to number/u, fixed.stderr);
  assert.equal(await readFile(join(root, "src", "main.vel"), "utf8"), "const size: number = \"three\"\nprint(str(size))\n");

  const help = runCli(root, "fix", "--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: velar fix \[entry\.vel \| project-directory\]/u);
  const unknown = runCli(root, "fix", "--everything");
  assert.equal(unknown.status, 2, unknown.stdout);
  assert.match(unknown.stderr, /velar fix: unknown option '--everything'/u);
});

test("[MIG-3] a Desktop size budget failure reports the bundle's composition, not only its total", () => {
  const sizes = {
    hostBytes: 400_000,
    rendererBytes: 900_000,
    capabilityHostBytes: 300_000,
    metadataBytes: 200_000,
    applicationBytes: 1_800_000,
    // An application whose runtime is not counted here is not a special case: the
    // embedded interpreter is measured against the toolchain's own ceiling, and
    // the embedded composition is asserted below.
    runtimeBytes: 0,
    totalBytes: 1_800_000,
  };
  assert.equal(desktopSizeBudgetFailure(sizes, 2 * 1024 * 1024), null);

  const failure = desktopSizeBudgetFailure(sizes, 1024 * 1024);
  assert.ok(failure, "a bundle over its budget must fail");
  assert.match(failure, /exceeding the 1\.00 MiB \(1048576-byte\) size budget by 733\.8 KiB \(751424 bytes\)/u, failure);
  // Every component, largest first, with its share.
  assert.match(failure, /900000 bytes\s+50\.0%\s+renderer \(application code and assets\)\n/u, failure);
  assert.match(failure, /400000 bytes\s+22\.2%\s+native host \(VelarDesktopHost\)\n/u, failure);
  assert.match(failure, /300000 bytes\s+16\.7%\s+capability host \(worker\.js\) \[mandatory capability infrastructure\]/u, failure);
  assert.match(failure, /200000 bytes\s+11\.1%\s+bundle metadata \(Info\.plist, icon, desktop\.json\)\n/u, failure);
  // The floor no project change can remove, and the budget that would pass.
  assert.match(failure, /Mandatory capability infrastructure: 293\.0 KiB \(300000 bytes, 16\.7% of the application\)/u, failure);
  assert.match(failure, /Largest contributor: renderer \(application code and assets\) at 878\.9 KiB \(50\.0%\)/u, failure);
  assert.match(failure, /Raise desktop\.build\.sizeBudgetBytes to at least 1800000/u, failure);
  // A reader never has to leave the message to judge the budget.
  assert.equal(failure.split("\n").length, 9, failure);

  // L2: a 110 MiB interpreter is this toolchain generation's fixed cost, not
  // application code. It never enters the budget arithmetic, and the shares stay
  // readable because of it — but the failure still says out loud that the bundle
  // carries it, so nobody reads the composition as the whole artifact.
  const embedded = desktopSizeBudgetFailure({ ...sizes, runtimeBytes: 120_000_000, totalBytes: 121_800_000 }, 1024 * 1024);
  assert.ok(embedded, "an embedded-runtime application over its budget must still fail");
  assert.match(embedded, /Desktop application components are 1\.72 MiB \(1800000 bytes\)/u, embedded);
  assert.match(embedded, /The embedded Node\.js runtime \(114\.44 MiB, 120000000 bytes\) is outside this budget/u, embedded);
  assert.match(embedded, /900000 bytes\s+50\.0%\s+renderer \(application code and assets\)\n/u, embedded);
  assert.doesNotMatch(embedded, /120000000 bytes\s+\d/u, embedded);
  assert.equal(embedded.split("\n").length, 10, embedded);

  // The runtime's own bound is the toolchain's, and the message says so rather
  // than pointing at a project field that could not move it.
  assert.equal(desktopRuntimeCeilingFailure(120_000_000), null);
  const ceiling = desktopRuntimeCeilingFailure(220 * 1024 * 1024);
  assert.ok(ceiling, "a runtime past the integrity ceiling must fail");
  assert.match(ceiling, /above the 200\.00 MiB \(209715200-byte\) integrity ceiling this toolchain generation enforces/u, ceiling);
  assert.match(ceiling, /not a project setting/u, ceiling);
});

test("[MOD-U10] an uncaught program error presents as a VelarScript failure, with the Node.js trace one flag away", async () => {
  const root = await makeProject("velar-wave-l-uncaught-", {
    "boom.vel": "export def explode() -> number:\n    throw Error(\"module initialization failed\")\n\nexport const value: number = explode()\n",
    "main.vel": "import {value} from \"./boom.vel\"\n\nprint(str(value))\n",
  });

  const failed = runCli(root, "run");
  assert.equal(failed.status, 1, failed.stdout);
  assert.match(failed.stderr, /^velar run: uncaught error while running .*src\/main\.vel\n/u, failed.stderr);
  assert.match(failed.stderr, /Error: module initialization failed/u, failed.stderr);
  assert.match(failed.stderr, /at explode \(.*src\/boom\.vel:2:11\)/u, failed.stderr);
  // The frames and the banner that made this read as a toolchain crash.
  assert.equal(failed.stderr.includes("ModuleJob.run"), false, failed.stderr);
  assert.equal(/node:internal/u.test(failed.stderr), false, failed.stderr);
  assert.equal(/Node\.js v\d+/u.test(failed.stderr), false, failed.stderr);
  assert.match(failed.stderr, /\(2 Node\.js internal frames hidden; rerun with 'velar run --stack' for the full trace\)/u, failed.stderr);

  const full = runCli(root, "run", "--stack");
  assert.equal(full.status, 1, full.stdout);
  assert.match(full.stderr, /^velar run: uncaught error while running .*src\/main\.vel\n/u, full.stderr);
  assert.match(full.stderr, /at ModuleJob\.run \(node:internal\//u, full.stderr);
  assert.equal(/Node\.js v\d+/u.test(full.stderr), false, full.stderr);

  const help = runCli(root, "run", "--help");
  assert.match(help.stdout, /--stack prints the full Node\.js trace/u, help.stdout);
});

test("[MOD-U10] the launcher presents a later uncaught error and stands down when the program owns it", async () => {
  const root = await makeTemporaryDirectory("velar-wave-l-launcher-");
  await writeFile(join(root, "package.json"), '{"type":"module"}\n', "utf8");
  const write = async (name: string, body: string): Promise<string> => {
    const entry = join(root, `${name}-entry.mjs`);
    await writeFile(entry, body, "utf8");
    const launcher = join(root, `${name}-launcher.mjs`);
    await writeFile(launcher, uncaughtProgramEntrySource({
      entryUrl: new URL(`file://${entry}`).href,
      sourcePath: join(root, "src", "main.vel"),
      fullStack: false,
    }), "utf8");
    return launcher;
  };

  // An error on a later turn reaches the same presentation as one during
  // initialization, because Node.js would have made it fatal either way.
  const later = await write("later", 'setTimeout(() => { throw new Error("late failure"); }, 1);\n');
  const lateResult = spawnSync(process.execPath, ["--enable-source-maps", later], { encoding: "utf8" });
  assert.equal(lateResult.status, 1, lateResult.stdout);
  assert.match(lateResult.stderr, /velar run: uncaught error while running .*main\.vel/u, lateResult.stderr);
  assert.match(lateResult.stderr, /Error: late failure/u, lateResult.stderr);
  assert.equal(/Node\.js v\d+/u.test(lateResult.stderr), false, lateResult.stderr);

  // A program that installs its own handler owns the error: Node.js would not
  // have crashed, so the launcher prints nothing and changes no exit code.
  const owned = await write("owned", [
    'process.on("uncaughtException", (error) => { process.stdout.write(`owned: ${error.message}\\n`); });',
    'setTimeout(() => { throw new Error("handled failure"); }, 1);',
    "setTimeout(() => {}, 20);",
    "",
  ].join("\n"));
  const ownedResult = spawnSync(process.execPath, ["--enable-source-maps", owned], { encoding: "utf8" });
  assert.equal(ownedResult.status, 0, ownedResult.stderr);
  assert.equal(ownedResult.stdout, "owned: handled failure\n");
  assert.equal(ownedResult.stderr, "");

  // A thrown non-Error value is still presented as a VelarScript failure.
  const thrown = await write("thrown", 'throw "plain text";\n');
  const thrownResult = spawnSync(process.execPath, ["--enable-source-maps", thrown], { encoding: "utf8" });
  assert.equal(thrownResult.status, 1, thrownResult.stdout);
  assert.match(thrownResult.stderr, /The program threw a non-Error string value: plain text/u, thrownResult.stderr);
});

test("[D39 §54] markup takes its canonical shape and formatting stays idempotent", () => {
  const format = (source: string): string => formatSource(source, { extensions: [velarCompilerExtension] });
  const round = (source: string): string => {
    const once = format(source);
    assert.equal(format(once), once, once);
    return once;
  };

  // A single-line element over the width takes the block shape.
  const long = round('component App:\n    return <div class="shell" look={shellLook}>'
    + '<nav look={navLook} aria-label="Application pages"><Link to="/" look={navLinkLook} /><Link to="/about" look={navLinkLook} /></nav>'
    + "<Router routes={routes} /></div>\n");
  assert.equal(long, [
    "component App:",
    '    return <div class="shell" look={shellLook}>',
    '        <nav look={navLook} aria-label="Application pages">',
    '            <Link to="/" look={navLinkLook} />',
    '            <Link to="/about" look={navLinkLook} />',
    "        </nav>",
    "        <Router routes={routes} />",
    "    </div>",
    "",
  ].join("\n"));

  // An element that fits keeps its line, and its spelling is canonical.
  assert.equal(round('component Row:\n    return <p  class = "row"   data-row >{ title }</p>\n'),
    'component Row:\n    return <p class="row" data-row>{title}</p>\n');

  // Written space between children is content: an element that carries it is
  // never broken, however long it becomes.
  const spaced = round(`component Meta:
    return <p look={bodyLook}>{requester} · <time look={timeLook}>{stamp}</time> · <span look={tagLook}>{tag}</span> · <em>{note}</em></p>
`);
  assert.equal(spaced.split("\n").length, 3, spaced);
  assert.match(spaced, /\{requester\} · <time look=\{timeLook\}>\{stamp\}<\/time> · /u, spaced);

  // Text with no surrounding space breaks safely, and the text keeps its line.
  assert.equal(round(`component Field:
    return <label look={labelLook}>Issue title<input look={fieldLook} name="title" data-title placeholder="What needs attention?" /></label>
`), [
    "component Field:",
    "    return <label look={labelLook}>",
    "        Issue title",
    '        <input look={fieldLook} name="title" data-title placeholder="What needs attention?" />',
    "    </label>",
    "",
  ].join("\n"));

  // Attributes take a line each only once the open tag alone overflows.
  assert.equal(round(`component Probe:
    return <section>
        <input look={eventInputLook} data-event-input aria-label="Native event probe" on:keydown={captureKey} on:beforeinput={captureInput} />
    </section>
`), [
    "component Probe:",
    "    return <section>",
    "        <input",
    "            look={eventInputLook}",
    "            data-event-input",
    '            aria-label="Native event probe"',
    "            on:keydown={captureKey}",
    "            on:beforeinput={captureInput}",
    "        />",
    "    </section>",
    "",
  ].join("\n"));

  // Markup the author spread across lines keeps that structure, and a hole
  // keeps its line because it is code.
  const authored = `component List:
    return <ol look={listLook}>
        {recent.map(task => <li look={itemLook} key={task.id}><span>{task.title}</span><time look={timeLook}>{format(task.updatedAt)}</time></li>)}
    </ol>
`;
  assert.equal(round(authored), authored);

  // Markup inside a string interpolation never breaks: a newline there would
  // change the string. Markup nested further in is still markup, not a run of
  // comparison operators to be re-spaced.
  const interpolated = 'component Label:\n    const text = f"{items.map(item => item.name)}"\n    return <p>{text}</p>\n';
  assert.equal(round(interpolated), interpolated);
  const nested = 'component Tags:\n    const label = f"{tags.map(tag => <li>{tag.hot ? <b>{tag.name}</b> : null}</li>)}"\n    return <p>{label}</p>\n';
  assert.equal(round(nested), nested);
});
