import { posix } from "node:path";
import { fencedCodeBlocks } from "./markdown-fences.mjs";

/** Inline Markdown links outside fenced and inline code, with exact destination offsets. */
export function markdownLinks(markdown) {
  const excluded = fencedCodeBlocks(markdown).map(block => [block.blockStart, block.blockEnd]);
  // A code span's delimiter must be closed by a run of the same length.
  for (const match of markdown.matchAll(/(`+)([\s\S]*?)\1(?!`)/gu)) {
    if (!excluded.some(([start, end]) => match.index >= start && match.index < end)) {
      excluded.push([match.index, match.index + match[0].length]);
    }
  }
  const links = [];
  for (const match of markdown.matchAll(/\]\((?:<([^>\n]+)>|([^\s)]+))(?:[ \t]+"[^"\n]*")?\)/gu)) {
    if (excluded.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const target = match[1] ?? match[2];
    const start = match.index + (match[1] === undefined ? 2 : 3);
    links.push({target, start, end: start + target.length});
  }
  for (const match of markdown.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))/gmu)) {
    if (excluded.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const target = match[1] ?? match[2];
    const start = match.index + match[0].lastIndexOf(target);
    links.push({target, start, end: start + target.length});
  }
  return links.sort((left, right) => left.start - right.start);
}

/** GitHub-style heading anchors, including deterministic duplicate suffixes. */
export function markdownAnchors(markdown) {
  const fences = fencedCodeBlocks(markdown);
  const anchors = new Set();
  for (const match of markdown.matchAll(/^(#{1,6})[ \t]+([^\r\n]+)/gmu)) {
    if (fences.some(block => match.index >= block.blockStart && match.index < block.blockEnd)) continue;
    const heading = match[2].replace(/[ \t]+#+[ \t]*$/u, "")
      .replace(/(`+)(.*?)\1/gu, (_match, _delimiter, code) => code.replace(/[<>]/gu, ""))
      .replace(/<[^>]*>/gu, "").replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1");
    const base = heading.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/ /gu, "-");
    let anchor = base;
    for (let count = 1; anchors.has(anchor); count += 1) anchor = `${base}-${count}`;
    anchors.add(anchor);
  }
  return anchors;
}

export function isLocalMarkdownLink(target) {
  return !/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target);
}

/** Validate the actual packaged graph, not whether a similarly named checkout file exists. */
export function checkSkillMarkdownLinks(files) {
  const failures = [];
  const anchors = new Map();
  for (const [file, markdown] of files) {
    for (const {target} of markdownLinks(markdown)) {
      if (!isLocalMarkdownLink(target)) continue;
      const split = target.indexOf("#");
      const pathname = split < 0 ? target : target.slice(0, split);
      const fragment = split < 0 ? "" : target.slice(split + 1);
      let destination;
      let anchor;
      try {
        const decoded = decodeURIComponent(pathname);
        if (decoded.startsWith("/") || decoded.includes("\\")) {
          failures.push(`${file}: local link '${target}' must use a package-relative path`);
          continue;
        }
        destination = decoded === "" ? file : posix.normalize(posix.join(posix.dirname(file), decoded));
        anchor = decodeURIComponent(fragment);
      } catch {
        failures.push(`${file}: invalid encoded local link '${target}'`);
        continue;
      }
      if (!files.has(destination)) {
        failures.push(`${file}: local link '${target}' has no packaged target '${destination}'`);
        continue;
      }
      if (anchor === "") continue;
      if (!anchors.has(destination)) anchors.set(destination, markdownAnchors(files.get(destination)));
      if (!anchors.get(destination).has(anchor)) failures.push(`${file}: local link '${target}' has no packaged heading '${anchor}'`);
    }
  }
  return failures;
}
