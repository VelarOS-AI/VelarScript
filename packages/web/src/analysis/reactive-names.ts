/**
 * The reactive names of one module: which names read reactively without being a
 * `state` themselves, which names *are* `state`, and what each `computed` is
 * computed from.
 *
 * D115 §三: three questions about one module's declarations, asked by the Look
 * freezing check and by the watch-ring refusals. They are one reading of the
 * program body, so they are one module rather than three walks in the middle of
 * the Web analyzer.
 */
import { type Expression, type Program, type Statement } from "@velarscript/compiler/extension";
import { isWebStatement } from "../ast.ts";

/** The function spelling of a derived value; `computed` the declaration is what it becomes. */
export function isRetiredAccessorName(name: string): boolean {
  return name === "computed";
}

/**
 * Every name in a module or component body whose read is reactive but whose
 * binding is not itself a state/prop reference: a computed accessor, a resource
 * handle, an action handle. A Look literal that reads one of these freezes it
 * exactly as it freezes a state read (LOK-D1).
 *
 * The retired `computed(...)` accessor stays in the callee test even though it
 * is not a global any more (D71 replaced it with the declaration): analysis
 * after a migration diagnostic still has to stay coherent, so the name a
 * retired declaration binds is treated as derived exactly as it was before.
 */
export function collectDerivedReactiveNames(program: Program): ReadonlySet<string> {
  const names = new Set<string>();
  const record = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "VariableDeclaration" && statement.pattern.kind === "NameBindingPattern"
        && statement.initializer.kind === "CallExpression" && statement.initializer.callee.kind === "IdentifierExpression"
        && isRetiredAccessorName(statement.initializer.callee.name)) {
        names.add(statement.pattern.name);
        continue;
      }
      if (!isWebStatement(statement)) continue;
      if (statement.kind === "ExtensionStatement:web:resource" || statement.kind === "ExtensionStatement:web:action") names.add(statement.name);
      if (statement.kind === "ExtensionStatement:web:component") record(statement.body as readonly Statement[]);
    }
  };
  record(program.body);
  return names;
}

/**
 * D114 P6 item 6 (ST-U2): one same-module `computed` and the state it is
 * computed *from*, so `watch doubled:` writing `count` is refused where the
 * runtime's per-task observer budget used to stop it after 50,000 rounds.
 *
 * The hop is exactly one, and it is proved rather than guessed:
 *
 *  - **Same module.** A cross-module `computed` is a name this program cannot
 *    read the body of, so it is not in this map and nothing is reported.
 *  - **One hop.** Only the names the computed's own initializer reads are
 *    sources. A computed that reads another computed contributes that other
 *    computed's name, not the state underneath it, so a two-hop chain fails
 *    the comparison and stays with the runtime budget.
 *  - **Unconditional.** A read inside a ternary branch, on the right of `and`,
 *    `or` or `??`, or inside a function body is a read this evaluation may not
 *    make, so it is not a proved cycle. The condition of a ternary and the left
 *    operand of a short-circuit are always evaluated and are read.
 *
 * A name declared twice answers null, for `collectReactiveWriters`'s reason: a
 * refusal that has to be right every time cannot pick one of two bodies.
 */
export function collectReactiveDerivations(program: Program): ReadonlyMap<string, ReadonlySet<string> | null> {
  const derivations = new Map<string, ReadonlySet<string> | null>();
  const record = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "FunctionDeclaration") {
        record(statement.body);
        continue;
      }
      if (!isWebStatement(statement)) continue;
      if (statement.kind === "ExtensionStatement:web:computed") {
        derivations.set(statement.name, derivations.has(statement.name) ? null : unconditionalReads(statement.initializer));
        continue;
      }
      if (statement.kind === "ExtensionStatement:web:component" || statement.kind === "ExtensionStatement:web:action") {
        record(statement.body as readonly Statement[]);
      }
    }
  };
  record(program.body);
  return derivations;
}

/** Every `state name = ...` of one module: true where it is declared exactly once. */
export function collectReactiveStateNames(program: Program): ReadonlyMap<string, boolean> {
  const states = new Map<string, boolean>();
  const record = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "FunctionDeclaration") {
        record(statement.body);
        continue;
      }
      if (!isWebStatement(statement)) continue;
      if (statement.kind === "ExtensionStatement:web:state") {
        states.set(statement.name, !states.has(statement.name));
        continue;
      }
      if (statement.kind === "ExtensionStatement:web:component" || statement.kind === "ExtensionStatement:web:action") {
        record(statement.body as readonly Statement[]);
      }
    }
  };
  record(program.body);
  return states;
}

/**
 * The names an expression reads on every evaluation. A branch a value may not
 * take, and a function body this expression only *builds*, are excluded: the
 * refusal this feeds must be right every time, and "reads it sometimes" is the
 * runtime budget's case rather than a provable ring.
 *
 * The walk is written out rather than reflected over the node's own fields,
 * because "which of my children does every evaluation reach" is a question only
 * each shape can answer -- a ternary's branches and an arrow's body are fields
 * like any other, and a structural walk would read them as reads. A shape this
 * switch does not name contributes nothing, which is the safe direction: a
 * missing source is a refusal not made, and a surplus one is a refusal made
 * wrongly.
 */
function unconditionalReads(expression: Expression): ReadonlySet<string> {
  const names = new Set<string>();
  const walk = (node: Expression): void => {
    switch (node.kind) {
      case "IdentifierExpression":
        names.add(node.name);
        return;
      case "FStringExpression":
        for (const part of node.parts) if (part.kind === "expression") walk(part.value);
        return;
      case "ListExpression":
        for (const element of node.elements) walk(element);
        return;
      case "ObjectExpression":
        for (const entry of node.properties) walk(entry.value);
        return;
      case "SpreadExpression":
      case "RequiredExpression":
      case "TryExpression":
      case "IsExpression":
        walk(node.value);
        return;
      case "UnaryExpression":
        walk(node.operand);
        return;
      case "ComparisonChainExpression":
        for (const operand of node.operands) walk(operand);
        return;
      case "BinaryExpression":
        // The left operand of `and`, `or` and `??` is always evaluated; the
        // right one is exactly what those operators may skip.
        walk(node.left);
        if (node.operator !== "and" && node.operator !== "or" && node.operator !== "??") walk(node.right);
        return;
      case "ConditionalExpression":
        // The condition decides; the branches are the conditional reads the
        // ruling leaves to the runtime budget.
        walk(node.condition);
        return;
      case "CallExpression":
        // An optional call evaluates its arguments only when the callee is
        // there, so those reads are conditional like a branch's.
        walk(node.callee);
        if (!node.optional) for (const argument of node.arguments) walk(argument);
        return;
      case "MemberExpression":
        walk(node.object);
        return;
      case "IndexExpression":
        walk(node.object);
        if (!node.optional) walk(node.index);
        return;
      default:
        // A literal, an arrow function's body, an extension expression: nothing
        // this analysis can prove is read on every evaluation.
        return;
    }
  };
  walk(expression);
  return names;
}
