import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { projectStyles } from "../../packages/cli/src/framework-host.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { compile, compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("components expose one stable class and Look host without declaring framework props", () => {
  const result = compile(`
import {rgb} from "velar/look"

const callerLook = look:
    padding = 12px

component Card:
    const ownLook = look:
        color = rgb(17, 18, 22)
    return <article class="card" look={ownLook}>Card</article>

component App:
    return <Card class="featured" look={callerLook} />
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /if \(__velarProps\.class !== undefined\) __velarClassBindRoot/u);
  assert.match(result.code ?? "", /if \(__velarProps\.look !== undefined\) __velarLookBindRoot/u);

  const fragment = compile(`
component Broken:
    return <><header>Header</header><main>Main</main></>

component Valid:
    return <><header>Header</header><main host>Main</main></>
`.trimStart());
  assert.equal(fragment.diagnostics.filter((item) => item.code === "VEL5043").length, 1);
  assert.doesNotMatch(fragment.code ?? "", /setAttribute\("host"/u);
});

test("project CSS has one explicit before-Look-after order across module boundaries", async () => {
  const directory = await makeTemporaryDirectory("velar-look-order-");
  const entry = join(directory, "main.vel");
  await writeFile(join(directory, "base.css"), ".base { order: 1; }", "utf8");
  await writeFile(join(directory, "base-after.css"), ".base-after { order: 4; }", "utf8");
  await writeFile(join(directory, "feature.css"), ".feature { order: 2; }", "utf8");
  await writeFile(join(directory, "feature-after.css"), ".feature-after { order: 5; }", "utf8");
  await writeFile(join(directory, "feature.vel"), `
import {rgb} from "velar/look"
import css unsafe "./feature.css" before look
import css unsafe "./feature-after.css" after look
export const featureLook = look:
    color = rgb(1, 2, 3)
`.trimStart(), "utf8");
  await writeFile(entry, `
import {rgb} from "velar/look"
import {featureLook} from "./feature.vel"
import css unsafe "./base.css" before look
import css unsafe "./base-after.css" after look
const appLook = look:
    background = rgb(4, 5, 6)
component App:
    return <main look={[featureLook, appLook]}>App</main>
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const styles = projectStyles(project);
  const firstLook = styles.indexOf("data-velar-look");
  const lastBefore = Math.max(styles.indexOf(".base {"), styles.indexOf(".feature {"));
  const firstAfter = Math.min(styles.indexOf(".base-after {"), styles.indexOf(".feature-after {"));
  assert.ok(lastBefore >= 0 && firstLook > lastBefore && firstAfter > firstLook);
});

test("viewport breakpoints accept reusable local and imported const unit tokens", async () => {
  const directory = await makeTemporaryDirectory("velar-look-breakpoints-");
  const entry = join(directory, "main.vel");
  await writeFile(join(directory, "tokens.vel"), `
const base = 360px
export const screens = {compact: base * 2}
`.trimStart(), "utf8");
  await writeFile(entry, `
import {screens as breakpoints} from "./tokens.vel"

const narrow = 40rem
const pageLook = look:
    if viewport.width <= breakpoints.compact:
        padding = 16px
    if viewport.width < narrow:
        gap = 8px

component App:
    return <main look={pageLook}>App</main>
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const styles = projectStyles(project);
  assert.match(styles, /@media \(width <= 720px\)/u);
  assert.match(styles, /@media \(width < 40rem\)/u);

  const dynamic = compile(`
def choose() -> Length:
    return 720px
const pageLook = look:
    if viewport.width <= choose():
        padding = 16px
`.trimStart());
  assert.ok(dynamic.diagnostics.some((item) => item.code === "VEL5052" && /resolve at compile time/u.test(item.message)));
});

test("unsafe CSS has one project owner", async () => {
  const directory = await makeTemporaryDirectory("velar-look-owner-");
  const entry = join(directory, "main.vel");
  await writeFile(join(directory, "shared.css"), ".shared { color: black; }", "utf8");
  await writeFile(join(directory, "feature.vel"), 'import css unsafe "./shared.css" before look\nexport const value = 1\n', "utf8");
  await writeFile(entry, 'import {value} from "./feature.vel"\nimport css unsafe "./shared.css" before look\nprint(value)\n', "utf8");
  const project = await compileProject(entry);
  assert.match(project.failures.map((failure) => failure.message).join("\n"), /each raw stylesheet must have one project owner/u);
});
