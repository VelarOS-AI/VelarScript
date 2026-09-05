/**
 * Which compiler extensions a documentation fence is written against.
 *
 * D114: `check-documentation-examples.mjs` compiles every fence and
 * `check-fence-format.mjs` formats it, and both have to answer this the same
 * way — a fence formatted against Core syntax but compiled against the Web
 * extension is a fence the two gates disagree about. One answer, read by both.
 */
import { inspectModule } from "@velarscript/compiler";
import { isNodeOnlyModule, velarNodeCompilerExtension } from "@velarscript/node/compiler";
import { velarCompilerExtension as velarDesktopCompilerExtension } from "@velarscript/desktop/compiler";
import { velarCompilerExtension as velarServerCompilerExtension } from "@velarscript/server/compiler";
import { velarCompilerExtension } from "@velarscript/web/compiler";

/**
 * The compiler extensions an example is written against. Documentation covers
 * three official targets, and the Web extension replaces shared standard-module
 * interfaces with their browser contracts — `velar/http` exports `secretHeader`
 * on Node but not on the Web, where a process environment does not exist. An
 * example the Web target cannot satisfy — it imports a Node-only module, or a
 * name the browser contract does not export — is therefore a Core/CLI
 * illustration and is checked as a Core project. An import from `velar/server`
 * selects the Server application extension; an import from a Desktop-owned
 * module selects the Desktop application extension, without which every name
 * `velar/window` publishes is an unresolved reference that suppresses its own
 * diagnostic and stops the analyzer downstream — a Desktop example nothing
 * checks. Otherwise a parsed Node `server` symbol selects the low-level Node
 * extension that owns it. Everything else is checked with the Web extension
 * loaded, which owns JSX, components, and Node-module rejection.
 */
export function exampleExtensions(source, file) {
  if (['"velar/desktop"', '"velar/desktop-test"', '"velar/window"', '"velar/service"', '"velar/notification"', '"velar/secure-storage"']
    .some((module) => source.includes(module))) {
    return [velarDesktopCompilerExtension];
  }
  const serverOwned = source.includes('"velar/server"');
  const nodeExtension = serverOwned ? velarServerCompilerExtension : velarNodeCompilerExtension;
  if (serverOwned) return [nodeExtension];
  const nodeInspection = inspectModule(source, { path: file, extensions: [nodeExtension] });
  if (nodeInspection.semanticIndex.symbols.some((symbol) => symbol.kind === "extension:variable:node-server")) {
    return [nodeExtension];
  }
  const inspection = inspectModule(source, { path: file, extensions: [velarCompilerExtension] });
  const webInterfaces = velarCompilerExtension.modules?.interfaces ?? new Map();
  for (const dependency of inspection.dependencies) {
    if (dependency.javascript) continue;
    if (isNodeOnlyModule(dependency.source)) return [];
  }
  for (const imported of inspection.semanticIndex.imports) {
    if (imported.namespace) continue;
    const interface_ = webInterfaces.get(imported.source);
    if (interface_ === undefined) continue;
    if (!webTargetProvides(interface_, imported.imported)) return [];
  }
  return [velarCompilerExtension];
}

function webTargetProvides(interface_, name) {
  return interface_.exports.has(name)
    || interface_.namedTypes.has(name)
    || interface_.typeAliases.has(name)
    || interface_.enums.has(name)
    || interface_.classes.has(name);
}
