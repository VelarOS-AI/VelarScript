import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDiagnostic, formatSourceResult, SourceText } from "@velarscript/compiler";
import { exampleExtensions } from "./documentation-fence-language.mjs";
import { fencedCodeBlocks, unreadableVelarFences, velarPreambles, VELAR_FENCE_LANGUAGE } from "./markdown-fences.mjs";

/**
 * The language's documentation is written in the language's one formatted form.
 *
 * D114: 76 of the 197 `velar` fences in the documents below were not what
 * `velar format` produces — mostly a single-statement suite left on its own
 * line where the canonical form folds it onto the header, and comments padded
 * into a column the formatter closes up. A reader who copies an example and
 * runs `velar format` should get their own text back; a document that teaches
 * a spelling the toolchain immediately rewrites teaches two spellings.
 *
 * `check:docs` compiles these fences; this gate formats them. Both read the
 * same fence grammar (`./markdown-fences.mjs`), the same preamble comments, and
 * the same answer to which compiler extensions a fence is written against
 * (`./documentation-fence-language.mjs`), so neither can disagree with the
 * other about what a fence is or what language it is in.
 *
 * Usage:
 *   node scripts/check-fence-format.mjs [--write] [files...]
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The documents this gate owns, named rather than walked. `docs/ai-skill*.md`
// is published byte-for-byte as `packages/cli/skill/`, so rewriting a fence
// there would silently break that copy; the decision records are dated
// artifacts, and their fences quote the language as it stood. These five are
// the documents that state the language and its libraries, which are the ones
// a reader copies from.
const DOCUMENTS = [
  join("docs", "language-charter.md"),
  join("docs", "language.md"),
  join("docs", "standard-library.md"),
  join("docs", "web-api.md"),
  join("docs", "best-practices.md"),
];

const write = process.argv.includes("--write");
const requested = process.argv.slice(2).filter((argument) => argument !== "--write");
const files = requested.length > 0
  ? requested.map((file) => resolve(file))
  : DOCUMENTS.map((file) => join(root, file));

const failures = [];
const rewrittenByFile = new Map();
let fences = 0;
let rewritten = 0;

for (const file of files) {
  const markdown = await readFile(file, "utf8");
  const blocks = fencedCodeBlocks(markdown);
  // A fence this scanner cannot reach is a fence this gate cannot claim is
  // canonical, so it is named rather than skipped — the same rule `check:docs`
  // applies to the fence it cannot compile.
  for (const unreadable of unreadableVelarFences(markdown, blocks)) {
    failures.push(`${display(file)}:${unreadable.line}: this line opens a VelarScript fence inside a Markdown container this gate does not parse,`
      + " so its formatting is never checked. Move it out of the container, or indent it at most three columns.");
  }
  const { byFence } = velarPreambles(markdown, blocks);
  // Back to front: a rewrite shifts every offset after it, and the fences of
  // one document are rewritten in one pass.
  const edits = [];
  for (const block of blocks) {
    if (block.language !== VELAR_FENCE_LANGUAGE) continue;
    // An unknown annotation is `check:docs`'s failure to report, and this gate
    // has no formatted form to compare a fence it does not understand against.
    if (block.metadata !== "" && block.metadata !== "fragment") continue;
    fences += 1;
    const formatted = formattedFence(block, byFence.get(block.openOffset) ?? "", file);
    if (formatted === null || formatted === block.source) continue;
    rewritten += 1;
    rewrittenByFile.set(display(file), (rewrittenByFile.get(display(file)) ?? 0) + 1);
    if (!write) {
      failures.push(`${display(file)}:${block.line}: this fence is not in canonical \`velar format\` form.`
        + " Run `npm run check:fence-format -- --write` and review the rewrite.");
      continue;
    }
    edits.push({ block, formatted });
  }
  if (!write || edits.length === 0) continue;
  let updated = markdown;
  for (const { block, formatted } of edits.reverse()) {
    updated = updated.slice(0, block.contentStart) + reindent(formatted, block.indent) + updated.slice(block.contentEnd);
  }
  await writeFile(file, updated, "utf8");
}

if (fences === 0) failures.push("No ```velar fences were found to format-check");
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else if (write) {
  console.log(rewritten === 0
    ? `All ${fences} VelarScript documentation fences were already in canonical \`velar format\` form`
    : `Rewrote ${rewritten} of ${fences} VelarScript documentation fences into canonical \`velar format\` form`
      + ` (${[...rewrittenByFile].map(([file, count]) => `${file}: ${count}`).join(", ")})`);
} else {
  console.log(`Checked ${fences} VelarScript documentation fences; every one is in canonical \`velar format\` form`);
}

/**
 * One fence's canonical text, or `null` when there is none to compare against.
 *
 * A fragment is formatted behind its declared preamble, because a fragment that
 * borrows a name does not parse on its own and the formatter answers source it
 * cannot parse with that source unchanged — which would make "already
 * canonical" and "never parsed" the same answer. The preamble is formatted
 * first so that the prefix removed afterwards is the prefix the formatter
 * produced, and a fence whose formatted text does not begin with it is
 * reported rather than split at a guess.
 */
function formattedFence(block, preamble, file) {
  const source = preamble + block.source;
  const extensions = exampleExtensions(source, file);
  let head = "";
  if (preamble !== "") {
    const formattedPreamble = formatSourceResult(preamble, { extensions });
    if (formattedPreamble.blocked) {
      failures.push(`${display(file)}:${block.line}: the velar-preamble before this fence does not parse, so the fence cannot be format-checked\n`
        + formatDiagnostic(new SourceText(display(file), preamble), formattedPreamble.blocked));
      return null;
    }
    head = formattedPreamble.text;
  }
  const result = formatSourceResult(head + block.source, { extensions });
  if (result.blocked) {
    failures.push(`${display(file)}:${block.line}: this fence does not parse, so the formatter left it unchanged\n`
      + formatDiagnostic(new SourceText(display(file), head + block.source), result.blocked));
    return null;
  }
  if (!result.text.startsWith(head)) {
    failures.push(`${display(file)}:${block.line}: formatting this fence behind its preamble rewrote the preamble too,`
      + " so the fence's own formatted text cannot be recovered. Simplify the preamble.");
    return null;
  }
  return result.text.slice(head.length);
}

/** The fence's own indentation put back on every non-empty line of its text. */
function reindent(text, indent) {
  if (indent === 0) return text;
  const prefix = " ".repeat(indent);
  return text.split("\n").map((line) => line === "" ? line : `${prefix}${line}`).join("\n");
}

function display(file) {
  const path = relative(root, file);
  return path.startsWith("..") ? file : path;
}
