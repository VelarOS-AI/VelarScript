import { basename } from "node:path";
import { permanentNamespaceCoveringModule } from "@velarscript/compiler";
import { standardModuleInterfaces as coreOwnedModuleInterfaces } from "@velarscript/core";
import { isNodeOnlyModule } from "@velarscript/node/compiler";
import { standardModuleInterfaces } from "../packages/cli/src/standard-modules.ts";
import { CORE_STATEMENT_CONSTRUCTS } from "../packages/compiler/src/ast.ts";
import {
  CORE_CONTEXTUAL_KEYWORD_WORDS,
  CORE_NUMERIC_SUFFIXES,
  CORE_PRELUDE_NAMES,
  PERMANENT_NAMESPACE_NAMES,
  TYPE_PARAMETER_DECLARATION_FORMS,
  VELAR_CORE_API_VERSION,
} from "../packages/compiler/src/core-vocabulary.ts";
import { keywordKinds } from "../packages/compiler/src/token.ts";
import { typeParameterBoundNames } from "../packages/compiler/src/types.ts";
import { velarCompilerExtension as desktopExtension } from "../packages/desktop/src/compiler.ts";
import { VELAR_DESKTOP_API_VERSION } from "../packages/desktop/src/config.ts";
import { VELAR_NODE_API_VERSION, velarNodeCompilerExtension as nodeExtension } from "../packages/node/src/compiler.ts";
import { VELAR_SERVER_API_VERSION, velarCompilerExtension as serverExtension } from "../packages/server/src/compiler.ts";
import { BROWSER_TEST_MODULE } from "../packages/web/src/browser-test.ts";
import { VELAR_WEB_API_VERSION, velarCompilerExtension as webExtension } from "../packages/web/src/compiler.ts";
import { LOOK_HOOKS, LOOK_MEDIA_SUBJECTS, LOOK_PROPERTIES, LOOK_TARGETS } from "../packages/web/src/look.ts";

/**
 * D110 — the one enumeration of the language's observable surface.
 *
 * Two gates read it, and they ask different questions of the same names:
 *
 *  - `check-tour-coverage.mjs` (D56 rule 129) asks whether `examples/tour/`
 *    *exercises* each name, one target at a time.
 *  - `check-surface-versions.mjs` (D110 rule 4) asks whether the set of names a
 *    *package* publishes still hashes to what `surface-lock.json` recorded.
 *
 * They must not each enumerate the language. The coverage gate's header already
 * names the discipline that makes it trustworthy — "No hand-kept list: every
 * required name is read out of a compiler-owned table at run time" — and a
 * second gate keeping its own reading of those tables is that same drift in a
 * larger font: the surface digest would go on being computed over a vocabulary
 * the coverage gate had already stopped agreeing with, and nothing would say
 * so. The reading lives here once; the two gates differ only in what they do
 * with the entries.
 *
 * Every entry carries an `owner`: the repository path of the table that
 * declared it. That is what D110 rule 4 partitions on — a name belongs to the
 * surface of the package whose table names it, not to whichever target happens
 * to load it. `packages/web/src/look.ts` owns the Look property table, so
 * `verticalAlign` is part of the Web surface even though a Desktop project
 * renders it. Desktop's own pin on Web (`composes: {"@velarscript/web": …}`) is
 * the separate channel that carries a Web surface change into Desktop, and
 * `validateLoadedExtension` already checks it against Web's package metadata.
 */

/** The five surfaces (D110 rule 1). A sixth arrives as one more partition entry. */
export const SURFACE_NAMES = Object.freeze(["core", "web", "node", "server", "desktop"]);

/**
 * Which surface each workspace package's tables belong to, keyed by its
 * directory under `packages/` — the half of a package's identity that a table's
 * path carries.
 *
 * Core spans two packages by ruling (D110 rule 1): `packages/compiler` owns the
 * words, the types and the statement constructs, `packages/core` owns the
 * standard modules. Each official target package is a surface of its own.
 *
 * `cli` and `create` are partitioned to `null` rather than left out. A package
 * this table has never heard of is a failure, so adding one to the workspace
 * forces "which surface does it publish?" to be answered out loud; an omitted
 * package would instead contribute silently to no digest at all, which is the
 * quiet half of the drift this whole mechanism exists to stop.
 */
const SURFACE_PARTITION = new Map([
  ["compiler", { package: "@velarscript/compiler", surface: "core" }],
  ["core", { package: "@velarscript/core", surface: "core" }],
  ["web", { package: "@velarscript/web", surface: "web" }],
  ["node", { package: "@velarscript/node", surface: "node" }],
  ["server", { package: "@velarscript/server", surface: "server" }],
  ["desktop", { package: "@velarscript/desktop", surface: "desktop" }],
  ["cli", { package: "@velarscript/cli", surface: null }],
  ["create", { package: "create-velar", surface: null }],
]);

/**
 * Each surface's version constant, read from the package that owns the surface.
 * D110 rule 6 forbids any consumer from spelling one of these numbers: the CLI
 * banner, the manifest check and this gate all read them from here.
 */
export const SURFACE_VERSIONS = Object.freeze({
  core: VELAR_CORE_API_VERSION,
  web: VELAR_WEB_API_VERSION,
  node: VELAR_NODE_API_VERSION,
  server: VELAR_SERVER_API_VERSION,
  desktop: VELAR_DESKTOP_API_VERSION,
});

/**
 * Where each surface's version is declared, and — for the four target
 * extensions — the package manifest field that has to agree with it.
 *
 * A bump is one act in one commit: the constant, the package manifest, and
 * `surface-lock.json`. Naming the sites here lets the gate check that the
 * constant really is declared where this table says it is, so the failure it
 * prints can tell an author the file to open instead of the fact that something
 * somewhere disagrees.
 *
 * Core has no manifest field. It is not an installed extension package, so
 * there is nothing for `velar.extension.apiVersion` to say about it; the
 * constant is the whole declaration.
 */
export const SURFACE_VERSION_SITES = Object.freeze({
  core: { file: "packages/compiler/src/core-vocabulary.ts", constant: "VELAR_CORE_API_VERSION", manifest: null },
  web: { file: "packages/web/src/compiler.ts", constant: "VELAR_WEB_API_VERSION", manifest: "packages/web/package.json" },
  node: { file: "packages/node/src/compiler.ts", constant: "VELAR_NODE_API_VERSION", manifest: "packages/node/package.json" },
  server: { file: "packages/server/src/compiler.ts", constant: "VELAR_SERVER_API_VERSION", manifest: "packages/server/package.json" },
  desktop: { file: "packages/desktop/src/config.ts", constant: "VELAR_DESKTOP_API_VERSION", manifest: "packages/desktop/package.json" },
});

/**
 * The surface that owns a table, from the repository path the table lives at.
 * Answers `null` for a package that publishes no language surface, and throws
 * for a path no package owns, so a table moved out from under this partition
 * fails loudly instead of dropping out of every digest.
 */
export function surfaceOfPath(path) {
  const match = /^packages\/([^/]+)\//u.exec(path.replaceAll("\\", "/"));
  if (!match) throw new Error(`'${path}' is not a path inside a workspace package, so no surface can own the table it names`);
  const partition = SURFACE_PARTITION.get(match[1]);
  if (partition === undefined) {
    throw new Error(`no surface partition for 'packages/${match[1]}'; add it to SURFACE_PARTITION in scripts/surface-inventory.mjs`);
  }
  return partition.surface;
}

/**
 * The partition checked against the workspace it describes. A package added
 * under `packages/` fails here until D110 rule 1 has been extended to say which
 * surface it publishes, and a partition entry naming a package that no longer
 * exists fails in the other direction.
 */
export function surfacePartitionFailures(packages) {
  const failures = [];
  const seen = new Set();
  for (const item of packages) {
    const directory = basename(item.directory);
    seen.add(directory);
    const partition = SURFACE_PARTITION.get(directory);
    if (partition === undefined) {
      failures.push(`workspace package '${item.name}' (packages/${directory}) has no surface partition; D110 rule 1 has to say which surface its tables publish, or that it publishes none — add it to SURFACE_PARTITION in scripts/surface-inventory.mjs`);
      continue;
    }
    if (partition.package !== item.name) {
      failures.push(`packages/${directory} is published as '${item.name}', but SURFACE_PARTITION calls it '${partition.package}'`);
    }
  }
  for (const [directory, partition] of SURFACE_PARTITION) {
    if (!seen.has(directory)) failures.push(`SURFACE_PARTITION names packages/${directory} ('${partition.package}'), which is no longer a workspace package`);
  }
  return failures;
}

/**
 * Module categories are keyed by (module, name) rather than by name alone:
 * `velar/http` publishes `secretHeader` on Node and `formBody` on the Web, and
 * one target's table would otherwise overwrite the other's. The separator is a
 * character no module source and no identifier can contain, written as an
 * escape rather than as the byte itself so that no file here becomes invisible
 * to `grep`. It is built here rather than spelled at each site because the
 * places that write and read these keys have to agree, and a copy of a key
 * format drifts as silently as a copy of a name list does.
 */
export function moduleExportKey(source, name) {
  return `${source}\u0000${name}`;
}

/** The module half of a `moduleExportKey`. */
export function moduleExportSource(key) {
  const separator = key.indexOf("\u0000");
  return separator < 0 ? key : key.slice(0, separator);
}

/** A `velar/web-test` controller member, keyed the same way and for the same reason. */
export function webTestMemberKey(source, controller, member) {
  return `${source}\u0000${controller}\u0000${member}`;
}

function entry(category, key, spelling, table, owner) {
  return { category, key, spelling, table, owner };
}

/**
 * Core's own tables — the words, the bounds, the declaration forms, the
 * resident namespaces, the prelude, and the statement constructs. Read out of
 * `packages/compiler` at run time, never restated.
 */
export function coreVocabularyEntries() {
  const entries = [];
  for (const spelling of Object.keys(keywordKinds)) {
    entries.push(entry("hard-keyword", spelling, spelling, "keywordKinds in packages/compiler/src/token.ts", "packages/compiler/src/token.ts"));
  }
  for (const name of typeParameterBoundNames) {
    entries.push(entry("type-parameter-bound", name, `<T: ${name}>`, "typeParameterBoundNames in packages/compiler/src/types.ts", "packages/compiler/src/types.ts"));
  }
  // D55 rule 120: which declaration forms take `<T>` is a compiler-owned
  // roster — the same one every refusal aimed at a form that does not take one
  // is worded from. A form added there without a tour example goes red here.
  for (const form of TYPE_PARAMETER_DECLARATION_FORMS) {
    entries.push(entry("generic-declaration", form, `${form} Name<T>`, "TYPE_PARAMETER_DECLARATION_FORMS in packages/compiler/src/core-vocabulary.ts", "packages/compiler/src/core-vocabulary.ts"));
  }
  for (const name of PERMANENT_NAMESPACE_NAMES) {
    entries.push(entry("permanent-namespace", name, name, "PERMANENT_NAMESPACE_NAMES in packages/compiler/src/core-vocabulary.ts", "packages/compiler/src/core-vocabulary.ts"));
  }
  for (const name of CORE_PRELUDE_NAMES) {
    entries.push(entry("prelude-name", name, name, "CORE_PRELUDE_NAMES in packages/compiler/src/core-vocabulary.ts", "packages/compiler/src/core-vocabulary.ts"));
  }
  // D62 rules 157/158: Core's own contextual keywords and numeric suffixes.
  // Both were holes the coverage gate could only print — one had no enumerable
  // table at all, and the other was reachable only because the Web extension
  // republishes `ms` and `s` through LOOK_UNIT_TYPES, so a Core-only checkout
  // checked neither.
  for (const word of CORE_CONTEXTUAL_KEYWORD_WORDS) {
    entries.push(entry("contextual-keyword", word, word, "CORE_CONTEXTUAL_KEYWORDS in packages/compiler/src/core-vocabulary.ts", "packages/compiler/src/core-vocabulary.ts"));
  }
  for (const suffix of CORE_NUMERIC_SUFFIXES) {
    entries.push(entry("numeric-suffix", suffix, `1${suffix}`, "CORE_NUMERIC_SUFFIXES in packages/compiler/src/core-vocabulary.ts", "packages/compiler/src/core-vocabulary.ts"));
  }
  // D53 rule 117's blind spot: the only category that names a construct instead
  // of a name. The roster is a mapped type over the `CoreStatement` union, so a
  // declaration form the parser can return cannot be absent from it.
  for (const [kind, spelling] of Object.entries(CORE_STATEMENT_CONSTRUCTS)) {
    entries.push(entry("statement-construct", kind, spelling, "CORE_STATEMENT_CONSTRUCTS in packages/compiler/src/ast.ts", "packages/compiler/src/ast.ts"));
  }
  return entries;
}

/**
 * One extension's own tables. `owner` is the path its tables live at, which is
 * what decides the surface; the human-readable `table` keeps naming the
 * extension, because that is what the coverage gate's failures have always
 * printed.
 */
export function extensionVocabularyEntries(extension, owner) {
  const entries = [];
  const failures = [];
  for (const word of extension.lexical?.contextualKeywords ?? []) {
    entries.push(entry("contextual-keyword", word, word, `${extension.id} lexical.contextualKeywords`, owner));
  }
  for (const suffix of extension.lexical?.numericSuffixes ?? []) {
    entries.push(entry("numeric-suffix", suffix, `1${suffix}`, `${extension.id} lexical.numericSuffixes`, owner));
  }
  for (const name of extension.analysis?.reservedBindings ?? []) {
    entries.push(entry("reserved-binding", name, name, `${extension.id} analysis.reservedBindings`, owner));
  }
  for (const name of extension.analysis?.globals?.keys() ?? []) {
    entries.push(entry("extension-global", name, name, `${extension.id} analysis.globals`, owner));
  }
  // An extension's statements never join `CoreStatement`, so its own roster is
  // the only table that can name them. Owning a parser and publishing no roster
  // is the silent version of the hole the construct category closes, so it is a
  // failure rather than an empty contribution.
  if (extension.parser !== undefined && extension.syntax === undefined) {
    failures.push(`Extension '${extension.id}' registers a parser but publishes no 'syntax.statementConstructs', so the statement forms it adds cannot be required of the tour`);
  }
  for (const [key, spelling] of Object.entries(extension.syntax?.statementConstructs ?? {})) {
    entries.push(entry("statement-construct", key, spelling, `${extension.id} syntax.statementConstructs`, owner));
  }
  return { entries, failures };
}

/**
 * Look's own tables. The 20 builders and the 17 public type names are not here:
 * they are `velar/look`'s exports, so the module walk already names every one
 * of them by the spelling that imports it.
 */
export function lookVocabularyEntries() {
  const owner = "packages/web/src/look.ts";
  const entries = [];
  for (const name of LOOK_PROPERTIES) entries.push(entry("look-property", name, `${name}:`, "LOOK_PROPERTY_GROUPS in packages/web/src/look.ts", owner));
  for (const name of LOOK_HOOKS) entries.push(entry("look-hook", name, `@${name}`, "LOOK_HOOKS in packages/web/src/look.ts", owner));
  for (const name of LOOK_TARGETS) entries.push(entry("look-target", name, `@${name}`, "LOOK_TARGETS in packages/web/src/look.ts", owner));
  for (const [subject, features] of LOOK_MEDIA_SUBJECTS) {
    for (const feature of features) {
      entries.push(entry("look-media-feature", `${subject}.${feature}`, `${subject}.${feature}`, "LOOK_MEDIA_SUBJECTS in packages/web/src/look.ts", owner));
    }
  }
  return entries;
}

/**
 * Every name one map of module interfaces publishes.
 *
 * D56-TOUR-INVENTORY trap 3: a module whose every export retired behind a
 * resident namespace is not importable at all, so `velar/math`, `velar/json`,
 * `velar/text` and `velar/async` are named by prefix rather than by an import
 * line. The split is asked of `permanentNamespaceCoveringModule` — the same
 * roster the compiler rejects those imports with — never restated here.
 */
export function moduleVocabularyEntries({ interfaces, table, webTestTable, owner, admits, webTestSpelling }) {
  const entries = [];
  for (const [source, interface_] of interfaces) {
    if (admits && !admits(source)) continue;
    const names = new Set([
      ...interface_.exports.keys(),
      ...interface_.classes.keys(),
      ...interface_.namedTypes.keys(),
      ...interface_.enums.keys(),
      ...interface_.typeAliases.keys(),
    ]);
    const namespace = permanentNamespaceCoveringModule(source, interface_.exports.keys());
    for (const name of names) {
      if (namespace) entries.push(entry("namespace-member", `${namespace}.${name}`, `${namespace}.${name}`, table(source), owner));
      else entries.push(entry("module-export", moduleExportKey(source, name), `import {${name}} from "${source}"`, table(source), owner));
    }
    if (source !== BROWSER_TEST_MODULE) continue;
    for (const [controller, type] of interface_.exports) {
      if (type.kind !== "object") continue;
      for (const member of type.fields.keys()) {
        entries.push(entry(
          "web-test-member",
          webTestMemberKey(source, controller, member),
          webTestSpelling ? webTestSpelling(controller, member) : `${controller}.${member}`,
          webTestTable ? webTestTable(controller) : `${source} ${controller} object fields`,
          owner,
        ));
      }
    }
  }
  return entries;
}

/**
 * Everything one *target* declares — the inventory `check-tour-coverage.mjs`
 * requires of the tour. Called once per tour project, so a name only one target
 * publishes — `secretHeader` on Node, `formBody` on the Web — enters the
 * inventory from the target that has it instead of being overwritten by
 * whichever table was read last.
 *
 * Every entry's `owner` is null here. Which package declared a name is the
 * surface gate's question, and a merged per-target view cannot answer it: a
 * target's module table is Core's roster with each active extension's own
 * layered over the top.
 */
export function targetVocabularyEntries(config, { target, webTestSpelling } = {}) {
  const extensions = config.compilerExtensions;
  const entries = [...coreVocabularyEntries()];
  const failures = [];

  for (const extension of extensions) {
    const extensionEntries = extensionVocabularyEntries(extension, null);
    entries.push(...extensionEntries.entries);
    failures.push(...extensionEntries.failures);
  }

  // The standard modules this target admits, and every name each publishes.
  const capabilities = new Set(extensions.flatMap((extension) => extension.capabilities ?? []));
  const web = capabilities.has("web") || config.framework?.host?.target === "browser";
  const interfaces = standardModuleInterfaces(extensions);

  // Look's own tables, required of the targets that publish `velar/look`.
  if (interfaces.has("velar/look")) entries.push(...lookVocabularyEntries().map((item) => ({ ...item, owner: null })));

  entries.push(...moduleVocabularyEntries({
    interfaces,
    table: (source) => `${source} (${target})`,
    webTestTable: (controller) => `${BROWSER_TEST_MODULE} ${controller} object fields (${target})`,
    owner: null,
    // The project driver's own rule for a module this target cannot import.
    admits: (source) => {
      const owned = extensions.some((extension) => extension.id !== "@velarscript/node" && extension.modules?.interfaces.has(source));
      return !(isNodeOnlyModule(source) && web && !owned);
    },
    webTestSpelling,
  }));

  return { entries, failures };
}

/**
 * The surfaces one surface is built on top of, read from that extension's own
 * `contract.extends` and `contract.composes` and closed transitively. Core is
 * beneath every surface: the language is what every target extends.
 *
 * This is the second half of "a name belongs to the package that owns its
 * table", and it is what keeps the numbers meaningful. `@velarscript/desktop`
 * republishes Web's lexical table, Web's `velar/web-test` controllers and most
 * of Node's modules; a digest over everything Desktop *publishes* would step
 * every time Web or Node moved, and D110's whole promise — "一眼看出只有 Web
 * 代码需要复查" — would be a row of surfaces that all bump together. The
 * repository already behaves this way and always has: Desktop's contract sat at
 * 0.10 across Web 0.10 → 0.11, and what recorded that change on Desktop's side
 * was its `composes` pin, which `validateLoadedExtension` checks against Web's
 * package metadata. So a composed surface's names are subtracted, and a name
 * Desktop genuinely adds to a module it borrows — its own `velar/fs` export
 * that Node has no equivalent of — is not in the subtrahend and stays Desktop's.
 */
function surfacesBeneath(extension, surfaceOfPackage) {
  const direct = Object.keys({ ...extension.contract?.extends, ...extension.contract?.composes });
  const beneath = new Set(["core"]);
  for (const name of direct) {
    const surface = surfaceOfPackage.get(name);
    if (surface !== undefined) beneath.add(surface);
  }
  return beneath;
}

/**
 * Every name each *surface* publishes, partitioned by the package that owns the
 * table it came from. This is the set D110 rule 4 hashes.
 *
 * Core's modules are read with no extension active, through `@velarscript/core`
 * rather than through the CLI's wrapper: the CLI substitutes the Node extension
 * for an empty extension list, which is the right rule for a project that names
 * no extensions and the wrong one here, because it would file every Node module
 * under Core.
 */
export function surfaceInventory() {
  const entries = [];
  const failures = [];

  entries.push(...coreVocabularyEntries());
  entries.push(...moduleVocabularyEntries({
    interfaces: coreOwnedModuleInterfaces([]),
    table: (source) => `${source} (@velarscript/core)`,
    owner: "packages/core/src/index.ts",
  }));
  entries.push(...lookVocabularyEntries());

  const extensionOwners = [
    { extension: webExtension, owner: "packages/web/src/compiler.ts" },
    { extension: nodeExtension, owner: "packages/node/src/compiler.ts" },
    { extension: serverExtension, owner: "packages/server/src/compiler.ts" },
    { extension: desktopExtension, owner: "packages/desktop/src/compiler.ts" },
  ];
  const surfaceOfPackage = new Map([...SURFACE_PARTITION.values()].map((item) => [item.package, item.surface]));
  for (const { extension, owner } of extensionOwners) {
    const extensionEntries = extensionVocabularyEntries(extension, owner);
    entries.push(...extensionEntries.entries);
    failures.push(...extensionEntries.failures);
    const interfaces = extension.modules?.interfaces;
    if (interfaces === undefined) {
      failures.push(`Extension '${extension.id}' publishes no 'modules.interfaces', so its surface cannot be enumerated`);
      continue;
    }
    entries.push(...moduleVocabularyEntries({
      interfaces,
      table: (source) => `${source} (${extension.id})`,
      webTestTable: (controller) => `${BROWSER_TEST_MODULE} ${controller} object fields (${extension.id})`,
      owner,
    }));
  }

  const published = new Map(SURFACE_NAMES.map((surface) => [surface, new Map()]));
  for (const item of entries) {
    if (item.owner === null) throw new Error(`inventory entry '${item.category}: ${item.spelling}' carries no owning table, so no surface can claim it`);
    const surface = surfaceOfPath(item.owner);
    if (surface === null) continue;
    const named = published.get(surface);
    if (named === undefined) throw new Error(`'${item.owner}' resolves to unknown surface '${surface}'`);
    const key = `${item.category}:${item.key}`;
    const existing = named.get(key);
    if (existing === undefined) named.set(key, { spelling: item.spelling, tables: new Set([item.table]) });
    else existing.tables.add(item.table);
  }

  const beneath = new Map([["core", new Set()]]);
  for (const { extension } of extensionOwners) {
    const surface = surfaceOfPackage.get(extension.id);
    if (surface === undefined || surface === null) {
      failures.push(`extension '${extension.id}' has no surface, so the surfaces beneath it cannot be read`);
      continue;
    }
    beneath.set(surface, surfacesBeneath(extension, surfaceOfPackage));
  }
  // Closed transitively, so a surface composed of a surface that composes
  // another subtracts all three. One pass per surface is enough for a graph
  // this small, and a cycle would simply stop adding.
  for (let pass = 0; pass < SURFACE_NAMES.length; pass += 1) {
    for (const [surface, under] of beneath) {
      for (const name of [...under]) for (const deeper of beneath.get(name) ?? []) under.add(deeper);
      under.delete(surface);
    }
  }

  const surfaces = new Map();
  for (const surface of SURFACE_NAMES) {
    const under = beneath.get(surface) ?? new Set();
    const inherited = new Set([...under].flatMap((name) => [...(published.get(name) ?? new Map()).keys()]));
    const names = new Map([...published.get(surface) ?? new Map()].filter(([key]) => !inherited.has(key)));
    surfaces.set(surface, { names, beneath: [...under].sort(), published: (published.get(surface) ?? new Map()).size });
  }
  return { surfaces, failures };
}
