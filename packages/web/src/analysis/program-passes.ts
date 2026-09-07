/**
 * One Web module analyzed end to end: the tables the whole-program rules are
 * read out of, the two refusals that are decided before the core walk starts,
 * and the three reports that can only be written once it has ended.
 *
 * D115 P4 R3c. The sequence is one function because the *order* is the rule —
 * the Look and reactive tables have to exist before any statement is walked, the
 * two module-level refusals land at their declarations rather than at a later
 * use, and each closing report needs the whole module's evidence. The core walk
 * itself stays on the analyzer, which is the only thing that can reach it, and
 * arrives here as `analyzeCore`.
 */
import { type Diagnostic, type Span } from "@velarscript/compiler";
import { type Program } from "@velarscript/compiler/extension";
import { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX, browserTestImportGuidance } from "../browser-test.ts";
import { collectLookStaticScope, type LookStaticScope, type LookStaticValue } from "../look-static.ts";
import { type WebJsxAttribute as JSXAttribute, type WebJsxElementExpression as JSXElementExpression, type WebLookExpression } from "../ast.ts";
import { WEB_OWNED_TYPE_NAMES } from "../types.ts";
import { adviseKeyedListRebuilds, collectModuleFunctions, type FunctionDeclarationStatement, type KeyedRebuildHost } from "./keyed-rebuild.ts";
import { collectLookDeclarations } from "./look-conditions.ts";
import { collectLookBuilderNames, collectLookImportSite, type LookImportSite } from "./look-sites.ts";
import { collectPublicConfigNames } from "./public-config.ts";
import { collectDerivedReactiveNames, collectReactiveDerivations, collectReactiveStateNames } from "./reactive-names.ts";
import { reportRetiredComputedFunction, type RetiredAccessorHost } from "./reactivity/retired-accessors.ts";
import { collectReactiveWriters, type ReactiveWriterDeclaration } from "./watch-cycles.ts";
import { diagnostic } from "./web-types.ts";

/**
 * The module-wide tables this pass fills, and the two module readings the
 * before-and-after refusals need. Every table is written here and read by a
 * collaborator that declares it `readonly`, which is why they are accessor
 * pairs on the analyzer rather than plain fields on the host.
 */
export interface ProgramTableHost {
  /** Every name in this module whose read is reactive without the binding being a state/prop reference. */
  readonly derivedReactiveNames: Set<string>;
  /** The `velar/look` values this module imported, which seed the compile-time Look scope. */
  readonly importedLookStaticValues: ReadonlyMap<string, LookStaticValue>;
  /** D89 A4: the binding identity of every list a keyed `.map(...)` interpolation renders. */
  readonly keyedListSources: Set<string>;
  /** D57 rule 138: `velar/web-test` is legal only where the browser runner looks. */
  readonly webModulePath: string | null;

  /** The elements whose `key` the keyed fast path will actually read. */
  readonly honoredJsxKeys: ReadonlySet<JSXElementExpression>;
  /** Elements already answered for an ineffective key, so this pass does not repeat one. */
  readonly reportedJsxKeys: ReadonlySet<JSXElementExpression>;
  /** Every `key` written on a statically placed element, judged once the walk has ended. */
  readonly staticJsxKeys: readonly { readonly element: JSXElementExpression; readonly attribute: JSXAttribute }[];

  lookBuilderNames: ReadonlyMap<string, string>;
  lookDeclarations: ReadonlyMap<string, WebLookExpression | null>;
  lookImport: LookImportSite | null;
  lookStatic: LookStaticScope;
  moduleFunctions: ReadonlyMap<string, FunctionDeclarationStatement | null>;
  publicConfigNames: ReadonlySet<string>;
  reactiveDerivations: ReadonlyMap<string, ReadonlySet<string> | null>;
  reactiveStateNames: ReadonlyMap<string, boolean>;
  reactiveWriters: ReadonlyMap<string, ReactiveWriterDeclaration | null>;

  readonly diagnostics: Diagnostic[];
  markTypeNameRefused(name: string): void;
}

/**
 * What the program passes ask of the analyzer that hosts them: the tables above,
 * plus everything the two closing reports need — the keyed-rebuild advisory and
 * the retired-accessor migration are the last two passes, so this face really
 * does contain theirs.
 */
export type ProgramPassHost = ProgramTableHost & KeyedRebuildHost & RetiredAccessorHost;

export function analyzeWebProgram(host: ProgramPassHost, program: Program, analyzeCore: (program: Program) => void): readonly Diagnostic[] {
  host.lookStatic = collectLookStaticScope(program, host.importedLookStaticValues);
  host.lookBuilderNames = collectLookBuilderNames(program);
  host.publicConfigNames = collectPublicConfigNames(program);
  host.lookImport = collectLookImportSite(program);
  host.lookDeclarations = collectLookDeclarations(program);
  for (const name of collectDerivedReactiveNames(program)) host.derivedReactiveNames.add(name);
  reportBrowserTestImports(host, program);
  rejectWebOwnedTypeNames(host, program);
  host.keyedListSources.clear();
  host.keyedListRebuilds.length = 0;
  host.moduleFunctions = collectModuleFunctions(program);
  host.reactiveWriters = collectReactiveWriters(program);
  host.reactiveDerivations = collectReactiveDerivations(program);
  host.reactiveStateNames = collectReactiveStateNames(program);
  analyzeCore(program);
  reportStaticJsxKeys(host);
  reportRetiredComputedFunction(host);
  adviseKeyedListRebuilds(host);
  return host.diagnostics;
}

/**
 * D57 rule 138: `velar/web-test` only has a runtime under `velar test
 * --browser`, so an import of it anywhere else compiles a call that cannot
 * succeed. D51 rule 109 puts the refusal at the declaration rather than at the
 * eventual use, so the error lands on the `import` line — including the
 * JavaScript-bridge and re-export spellings, which reach the same runtime.
 */
export function reportBrowserTestImports(host: ProgramPassHost, program: Program): void {
  if ((host.webModulePath ?? "").endsWith(BROWSER_TEST_SOURCE_SUFFIX)) return;
  for (const statement of program.body) {
    if (statement.kind !== "ImportDeclaration" && statement.kind !== "ReExportDeclaration") continue;
    if (statement.source !== BROWSER_TEST_MODULE) continue;
    host.diagnostics.push(diagnostic("VEL5062", browserTestImportGuidance(), statement.sourceSpan));
  }
}

/**
 * D72 rule 186: a Web module publishes its own type names, and a user
 * declaration of one used to be accepted at the declaration and then lose at
 * every use — `type Event:` compiled, and `describe({kind: "charge"})` was
 * told it could not assign to `Event`, naming a type the author had just
 * written. D51 rule 109 already settled where that refusal belongs: at the
 * declaration, which is the only place a rename is cheap.
 *
 * The names come from the extension's own published table, so adding a type
 * to `WEB_OWNED_TYPE_NAMES` extends this protection with it. The last time
 * this family was repaired by listing names instead of deriving them, the
 * list drifted; D57 rule 135 is the same repair on the Core roster.
 *
 * Core now says the same sentence about its own built-in type names —
 * `builtinTypeNameDeclarationMessage` in packages/compiler/src/analyzer.ts,
 * reported as VEL3007. The rosters differ; the wording is meant to read
 * alike, so a change to either sentence belongs in both.
 *
 * `Duration` is on both rosters — Core owns it as a primitive and
 * `velar/look` republishes it — so a Web module used to report it twice. This
 * refusal is the more specific of the two, because it names the surface the
 * author is writing against, so it marks the name refused and Core's stays
 * unsaid. The mark is Core's own hook, which is what lets this pass take
 * precedence without either side learning the other's roster.
 */
export function rejectWebOwnedTypeNames(host: ProgramPassHost, program: Program): void {
  const reject = (name: string, errorSpan: Span, noun: string): void => {
    if (!WEB_OWNED_TYPE_NAMES.has(name)) return;
    host.markTypeNameRefused(name);
    host.diagnostics.push(diagnostic(
      "VEL5065",
      `'${name}' is a Web type name, so it cannot also name ${/^[aeiou]/iu.test(noun) ? "an" : "a"} ${noun}; every use of it in a Web module resolves to the built-in. Rename this declaration`,
      errorSpan,
    ));
  };
  for (const statement of program.body) {
    switch (statement.kind) {
      case "TypeDeclaration":
      case "TypeAliasDeclaration":
        reject(statement.name, statement.span, "type");
        break;
      case "ClassDeclaration":
        reject(statement.name, statement.span, "class");
        break;
      case "EnumDeclaration":
        reject(statement.name, statement.span, "enum");
        break;
      case "ExternModuleDeclaration":
        for (const declaration of statement.classes) reject(declaration.name, declaration.span, "extern class");
        break;
      case "ImportDeclaration":
        // A standard-module import of the name under itself *is* the built-in
        // — `import {Color, Length} from "velar/look"` is how a module names
        // the published types — so only a binding that would make the name
        // mean something else is refused.
        if (statement.source.startsWith("velar/")) {
          for (const specifier of statement.specifiers) {
            if (specifier.local !== specifier.imported) reject(specifier.local, statement.span, "import alias");
          }
          break;
        }
        for (const specifier of statement.specifiers) {
          reject(specifier.local, statement.span, specifier.local === specifier.imported ? "imported name" : "import alias");
        }
        break;
      default:
        break;
    }
  }
}

/**
 * WEB-C1: charter §14 promises that a key outside a keyed shape is a
 * diagnostic rather than a silent no-op. Interpolated positions report while
 * their interpolation is walked; static positions are collected during JSX
 * inference and reported once every keyed interpolation is known.
 */
export function reportStaticJsxKeys(host: ProgramPassHost): void {
  for (const { element, attribute } of host.staticJsxKeys) {
    if (host.honoredJsxKeys.has(element) || host.reportedJsxKeys.has(element)) continue;
    host.diagnostics.push(diagnostic(
      "VEL5050",
      `This JSX key has no effect: '<${element.tag}>' is rendered in a fixed position, and keys reuse children by identity only inside 'items.map(item => <Row key={item.id} />)' — remove the key, or render this element from a keyed .map()`,
      attribute.span,
    ));
  }
}
