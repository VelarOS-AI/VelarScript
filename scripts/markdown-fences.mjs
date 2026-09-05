/**
 * Reading VelarScript fences out of Markdown, as CommonMark defines a fence.
 *
 * D114: this was private to `check-documentation-examples.mjs`, which compiles
 * every fence. `check-fence-format.mjs` formats the same fences, and a second
 * gate reading the same documents needs the same answer to "where does this
 * fence start, where does it end, and what preamble belongs to it". A second
 * fence grammar would be one concept with two definitions — the exact shape
 * that let A-022's regex skip legal examples under a headline claiming every
 * block was checked — so the grammar lives here and both gates import it.
 */

// The fence *language* those gates own. Everything about where a fence starts
// and ends is asked of the CommonMark scanner below rather than of a regex.
export const VELAR_FENCE_LANGUAGE = "velar";
// One Markdown line that may open or close a fence: up to three columns of
// indentation, then three or more backticks or tildes, then the info string.
export const FENCE_LINE = /^(?<indent>[ \t]*)(?<fence>`{3,}|~{3,})(?<info>.*)$/u;
// A line that *means* to open a VelarScript fence, whatever container it sits
// in. `>` is admitted so a block-quoted fence is recognised as a fence and
// reported by `unreadableVelarFences` rather than passing as ordinary prose.
export const VELAR_FENCE_LINE = /^[ \t>]*(?:`{3,}|~{3,})[ \t]*velar(?:[ \t]|$)/u;
// A fragment may declare the names it borrows in a Markdown comment standing
// immediately before its fence — invisible to a reader, compiled by the gates.
// D64 rule 167: the context a fragment needs in order to be checked in full is
// context the reader does not need to see, so it goes here rather than being
// spelled into the prose example.
// It may be indented with its fence, up to the three columns CommonMark allows
// a fence — the comment has to stand immediately before the fence, so a rule
// that admits an indented fence and refuses an indented preamble would leave
// the comment unrecognised and therefore silently ignored, which is the same
// failure this grammar was repaired for.
export const preambleComment = /^(?<indent>[ \t]{0,3})<!--[ \t]*velar-preamble[ \t]*\r?\n(?<source>[\s\S]*?)^[ \t]{0,3}-->[ \t]*\r?$/gmu;

/**
 * The preamble declared for each fence, keyed by the fence's offset, and the
 * comments that declared none. A preamble belongs to the fence it stands
 * immediately before — nothing but whitespace may separate them — so a comment
 * that drifted away from its fence, or that was never followed by one, is
 * returned in `problems` rather than silently ignored.
 */
export function velarPreambles(markdown, blocks) {
  const byFence = new Map();
  const problems = [];
  // A preamble inside a code block is a preamble being *shown*, not declared —
  // this rule is written out in D64 itself, inside a fence, and documentation
  // about a mechanism must not trip the mechanism.
  const quoted = blocks.map((block) => [block.blockStart, block.blockEnd]);
  // Keyed by the offset of the fence's first backtick or tilde, which is where
  // skipping whitespace after the comment lands whether or not the fence is
  // indented.
  const velarFences = new Map(blocks
    .filter((block) => block.language === VELAR_FENCE_LANGUAGE)
    .map((block) => [block.openOffset, block]));
  for (const match of markdown.matchAll(preambleComment)) {
    if (quoted.some(([start, end]) => (match.index ?? 0) >= start && (match.index ?? 0) < end)) continue;
    const after = (match.index ?? 0) + match[0].length;
    const fenceStart = after + (markdown.slice(after).match(/^\s*/u)?.[0].length ?? 0);
    if (!velarFences.has(fenceStart)) {
      problems.push({ line: lineAt(markdown, match.index ?? 0) });
      continue;
    }
    // Dedented by the comment's own indentation, the same way its fence's
    // content is: the preamble is compiled ahead of the example, and
    // VelarScript reads indentation as structure.
    const source = dedent(match.groups?.source ?? "", (match.groups?.indent ?? "").length);
    byFence.set(fenceStart, source.endsWith("\n") ? source : `${source}\n`);
  }
  return { byFence, problems };
}

// ─── Reading Markdown fences as CommonMark defines them ──────────────────────
//
// What this replaces was a regex:
//
//   /^(?<ticks>`{3,})velar…^\k<ticks>[ \t]*$/gmu
//
// and it asserted three things CommonMark does not. That the opening backticks
// sit at column 0 — CommonMark allows up to three columns of indentation, which
// is how a fence inside a list item is written. That the closing fence has
// *exactly* the opening fence's length — CommonMark requires only that it be at
// least as long. And that a fence is made of backticks — tildes open one too.
// All three errors run the same way: a legal example the gate never saw, never
// compiled, and never counted, under a headline that said every block was
// checked (A-022). It is the shape A-002 found in the CSS asset regex, where a
// regex stood in for a syntax and was wrong in both directions at once.
//
// The scanner below is not a Markdown parser. It reads §4.5 (fenced code
// blocks) and nothing else, and it is deliberate about where that stops:
//
//  - Block *containers* — block quotes, and list items nested deeply enough to
//    push their content four or more columns in — are not parsed. Inside one, a
//    fence's indentation is measured from the container, not from column 0, and
//    this scanner cannot see the container. Such a fence is not silently
//    skipped: `unreadableVelarFences` names it and the gate goes red. A gap
//    nobody prints is a gap nobody closes (D56 rule 129), and the whole defect
//    here was a gate that skipped examples quietly.
//  - Tabs count as four columns for the *indentation* test, but the content
//    stripping removes spaces only. A tab in the stripped prefix of a fence
//    inside a list item is out of scope, and CommonMark itself calls partial
//    tab expansion an edge case.
//  - Link reference definitions, HTML blocks and setext underlines cannot open
//    or close a fence, so ignoring them changes no verdict here.

/** Indentation in columns, with tabs advancing to the next multiple of four. */
export function indentColumns(indent) {
  let columns = 0;
  for (const character of indent) columns = character === "\t" ? columns + 4 - (columns % 4) : columns + 1;
  return columns;
}

/** Up to `columns` leading spaces removed, which is what CommonMark strips. */
export function dedentLine(line, columns) {
  let stripped = 0;
  while (stripped < columns && line[stripped] === " ") stripped += 1;
  return line.slice(stripped);
}

/** `dedentLine` over every line of a block of text. */
export function dedent(text, columns) {
  return columns === 0 ? text : text.split("\n").map((line) => dedentLine(line, columns)).join("\n");
}

/**
 * Every fenced code block in a Markdown document, in source order.
 *
 * Each block reports `language` (the info string's first word), `metadata`
 * (the rest of it), `source` (the content with the opening fence's indentation
 * removed), `openOffset` (the fence character itself, which is what a preamble
 * comment's whitespace skip lands on), `blockStart`/`blockEnd` (the whole
 * block including both fence lines), `contentStart`/`contentEnd` (the content
 * between the fence lines, which is the range a rewrite replaces) and `line`.
 */
export function fencedCodeBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split("\n");
  let offset = 0;
  let open = null;
  let content = [];
  for (const raw of lines) {
    const start = offset;
    offset += raw.length + 1;
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const match = FENCE_LINE.exec(text);
    const indented = match ? indentColumns(match.groups.indent) : 0;
    if (open === null) {
      if (!match || indented > 3) continue;
      const info = match.groups.info.trim();
      // "Info strings for backtick code blocks cannot contain backticks."
      if (match.groups.fence.startsWith("`") && info.includes("`")) continue;
      const [language = "", ...rest] = info.split(/[ \t]+/u);
      open = {
        character: match.groups.fence[0],
        length: match.groups.fence.length,
        indent: match.groups.indent.length,
        language,
        metadata: rest.join(" "),
        openOffset: start + match.groups.indent.length,
        blockStart: start,
        contentStart: offset,
        line: lineAt(markdown, start),
      };
      content = [];
      continue;
    }
    const closes = match
      && indented <= 3
      && match.groups.fence[0] === open.character
      && match.groups.fence.length >= open.length
      && match.groups.info.trim() === "";
    if (closes) {
      blocks.push({ ...open, source: content.map((line) => `${line}\n`).join(""), contentEnd: start, blockEnd: start + raw.length + 1 });
      open = null;
      continue;
    }
    // CommonMark removes up to as many leading spaces as the opening fence had.
    // Not cosmetic: VelarScript is indentation-sensitive, so an indented fence
    // yields a compilable module only if that prefix comes back off every line.
    content.push(dedentLine(text, open.indent));
  }
  // "If the end of the containing block is reached and no closing code fence
  // has been found, the code block contains all of the lines after the opening
  // code fence until the end of the containing block."
  if (open !== null) {
    blocks.push({ ...open, source: content.map((line) => `${line}\n`).join(""), contentEnd: markdown.length, blockEnd: markdown.length });
  }
  return blocks;
}

/**
 * Lines that open a VelarScript fence the scanner above did not take as one.
 * Everything inside an extracted block is excluded, so a fence *shown* as the
 * content of another block — this repository's own documentation of the
 * mechanism does exactly that — is not reported.
 */
export function unreadableVelarFences(markdown, blocks) {
  // A block's range covers both of its fence lines, so a fence the scanner did
  // take is excluded by the same test that excludes a fence being quoted.
  const covered = blocks.map((block) => [block.blockStart, block.blockEnd]);
  const unreadable = [];
  let offset = 0;
  for (const raw of markdown.split("\n")) {
    const start = offset;
    offset += raw.length + 1;
    if (covered.some(([from, to]) => start >= from && start < to)) continue;
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (VELAR_FENCE_LINE.test(text)) unreadable.push({ line: lineAt(markdown, start) });
  }
  return unreadable;
}

export function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}
