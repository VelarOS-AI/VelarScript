/**
 * D115 P4 R4c — the prose an editor shows for compiler-owned vocabulary, and
 * the completion roster derived from it.
 *
 * `completionItemsFor` stays exported through `language-server.ts` because
 * three tests read the roster without starting a server.
 */
import {
  CORE_CONTEXTUAL_KEYWORD_WORDS,
  CORE_PRELUDE_NAMES,
  keywordKinds,
  PERMANENT_NAMESPACE_NAMES,
  permanentNamespaceCoveringModule,
  type CorePreludeName,
  type PermanentNamespaceName,
} from "@velarscript/compiler";
import type { ProjectResult } from "../project.ts";
import {
  standardModuleDocumentation,
  standardNamespaceDocumentation,
} from "../standard-api-documentation.ts";
import { standardModuleInterfaces } from "../standard-modules.ts";

export const keywordDocumentation = new Map<string, string>([
  ["assert", "Requires a boolean or optional invariant and narrows stable values in following statements."],
  ["not", "Negates a checked condition; use `not in` for negative membership and `is not` for a negative runtime type test."],
  ["in", "Tests List, Set, Map, Record, or string membership; `not in` is its direct negative form."],
  ["is", "Tests a value against a runtime type and narrows stable locations; `is not` is its direct negative form."],
  ["constructor", "Initializes class fields and calls super(...) first when the class extends another class."],
  ["type", "Declares one data shape used for static checking and runtime validation."],
  ["enum", "Declares a finite set of string-backed values for application states."],
  ["abstract", "Marks a class, instance method, or getter as an incomplete behavior contract."],
  ["extends", "Declares one base class or one concrete record base; classes call super(...) while record types inherit fields and validation."],
  ["override", "Explicitly replaces a compatible inherited instance method or getter."],
  ["private", "Keeps one class field, getter, or method inside its declaring class."],
  ["static", "Declares a field, getter, or method on the class rather than an instance."],
  ["get", "Declares a typed read-only property computed when it is read."],
  ["super", "Calls the base constructor or reads and calls inherited behavior."],
  ["def", "Declares a named function with an indentation-based body."],
  ["match", "Selects literal, enum, type, object, or List patterns with bindings and guards, without fallthrough."],
  ["case", "Declares a match pattern; object and List patterns may destructure values with ...rest and as bindings."],
  ["const", "Declares an initialized binding that cannot be rebound."],
  ["let", "Declares an initialized binding that can be rebound."],
  ["readonly", "Creates a transitive compile-time view over data records and collections without changing runtime identity."],
  ["null", "The only empty value in ordinary VelarScript source; undefined is not exposed."],
  ["@main", [
    "Defines the compiler-owned entry region of a module. It is not a decorator, exported function, or runtime name.",
    "",
    "```velar",
    "@main:",
    "    const application = createApplication()",
    "    await application.start()",
    "```",
    "",
    "Only a module selected as a program entry executes this region. Importing the same module checks its declarations without running `@main`. A one-statement body may stay on the header line: `@main: run()`.",
  ].join("\n")],
  ["@context", [
    "Adds one optional, compiler-owned business context name to the following top-level declaration or framework structure. It is static metadata, not a decorator or runtime wrapper.",
    "",
    "```velar",
    "@context(\"Order checkout\")",
    "export def submitOrder(order: Order):",
    "    orders.save(order)",
    "```",
    "",
    "The name helps human structure views group application logic and helps AI select compact semantic context. It creates no scope and does not change execution.",
  ].join("\n")],
  ["@dispose", [
    "Defines a class's compiler-owned release contract. It is not a decorator or callable method; `using` runs it on every exit from the owning scope.",
    "",
    "```velar",
    "class Session:",
    "    @dispose:",
    "        self.close()",
    "",
    "using session = Session()",
    "```",
    "",
    "A class may declare at most one `@dispose:` block. Derived cleanup composes with the base contract in release order.",
  ].join("\n")],
  ["@iterate", [
    "Defines what iterating a class means. It is a compiler-owned class contract, not a decorator, method, or user extension point.",
    "",
    "```velar",
    "class Bag:",
    "    let items: List<string> = []",
    "",
    "    @iterate:",
    "        return self.items",
    "```",
    "",
    "Return a `List`, `Set`, `Map`, or `Record` for plain `for`. Returning `T?` declares the asynchronous pull form used by `async for`, where one pull returns one item and `null` ends the stream.",
  ].join("\n")],
]);

export const builtinTypeDocumentation = new Map<string, string>([
  ["string", "A JavaScript string with VelarScript text operations."],
  ["number", "A JavaScript number type; number(text) strictly parses complete finite decimal text and returns number?."],
  ["bool", "The `true` or `false` boolean type."],
  ["unknown", "An unchecked boundary value that must be validated before ordinary use."],
  ["List", "An ordered collection with one checked element type."],
  ["Map", "An insertion-ordered JavaScript Map with checked key and value types."],
  ["Record", "A JSON-safe plain record with dynamic string keys and one checked value type."],
  ["Set", "An insertion-ordered JavaScript Set with one checked element type."],
  ["Promise", "A JavaScript Promise with one checked resolved-value type."],
  ["Duration", "A Core duration value written with an ms or s suffix."],
]);

// D57 rules 134/136: both halves of this list are derived. The prelude and
// namespace entries are keyed by the Core vocabulary roster, so a name added
// there cannot be missing here — the hand-kept version had already lost `Math`
// and `number`. The module entries are filtered by the migration state, so a
// completion cannot offer an import VEL3008 refuses on the next keystroke.
const corePreludeCompletionDetail: Record<CorePreludeName, string> = {
  number: "number(text) -> number? — text to number, null when the text is not numeric",
  str: "str(value) -> string",
  print: "print(value) -> null",
  equals: "equals(a, b) -> bool — deep structural comparison over data",
  range: "range(stop) or range(start, stop, step) -> List<number>",
};

const permanentNamespaceCompletionDetail: Record<PermanentNamespaceName, string> = {
  Json: "Permanent namespace for parse, tryParse, stringify, stableStringify, clone, and isSerializable",
  Promise: "Permanent namespace for all, race, sleep, timeout, retry, map, and series",
  Text: "Permanent namespace for Unicode-aware text normalization, formatting, code points, and patterns",
  Math: "Permanent namespace for numeric constants, transforms, transcendentals, and random helpers",
};

export function corePreludeDocumentation(label: CorePreludeName): string {
  const detail = corePreludeCompletionDetail[label];
  const invocation = /^[^(]+\([^)]*\)/u.exec(detail)?.[0] ?? `${label}(...)`;
  const usage = /->\s*null(?:\s|$)/u.test(detail) ? invocation : `const result = ${invocation}`;
  return [
    `\`${label}\` is a compiler-owned VelarScript prelude API and needs no import.`,
    "",
    "```velar",
    usage,
    "```",
    "",
    `Checked contract: \`${detail}\`.`,
  ].join("\n");
}

const standardModuleCompletionDetail = new Map([
  ["velar/math", "Numeric constants, transforms, and random helpers"],
  ["velar/async", "Promise composition, timeout, retry, and concurrency helpers"],
  ["velar/url", "URL parsing, joining, encoding, and query helpers"],
  ["velar/time", "Timestamps, ISO values, formatting, and date-part helpers"],
  ["velar/id", "Secure host UUID generation and validation"],
  ["velar/log", "Structured leveled logging with scoped loggers and replaceable sinks"],
  ["velar/test", "Typed deep, collection, error, and Promise assertions"],
]);

function importableStandardModules(): readonly { readonly label: string; readonly kind: number; readonly detail: string; readonly documentation?: string }[] {
  const interfaces = standardModuleInterfaces();
  return [...standardModuleCompletionDetail]
    .filter(([source]) => permanentNamespaceCoveringModule(source, interfaces.get(source)?.exports.keys() ?? []) === null)
    .map(([label, detail]) => ({
      label,
      kind: 9,
      detail,
      ...(standardModuleDocumentation(label, []) ? { documentation: standardModuleDocumentation(label, [])! } : {}),
    }));
}

/**
 * D62 rule 157: the editor's keyword list is the lexer's hard-keyword table
 * plus Core's contextual roster, read rather than retyped. The hand-kept copy
 * this replaced held thirty-nine labels and was a partial copy of both: it had
 * never learned `js`, `unsafe`, `extern`, `module`, `break`, `continue` or
 * `is`, and it knew six of the ten contextual words. Neither omission could
 * have been noticed by anything but a reader counting two lists by hand.
 */
const coreCompletionItems = [
  ...[...Object.keys(keywordKinds), ...CORE_CONTEXTUAL_KEYWORD_WORDS].map((label) => ({
    label,
    kind: 14,
    ...(keywordDocumentation.get(label) ? { documentation: keywordDocumentation.get(label)! } : {}),
  })),
  ...[...builtinTypeDocumentation].map(([label, detail]) => ({ label, kind: 7, detail, documentation: detail })),
  ...CORE_PRELUDE_NAMES.map((label) => ({
    label,
    kind: 3,
    detail: corePreludeCompletionDetail[label],
    documentation: corePreludeDocumentation(label),
  })),
  ...PERMANENT_NAMESPACE_NAMES.map((label) => ({
    label,
    kind: 6,
    detail: permanentNamespaceCompletionDetail[label],
    ...(standardNamespaceDocumentation(label, []) ? { documentation: standardNamespaceDocumentation(label, [])! } : {}),
  })),
  ...importableStandardModules(),
];

export function completionItemsFor(project: ProjectResult | null): readonly { readonly label: string; readonly kind: number; readonly detail?: string; readonly documentation?: string }[] {
  if (!project) return coreCompletionItems;
  return [
    ...coreCompletionItems,
    ...project.compilerExtensions.flatMap((extension) => [
      ...(extension.editor?.completions ?? []),
      ...Object.entries(extension.editor?.typeDocumentation ?? {}).map(([label, detail]) => ({ label, kind: 7, detail, documentation: detail })),
    ]),
  ];
}

export function extensionDocumentation(
  project: ProjectResult | null,
  kind: "keywordDocumentation" | "typeDocumentation",
  word: string,
): string | undefined {
  for (const extension of project?.compilerExtensions ?? []) {
    const documentation = extension.editor?.[kind]?.[word];
    if (documentation) return documentation;
  }
  return undefined;
}
