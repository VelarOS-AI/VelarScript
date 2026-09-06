/**
 * What a component's refusals say — the JSX element a call was reaching for,
 * the contract a `ref` needs, and the four "how many of this section" rules a
 * body earns once its statements are read.
 *
 * D115 §三: these are sentence-building questions about a component's shape,
 * and none of them needs the analyzer's walk state, so they read as free
 * functions in their own module rather than as methods in the middle of it.
 */
import { type Diagnostic, type Span } from "@velarscript/compiler";
import { describeType, isInvalidType, type Expression, type ValueType } from "@velarscript/compiler/extension";
import { type WebComponentType } from "../types.ts";

const diagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan });

/**
 * D114 0.29.0 JX-I1: calling a component is one mistake, and a named argument
 * is how it is spelled rather than a second one. The named form therefore
 * extends the same sentence with the element the author meant — and only that
 * sentence, so `Card("a")` and `Card(title="a")` each report once.
 */
export function componentCallRefusal(
  name: string | null,
  arguments_: readonly Expression[],
  argumentNames: readonly (string | null)[] | undefined,
  sourceText: string,
): string {
  const subject = name ? `Render component '${name}' with JSX` : "Render a Component value with JSX";
  if (!argumentNames?.some((argument) => argument !== null)) return subject;
  const element = componentElementSpelling(name, arguments_, argumentNames, sourceText);
  return `${subject}${element === null ? "" : ` — write '${element}'`}; components take JSX props rather than named call arguments`;
}

/**
 * The JSX element a named-argument component call was reaching for, or null
 * when the call does not spell one: an unnamed `Component` value has no tag to
 * write, and a positional argument has no prop name. A string literal keeps
 * JSX's quoted attribute form; every other value takes the braces JSX requires,
 * and both are sliced from the author's own source so the answer is the line he
 * can paste back.
 */
function componentElementSpelling(
  name: string | null,
  arguments_: readonly Expression[],
  argumentNames: readonly (string | null)[],
  sourceText: string,
): string | null {
  if (name === null || arguments_.length === 0) return null;
  const attributes: string[] = [];
  for (const [index, argument] of arguments_.entries()) {
    const propName = argumentNames[index] ?? null;
    const written = sourceText.slice(argument.span.start, argument.span.end);
    if (propName === null || written === "" || /[\n\r]/u.test(written)) return null;
    const literal = argument.kind === "LiteralExpression" && typeof argument.value === "string";
    attributes.push(`${propName}=${literal ? written : `{${written}}`}`);
  }
  return `<${name} ${attributes.join(" ")} />`;
}

/**
 * D114 0.29.0 LC-I2: two different mistakes used to share one sentence. A
 * component declared without `exposes` really does expose no Handle. A
 * one-argument `Component<Props>` contract is a different failure: the
 * constructor behind it may expose a Handle exactly as its author intended, and
 * what withholds `ref` is the contract's missing second type argument (§14). So
 * the contract is answered with the contract it needs, spelling the Handle the
 * ref binding already declares when it declares one.
 */
export function componentRefHandleRefusal(tag: string, component: WebComponentType, stored: ValueType): string {
  if (component.role !== "contract") return `Component '${tag}' does not expose a Handle`;
  const known = stored.kind !== "null" && stored.kind !== "unknown" && stored.kind !== "any" && !isInvalidType(stored);
  const handleType: ValueType = known ? stored : { kind: "named", name: "Handle" };
  const widened = describeType({ ...component, arguments: [handleType] });
  return `The contract on '${tag}' names no Handle, so it does not authorise a component ref — the authority is the contract's second type argument,`
    + ` not the component behind it; declare the contract as '${widened}'`;
}

export interface ComponentSectionCounts {
  readonly renders: number;
  readonly mounted: number;
  readonly cleanup: number;
  readonly exposes: number;
}

/**
 * D114 0.29.0 JX-I2: VEL5008 names the two ways out, because it is the only
 * message this shape earns now — a `return` inside a `match` arm or an `if` is
 * where the count usually goes wrong, and the author who reads "exactly one"
 * has branches already written that he needs told what to do with.
 */
export function componentSectionCountDiagnostics(
  name: string,
  counts: ComponentSectionCounts,
  declarationSpan: Span,
  handleTypeSpan: Span | null,
): readonly Diagnostic[] {
  const reports: Diagnostic[] = [];
  if (counts.renders !== 1) {
    reports.push(diagnostic(
      "VEL5008",
      `Component '${name}' must have exactly one top-level return: assign the branches to a binding — 'let node: WebNode = <span />' written in each arm — and return it once,`
      + " or move the branching into a 'def' that returns WebNode and return its call",
      declarationSpan,
    ));
  }
  if (counts.mounted > 1) reports.push(diagnostic("VEL5009", `Component '${name}' has more than one '@mounted' block`, declarationSpan));
  if (counts.cleanup > 1) reports.push(diagnostic("VEL5010", `Component '${name}' has more than one '@cleanup' block`, declarationSpan));
  if (counts.exposes > 1) reports.push(diagnostic("VEL5056", `Component '${name}' has more than one expose declaration`, declarationSpan));
  if (handleTypeSpan && counts.exposes === 0) {
    reports.push(diagnostic("VEL5056", `Component '${name}' declares an exposed Handle but does not provide an expose value`, handleTypeSpan));
  }
  return reports;
}

/**
 * D114 0.29.0 ST-D1: a `resource` publishes four reactive fields, and the
 * surface carrying them is not one of them — the handle is built once and never
 * replaced, so `watch profile:` compiled clean and never ran. The sentence
 * VEL5064 already had names the answer ("or a resource field"); what was
 * missing was this shape's place in the criterion, so the fields are spelled
 * out here.
 */
export function watchedResourceSurfaceRefusal(name: string): string {
  return `This watch subject never changes, so its body can never run — '${name}' is the resource itself rather than one of the fields it publishes;`
    + " watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run:"
    + ` 'watch ${name}.value:' for the loaded value, 'watch ${name}.loading:' for the load's progress, or the input the load reads`;
}
