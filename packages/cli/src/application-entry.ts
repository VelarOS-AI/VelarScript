import type { ProjectModule, ProjectResult } from "./project.ts";

export interface CheckedApplicationEntry {
  readonly entry: ProjectModule;
}

/**
 * 所有应用型扩展共用的入口契约。
 *
 * Web、Desktop、Node 和 Server 的宿主虽然不同，但宿主做的事情都只是执行
 * `velar.json` 选中的入口模块。启动界面、监听端口或等待服务退出等应用动作，
 * 必须由入口自己的 `@main` 明确拥有，不能再由某个扩展悄悄寻找导出函数。
 */
export function applicationEntry(project: ProjectResult): CheckedApplicationEntry {
  const entry = project.modules.find((module) => module.inputPath === project.entryPath);
  if (entry?.result.hasMain) return { entry };
  throw new Error(`${project.entryPath}: Application entry must declare '@main' and perform startup inside that region`);
}

/** The whole rewritten entry, and the snapshot it was computed from. */
export interface ApplicationEntryMigration {
  /** The rule this rewrite answers, printed where a compiler fix prints its diagnostic code. */
  readonly code: string;
  readonly path: string;
  /** The text the rewrite was computed against; the writer refuses if the file no longer holds it. */
  readonly expected: string;
  readonly text: string;
  /** Where the rewrite starts, for reporting a location. */
  readonly offset: number;
  readonly title: string;
}

/**
 * The one shape of the missing-`@main` refusal that migrates mechanically.
 *
 * The contract above moved every application's startup into an explicit entry
 * region, and the tree it refuses is the tree the previous generation asked for:
 * an entry whose startup is a bare top-level call. Wrapping that call is a
 * rewrite the author would have made letter for letter, so `velar fix` makes it
 * — but only where "letter for letter" is provable rather than plausible:
 *
 *  - **Exactly one** top-level statement is startup code. Two of them are an
 *    ordering the author owns: which runs first is visible in the source today,
 *    and a fixer that merged them into one region would be asserting that the
 *    order it chose is the order that was meant.
 *  - It is the module's **final** top-level statement. `@main` must end the
 *    module, so a startup call with a declaration after it cannot be wrapped
 *    where it stands, and moving it past a declaration that may itself run —
 *    a `const` with an initializer is one — changes what happens before what.
 *  - It occupies **one line** and **heads no block of its own**. The inline
 *    `@main: <statement>` body has the statement semantics of an indented one,
 *    so a single line is carried across verbatim; re-indenting a multi-line
 *    statement into a block is a second rewrite, and this fixer performs no
 *    rewrite it cannot show is the same text. The inline body also accepts one
 *    *non-block* statement, so a one-line `if cond: startup()` would be wrapped
 *    into source that no longer parses — the rewrite has to leave a tree the
 *    compiler still accepts, not merely a tree that answers this rule.
 *
 * Everything else is handed back as the diagnostic it was. `velar fix` is safe
 * to run unattended because it never guesses, and startup order is exactly the
 * kind of thing a guess destroys silently.
 */
export function applicationEntryMigration(project: ProjectResult): ApplicationEntryMigration | null {
  const entry = project.modules.find((module) => module.inputPath === project.entryPath);
  if (!entry || entry.result.hasMain) return null;
  const startup = entry.result.moduleStartup;
  if (startup.statements.length !== 1 || !startup.trailing) return null;
  const { span, opensBlock } = startup.statements[0]!;
  if (opensBlock) return null;
  const source = entry.result.source;
  const statement = source.text.slice(span.start, span.end);
  if (statement.length === 0 || statement.includes("\n")) return null;
  // A top-level statement in an indentation-scoped language starts in column 1,
  // and the region marker has to start where the statement did. Reading the
  // location rather than assuming it keeps a statement that somehow began
  // indented out of the fixable class instead of producing a region the parser
  // would then refuse.
  if (source.location(span.start).column !== 1) return null;
  return {
    code: "application-entry",
    path: entry.inputPath,
    expected: source.text,
    text: `${source.text.slice(0, span.start)}@main: ${statement}${source.text.slice(span.end)}`,
    offset: span.start,
    title: "Move the entry's startup statement into its '@main' region",
  };
}
