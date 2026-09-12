import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";

/** Resource examples need real files, owned by one example rather than the checkout. */
export async function withDocumentationFiles(root, preamble, reserved, run) {
  const files = new Map();
  // A sibling marker commonly spells './app.vel', while velar-file requires
  // 'app.vel'. Compare the paths that join(directory, path) actually addresses.
  const modulePaths = new Set(reserved.map(path => posix.normalize(path)));
  for (const line of preamble.split("\n")) {
    if (!/^\/\/ velar-file(?:\s|$)/u.test(line)) continue;
    const marker = /^\/\/ velar-file (\S+) (.+)$/u.exec(line);
    if (!marker) throw new Error("velar-file requires a relative path and one JSON value");
    const [, path, encoded] = marker;
    if (path.includes("\\") || path.includes(":") || path.includes("\0")
      || path.split("/").some(part => part === "" || part === "." || part === "..")) {
      throw new Error(`velar-file path '${path}' must stay inside its example directory`);
    }
    if (files.has(path) || modulePaths.has(path)) throw new Error(`velar-file repeats example path '${path}'`);
    if ([...modulePaths].some(module => module.startsWith(`${path}/`) || path.startsWith(`${module}/`))) {
      throw new Error(`velar-file conflicts with example path '${path}'`);
    }
    let value;
    try { value = JSON.parse(encoded); }
    catch { throw new Error(`velar-file '${path}' must declare a valid JSON value`); }
    files.set(path, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  if (files.size === 0) return run(root);
  const directory = await mkdtemp(join(tmpdir(), "velar-documentation-"));
  try {
    for (const [path, text] of files) {
      const target = join(directory, path);
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, text, {flag: "wx"});
    }
    return await run(directory);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}
