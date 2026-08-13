import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectModule } from "@velarscript/compiler";
import { velarCompilerExtension } from "@velarscript/web/compiler";
import { compileProject } from "../packages/cli/src/project.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = process.argv.slice(2);
const files = requested.length > 0
  ? requested.map((file) => resolve(file))
  : [join(root, "README.md"), ...await markdownFiles(join(root, "docs")), ...await packageReadmes(join(root, "packages"))];
// Match the opening fence's exact backtick count so VelarScript layout-string
// examples may contain shorter Markdown fences as literal text.
const fence = /^(?<ticks>`{3,})velar(?:[ \t]+(?<metadata>[^\n]+))?[ \t]*\r?\n(?<source>[\s\S]*?)^\k<ticks>[ \t]*$/gmu;
const failures = [];
let examples = 0;
let fragments = 0;

for (const file of files) {
  const markdown = await readFile(file, "utf8");
  for (const match of markdown.matchAll(fence)) {
    examples += 1;
    const metadata = (match.groups?.metadata ?? "").trim();
    const source = match.groups?.source ?? "";
    const line = lineAt(markdown, match.index ?? 0);
    if (metadata !== "" && metadata !== "fragment") {
      failures.push(`${display(file)}:${line}: unknown VelarScript fence annotation '${metadata}'`);
      continue;
    }
    if (metadata === "fragment") {
      fragments += 1;
      const result = inspectModule(source, { path: file, extensions: [velarCompilerExtension] });
      for (const diagnostic of result.diagnostics) failures.push(`${display(file)}:${line}: ${diagnostic.code} ${diagnostic.message}`);
      continue;
    }

    const entry = join(root, ".velar-documentation-example.vel");
    const result = await compileProject(entry, new Map([[entry, source]]), {
      sourceRoot: root,
      projectRoot: root,
      extensions: [velarCompilerExtension],
      // Documentation examples illustrate packages that are deliberately not
      // installed here; the specifier-existence probe is a project check.
      resolveJavaScriptSpecifiers: false,
    });
    for (const failure of result.failures) failures.push(`${display(file)}:${line}: ${failure.message}`);
    for (const module of result.modules) {
      for (const diagnostic of module.result.diagnostics) {
        failures.push(`${display(file)}:${line}: ${diagnostic.code} ${diagnostic.message}`);
      }
    }
  }
}

if (examples === 0) failures.push("No ```velar documentation examples were found");
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${examples} VelarScript documentation examples (${examples - fragments} complete, ${fragments} fragments)`);
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

async function packageReadmes(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(directory, entry.name, "README.md");
    try {
      await readFile(file, "utf8");
      files.push(file);
    } catch {
      // Packages are not required to have a public README.
    }
  }
  return files.sort();
}

function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function display(file) {
  const path = relative(root, file);
  return path.startsWith("..") ? file : path;
}
