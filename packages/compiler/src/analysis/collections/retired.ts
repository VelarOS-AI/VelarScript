/**
 * The migration off `velar/collections`: which of its exports retired into
 * which List member, the one report each retired name earns, and the rewrite
 * that moves a module off the module in one pass.
 *
 * D115 §三: this was the tail of `analysis/collections.ts`, which owns what a
 * collection *is*. What a retired import spelling becomes is a different
 * subject — it reads the module's imports and its call sites, not any
 * collection's members — so it is its own module of the collection directory,
 * which keeps only the roster question `retiredCollectionExport` answers.
 */
import { type Expression, type Program, type Statement } from "../../ast.ts";
import { mechanicalEdits, recoveredDiagnostic, type Diagnostic, type DiagnosticEdit, type DiagnosticFix } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";


/**
 * D114 S3 / D35: `velar/collections` retired. Twelve of its exports duplicated
 * a List method word for word, four were `get`/`slice` under other names, three
 * survived only because the method side lacked `min(by=)`, `max(by=)` and a
 * descending order, and the rest are List members now. `range` is unaffected —
 * it was already the Core prelude name, and its import keeps the VEL3008 the
 * roster above reports.
 *
 * Each entry carries the retired function's own parameter names, so a
 * named-argument call can be read back into positions before it is rewritten,
 * and the member call that replaces it. A `rewrite` of null is guidance only:
 * `enumerate`'s `{index, value}` records have consumers no edit can reach.
 */
export interface RetiredCollectionExport {
  /** The retired function's declared parameters, first one being the receiver. */
  readonly parameters: readonly string[];
  readonly guidance: string;
  readonly rewrite: {
    readonly member: string;
    /** Literal arguments the member call leads with, e.g. `get(0)` for `first`. */
    readonly fixedArguments: readonly string[];
    /** The name each remaining retired argument is passed under; null is positional. */
    readonly argumentNames: readonly (string | null)[];
    /** `repeat(value, count)` repeats a one-element List, so its receiver is `[value]`. */
    readonly receiverIsListOfArgument?: true;
  } | null;
}

const RETIRED_COLLECTION_MODULE = "velar/collections";

function retiredCollectionEntry(
  parameters: readonly string[],
  guidance: string,
  rewrite: RetiredCollectionExport["rewrite"],
): RetiredCollectionExport {
  return { parameters, guidance: `${guidance}; velar/collections retired into checked List members`, rewrite };
}

function retiredCollectionMethod(
  parameters: readonly string[],
  member: string,
  argumentNames: readonly (string | null)[] = parameters.slice(1).map(() => null),
): RetiredCollectionExport {
  const rendered = parameters.slice(1)
    .map((name, index) => (argumentNames[index] ? `${argumentNames[index]}=${name}` : name))
    .join(", ");
  return retiredCollectionEntry(parameters, `Use '${parameters[0]}.${member}(${rendered})'`, {
    member,
    fixedArguments: [],
    argumentNames,
  });
}

const retiredCollectionExports: ReadonlyMap<string, RetiredCollectionExport> = new Map([
  // Exact duplicates: the member takes the same arguments under the same names.
  ["find", retiredCollectionMethod(["values", "test"], "find")],
  ["index", retiredCollectionMethod(["values", "value"], "index")],
  ["has", retiredCollectionMethod(["values", "value"], "has")],
  ["count", retiredCollectionMethod(["values", "value"], "count")],
  ["some", retiredCollectionMethod(["values", "test"], "some")],
  ["every", retiredCollectionMethod(["values", "test"], "every")],
  ["sum", retiredCollectionMethod(["values"], "sum")],
  ["join", retiredCollectionMethod(["values", "separator"], "join")],
  ["reversed", retiredCollectionMethod(["values"], "reversed")],
  // Positional windows the language already spells with `get` and `slice`.
  ["first", retiredCollectionEntry(["values"], "Use 'values.get(0)'", { member: "get", fixedArguments: ["0"], argumentNames: [] })],
  ["last", retiredCollectionEntry(["values"], "Use 'values.get(-1)'", { member: "get", fixedArguments: ["-1"], argumentNames: [] })],
  ["take", retiredCollectionEntry(["values", "count"], "Use 'values.slice(0, count)'", { member: "slice", fixedArguments: ["0"], argumentNames: [null] })],
  ["drop", retiredCollectionEntry(["values", "count"], "Use 'values.slice(count)'", { member: "slice", fixedArguments: [], argumentNames: [null] })],
  // The selector family the method side now completes.
  ["sortBy", retiredCollectionMethod(["values", "key", "descending"], "sorted", ["by", "descending"])],
  ["minBy", retiredCollectionMethod(["values", "key"], "min", ["by"])],
  ["maxBy", retiredCollectionMethod(["values", "key"], "max", ["by"])],
  // The itertools-shaped functions, now members under the same names.
  ["unique", retiredCollectionMethod(["values"], "unique")],
  ["compact", retiredCollectionMethod(["values"], "compact")],
  ["flatten", retiredCollectionMethod(["values"], "flatten")],
  ["chunk", retiredCollectionMethod(["values", "size"], "chunk")],
  ["partition", retiredCollectionMethod(["values", "test"], "partition")],
  ["groupBy", retiredCollectionMethod(["values", "key"], "groupBy")],
  ["keyBy", retiredCollectionMethod(["values", "key"], "keyBy")],
  ["countBy", retiredCollectionMethod(["values", "key"], "countBy")],
  ["zip", retiredCollectionMethod(["left", "right"], "zip")],
  ["repeat", retiredCollectionEntry(["value", "count"], "Use '[value].repeat(count)', which repeats the whole List the way string.repeat does", {
    member: "repeat",
    fixedArguments: [],
    argumentNames: [null],
    receiverIsListOfArgument: true,
  })],
  // D35: the two-slot `for` is the one spelling, and the {index, value}
  // records this produced are read at sites no edit here can see.
  ["enumerate", retiredCollectionEntry(["values", "start"], "Use 'for value, index in values:'", null)],
]);

export function retiredCollectionExport(source: string, name: string): RetiredCollectionExport | null {
  return source === RETIRED_COLLECTION_MODULE ? retiredCollectionExports.get(name) ?? null : null;
}


/** What the migration asks of the analyzer that hosts it, and nothing more. */
export interface RetiredCollectionMigrationHost {
  readonly diagnostics: Diagnostic[];
  readonly sourceText: string;
  renderNamedImport(source: string, specifiers: readonly { readonly imported: string; readonly local: string }[]): string;
}

type ImportSpecifier = Extract<Statement, { kind: "ImportDeclaration" }>["specifiers"][number];
type RetiredCall = Extract<Expression, { kind: "CallExpression" }>;

/**
 * One call site the migration will rewrite, and the entry that says what it
 * becomes. The whole import line's sites are planned together — keyed by the
 * call's own span — because a nested pair like `sum(unique(xs))` is two sites
 * in one expression, and the outer one's replacement text has to be written
 * over the inner one's, not beside it.
 */
interface PlannedRetiredCall {
  readonly call: RetiredCall;
  readonly retired: RetiredCollectionExport;
}

type PlannedRetiredCalls = ReadonlyMap<string, PlannedRetiredCall>;

/** Whether `outer` covers `inner` and is not the same span. */
function encloses(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && inner.end <= outer.end && (outer.start !== inner.start || outer.end !== inner.end);
}

export class RetiredCollectionMigration {
  private readonly host: RetiredCollectionMigrationHost;

  constructor(host: RetiredCollectionMigrationHost) {
    this.host = host;
  }

  // D114 S3: the retired velar/collections names this module imported, the
  // proved reads of each, and the call each read sits in.
  readonly importOrigins = new Map<string, { readonly imported: string; readonly specifier: Span }>();
  readonly importReads: { readonly local: string; readonly imported: string; readonly span: Span }[] = [];
  readonly calls = new Map<string, RetiredCall>();

  register(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" || statement.javascript || statement.source !== RETIRED_COLLECTION_MODULE) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.namespace || !retiredCollectionExports.has(specifier.imported)) continue;
        this.importOrigins.set(specifier.local, { imported: specifier.imported, specifier: specifier.span });
      }
    }
  }

  /**
   * D114 S3: one report per retired name, carrying the rewrite when the whole
   * migration of that name is mechanical — every call site in the module plus
   * the specifier itself. One name at a time, because that is the unit an
   * author reads; the *rewrite* is the whole line's, for the reason `migration`
   * gives.
   *
   * The reports are recovered: the import binds as an unchecked value, so a
   * retirement produces one diagnostic per name instead of that plus a call
   * error at every site it left behind.
   */
  report(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind === "ReExportDeclaration" && statement.source === RETIRED_COLLECTION_MODULE) {
        for (const specifier of statement.specifiers) {
          const retired = retiredCollectionExports.get(specifier.imported);
          if (!retired) continue;
          this.host.diagnostics.push(recoveredDiagnostic(
            "VEL3008",
            `${retired.guidance}; a re-export cannot restore a retired import spelling`,
            specifier.span,
          ));
        }
        continue;
      }
      if (statement.kind !== "ImportDeclaration" || statement.javascript || statement.source !== RETIRED_COLLECTION_MODULE) continue;
      const migration = this.migration(statement);
      for (const specifier of statement.specifiers) {
        if (specifier.namespace) {
          // D50 rule 97.3: the namespace form reaches every retired member at
          // once, so which member each `local.member` read wanted is a rewrite
          // this migration does not claim to know.
          this.host.diagnostics.push(recoveredDiagnostic(
            "VEL3008",
            "velar/collections retired into checked List members; drop the namespace import and call the member on the List — values.groupBy(key)",
            specifier.span,
          ));
          continue;
        }
        const retired = retiredCollectionExports.get(specifier.imported);
        if (!retired) continue;
        this.host.diagnostics.push(recoveredDiagnostic("VEL3008", retired.guidance, specifier.span, migration?.fixes.get(specifier)));
      }
    }
  }

  /**
   * The whole migration of one import line, as one rewrite.
   *
   * Every mechanically migratable name in the line carries the *same* edit
   * list, because the import statement is one span and two rewrites of it
   * cannot both be applied against one snapshot: per-name import edits would
   * make `velar fix` migrate one name per pass and run out of passes on a line
   * that imports more than a handful. Identical edit lists deduplicate in
   * `applyMechanicalFixes`, so the pass applies the migration once and the line
   * is left holding exactly the names no edit can rewrite.
   *
   * D114 0.28.0 D-D1: the line's call sites are planned as one set rather than
   * name by name, because two of them can be the same expression. `velar fix`
   * splices edits into one snapshot and nothing there composes two that
   * overlap, so an outer `sum(...)` and an inner `unique(...)` used to be
   * written over each other — the file was left with an unbalanced ')' , the
   * inner call unrewritten, its import already deleted, and the command
   * reporting success. Only the outermost call of each nest is edited now, and
   * its replacement text is built from the *rewritten* text of everything
   * inside it, so one nest is one edit whose result parses.
   */
  private migration(
    statement: Extract<Statement, { kind: "ImportDeclaration" }>,
  ): { readonly fixes: ReadonlyMap<unknown, DiagnosticFix> } | null {
    if (this.rewriteErasesComment(statement.span)) return null;
    const planned = new Map<string, PlannedRetiredCall>();
    const migrated: { readonly specifier: ImportSpecifier; readonly member: string }[] = [];
    for (const specifier of statement.specifiers) {
      if (specifier.namespace) continue;
      const retired = retiredCollectionExports.get(specifier.imported);
      if (!retired?.rewrite) continue;
      const sites = this.callSites(specifier, retired);
      if (sites === null) continue;
      for (const call of sites) planned.set(spanIdentity(call.span), { call, retired });
      migrated.push({ specifier, member: retired.rewrite.member });
    }
    if (migrated.length === 0) return null;
    const survivors = statement.specifiers.filter((other) => !migrated.some((plan) => plan.specifier === other));
    const edits: DiagnosticEdit[] = this.outermost(planned)
      .map((entry) => ({ span: entry.call.span, text: this.composedCallText(entry, planned) }));
    edits.push(survivors.length === 0
      ? { span: { start: statement.span.start, end: statement.span.end + 1 }, text: "" }
      : {
        span: statement.span,
        text: this.host.renderNamedImport(statement.source, survivors.map((other) => ({ imported: other.imported, local: other.local }))),
      });
    const fix = mechanicalEdits(edits, migrated.length === 1
      ? `Use the List member '.${migrated[0]!.member}()'`
      : "Use the List members that replaced velar/collections");
    return { fixes: new Map(migrated.map((plan) => [plan.specifier, fix])) };
  }

  /**
   * Every call one retired name leaves behind, or null when any read of it is
   * not mechanically rewritable: a read that is not a call, a spread, an
   * argument plan with a hole, or a rewrite that would erase an authored
   * comment. A name with no reads left behind answers with no calls, and its
   * specifier still leaves the import.
   *
   * The shape question is asked against the source as written — nesting cannot
   * make a call rewritable or unrewritable — so this is what decides which
   * names migrate, before any composed text exists.
   */
  private callSites(specifier: ImportSpecifier, retired: RetiredCollectionExport): readonly RetiredCall[] | null {
    const sites: RetiredCall[] = [];
    const seen = new Set<string>();
    for (const read of this.importReads) {
      if (read.local !== specifier.local || read.imported !== specifier.imported) continue;
      const identity = spanIdentity(read.span);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const call = this.calls.get(identity);
      if (!call) return null;
      if (this.rewriteErasesComment(call.span)) return null;
      if (this.callText(call, retired, (expression) => this.written(expression.span)) === null) return null;
      sites.push(call);
    }
    return sites;
  }

  /** The planned calls no other planned call encloses — one edit each. */
  private outermost(planned: PlannedRetiredCalls): readonly PlannedRetiredCall[] {
    const entries = [...planned.values()];
    return entries.filter((entry) => !entries.some((other) => encloses(other.call.span, entry.call.span)));
  }

  /**
   * One planned call as its member call, with every planned call inside it
   * already rewritten. `callSites` proved the shape, so the fallback to the
   * original text is unreachable; it is written rather than asserted because a
   * migration may never emit text it did not build.
   */
  private composedCallText(entry: PlannedRetiredCall, planned: PlannedRetiredCalls): string {
    return this.callText(entry.call, entry.retired, (expression) => this.rewrittenSpan(expression.span, planned))
      ?? this.written(entry.call.span);
  }

  /**
   * The source of `span` with every outermost planned call inside it replaced
   * by what it becomes. Applied from the right so the offsets of the edits
   * still to come stay the ones the source has.
   */
  private rewrittenSpan(span: Span, planned: PlannedRetiredCalls): string {
    const inside = [...planned.values()].filter((entry) =>
      entry.call.span.start >= span.start && entry.call.span.end <= span.end);
    const outermost = inside.filter((entry) => !inside.some((other) => encloses(other.call.span, entry.call.span)));
    let text = this.written(span);
    for (const entry of [...outermost].sort((left, right) => right.call.span.start - left.call.span.start)) {
      text = `${text.slice(0, entry.call.span.start - span.start)}${this.composedCallText(entry, planned)}${text.slice(entry.call.span.end - span.start)}`;
    }
    return text;
  }

  /**
   * The member call one retired function call becomes, or null when it is not
   * that shape. `written` renders one sub-expression: the source as it stands
   * while the shape is being decided, and the composed text once it is.
   */
  private callText(
    call: RetiredCall,
    retired: RetiredCollectionExport,
    written: (expression: Expression) => string,
  ): string | null {
    const rewrite = retired.rewrite;
    if (!rewrite || call.optional) return null;
    const ordered: (Expression | null)[] = retired.parameters.map(() => null);
    for (const [index, argument] of call.arguments.entries()) {
      if (argument.kind === "SpreadExpression") return null;
      const name = call.argumentNames?.[index] ?? null;
      const position = name === null ? index : retired.parameters.indexOf(name);
      if (position < 0 || position >= ordered.length || ordered[position] !== null) return null;
      ordered[position] = argument;
    }
    const receiver = ordered[0];
    if (!receiver) return null;
    const supplied = ordered.slice(1);
    while (supplied.length > 0 && supplied.at(-1) === null) supplied.pop();
    if (supplied.some((argument) => argument === null)) return null;
    const receiverText = rewrite.receiverIsListOfArgument
      ? `[${written(receiver)}]`
      : this.postfixReceiverText(receiver, written(receiver));
    const rendered = [...rewrite.fixedArguments];
    for (const [index, argument] of supplied.entries()) {
      const name = rewrite.argumentNames[index] ?? null;
      rendered.push(name === null ? written(argument!) : `${name}=${written(argument!)}`);
    }
    return `${receiverText}.${rewrite.member}(${rendered.join(", ")})`;
  }

  /**
   * A receiver keeps its parentheses when a `.member` suffix would otherwise
   * bind tighter than the expression it is attached to — a ternary, an
   * operator chain, an arrow, an `await`. The decision is the receiver's
   * *shape*, so it is the same whether the text is the original or a rewrite
   * composed inside it: a call stays a call.
   */
  private postfixReceiverText(receiver: Expression, text: string): string {
    const postfixSafe = ["IdentifierExpression", "MemberExpression", "IndexExpression", "CallExpression", "ListExpression", "ObjectExpression", "RequiredExpression", "SuperExpression"];
    return postfixSafe.includes(receiver.kind) ? text : `(${text})`;
  }

  private written(span: Span): string {
    return this.host.sourceText.slice(span.start, span.end);
  }

  /** Both line and block comments withhold a rewrite rather than erasing prose. */
  private rewriteErasesComment(span: Span): boolean {
    const written = this.written(span);
    return written.includes("//") || written.includes("/*");
  }
}
