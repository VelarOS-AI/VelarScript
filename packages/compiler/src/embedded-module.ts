import type {
  EmbeddedJavaScriptDeclaration,
  EmbeddedJavaScriptDependency,
  ExternModuleDeclaration,
  ImportDeclaration,
  ImportSpecifier,
  Program,
  Statement,
} from "./ast.ts";

/** Stable sibling ESM name shared by analysis and emission. */
export function embeddedJavaScriptSpecifier(sourcePath: string, ordinal: number): `./${string}.js` {
  const file = sourcePath.replaceAll("\\", "/").split("/").at(-1) ?? "module.vel";
  const rawStem = file.replace(/\.vel$/u, "");
  const stem = rawStem.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "module";
  // Two source basenames can normalize to the same filesystem-safe stem
  // (`a b.vel` and `a-b.vel`). The exact-name digest keeps their sibling
  // artifacts distinct without making output depend on the checkout path.
  let digest = 0x811c9dc5;
  for (let index = 0; index < rawStem.length; index += 1) {
    digest ^= rawStem.charCodeAt(index);
    digest = Math.imul(digest, 0x01000193);
  }
  return `./${stem}.${(digest >>> 0).toString(36)}.embedded-${ordinal + 1}.js`;
}

/**
 * Presents embedded-JS contracts to the existing extern/import analyzer
 * machinery without publishing the generated sibling as a project dependency.
 * Project resolution and dependency walks continue to consume the original
 * program; only semantic analysis and interface construction see this view.
 */
export function programWithEmbeddedJavaScriptImports(program: Program, sourcePath: string): Program {
  let ordinal = 0;
  const body: Statement[] = [];
  for (const statement of program.body) {
    if (statement.kind !== "EmbeddedJavaScriptDeclaration") {
      body.push(statement);
      continue;
    }
    const specifier = embeddedJavaScriptSpecifier(sourcePath, ordinal++);
    if (statement.contract) body.push(syntheticExternModule(statement, specifier));
    body.push(syntheticImport(statement, specifier));
    for (const dependency of statement.dependencies) body.push(syntheticDependencyImport(statement, dependency));
    body.push(statement);
  }
  return { ...program, body };
}

function syntheticExternModule(
  statement: EmbeddedJavaScriptDeclaration,
  source: string,
): ExternModuleDeclaration {
  return {
    kind: "ExternModuleDeclaration",
    source,
    functions: statement.contract!.functions,
    constants: statement.contract!.constants,
    classes: statement.contract!.classes,
    span: statement.contract!.span,
  };
}

function syntheticImport(
  statement: EmbeddedJavaScriptDeclaration,
  source: string,
): ImportDeclaration {
  const specifiers: ImportSpecifier[] = (statement.contract
    ? [
      ...statement.contract.functions.map((item) => ({ name: item.name, span: item.span })),
      ...statement.contract.constants.map((item) => ({ name: item.name, span: item.span })),
      ...statement.contract.classes.map((item) => ({ name: item.name, span: item.span })),
    ]
    : statement.exports.map((item) => ({ name: item.name, span: item.nameSpan })))
    .map((item) => ({ imported: item.name, local: item.name, namespace: false, span: item.span }));
  return {
    kind: "ImportDeclaration",
    source,
    sourceSpan: { start: statement.span.start, end: statement.span.start },
    javascript: true,
    unsafe: statement.unsafe,
    specifiers,
    span: statement.span,
  };
}

/**
 * The block's own JavaScript imports, presented so that a module-resolution
 * failure lands on the specifier that caused it. The sibling import above
 * names the generated module, so without these every package a block imports
 * would report against the block header — a caret at `unsafe js\``, in the one
 * feature whose justification is that the escape hatch stays debuggable. These
 * bind no names: the block's own JavaScript already binds them, and the
 * project's dependency walk still reads the original program.
 */
function syntheticDependencyImport(
  statement: EmbeddedJavaScriptDeclaration,
  dependency: EmbeddedJavaScriptDependency,
): ImportDeclaration {
  return {
    kind: "ImportDeclaration",
    source: dependency.source,
    sourceSpan: dependency.span,
    javascript: true,
    unsafe: statement.unsafe,
    specifiers: [],
    span: dependency.span,
  };
}
