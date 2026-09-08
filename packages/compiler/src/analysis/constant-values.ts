/** Bounded, hook-free scalar facts for compile-time argument contracts.
 *
 * Bindings hold the value proved at declaration, not an initializer to replay
 * under a later scope. Mutable cells, object members, calls and host values
 * never fold. Targets read the same facts through Analyzer.constantValue.
 */
import type { Expression } from "../ast.ts";
import type { Binding } from "./scopes.ts";

export type ConstantValue = string | number | boolean | null;
const MAX_FOLD_NODES = 256;
const MAX_FOLD_DEPTH = 64;
const MAX_FOLD_TEXT = 65536;
const MAX_RETAINED_TEXT = 1024 * 1024;

export class ConstantValues {
  private readonly bindings = new WeakMap<Binding, ConstantValue>();
  private readonly lookup: (name: string) => Binding | null;
  private retainedText = 0;

  constructor(lookup: (name: string) => Binding | null) { this.lookup = lookup; }

  bind(binding: Binding, value: ConstantValue | undefined): void {
    if (binding.mutable || value === undefined || this.bindings.has(binding)) return;
    if (typeof value === "string") {
      if (this.retainedText + value.length > MAX_RETAINED_TEXT) return;
      this.retainedText += value.length;
    }
    this.bindings.set(binding, value);
  }

  read(expression: Expression): ConstantValue | undefined {
    let remaining = MAX_FOLD_NODES;
    const visit = (node: Expression, depth: number): ConstantValue | undefined => {
      if (--remaining < 0 || depth > MAX_FOLD_DEPTH) return undefined;
      if (node.kind === "LiteralExpression") return node.value;
      if (node.kind === "IdentifierExpression") {
        const binding = this.lookup(node.name);
        return binding ? this.bindings.get(binding.storageBinding ?? binding) : undefined;
      }
      if (node.kind === "UnaryExpression") {
        const value = visit(node.operand, depth + 1);
        if (node.operator === "not" && typeof value === "boolean") return !value;
        if (typeof value !== "number") return undefined;
        if (node.operator === "+") return value;
        if (node.operator === "-") return -value;
        return undefined;
      }
      if (node.kind === "BinaryExpression") {
        const left = visit(node.left, depth + 1);
        if (left === undefined) return undefined;
        if (node.operator === "??") return left === null ? visit(node.right, depth + 1) : left;
        if (node.operator === "and" && left === false) return false;
        if (node.operator === "or" && left === true) return true;
        return foldBinary(node.operator, left, visit(node.right, depth + 1));
      }
      if (node.kind === "ConditionalExpression") {
        const condition = visit(node.condition, depth + 1);
        if (typeof condition === "boolean") return visit(condition ? node.thenValue : node.elseValue, depth + 1);
      }
      return undefined;
    };
    return visit(expression, 0);
  }
}

function foldBinary(operator: string, left: ConstantValue, right: ConstantValue | undefined): ConstantValue | undefined {
  if (right === undefined) return undefined;
  if (operator === "+" && typeof left === "string" && typeof right === "string") {
    return left.length + right.length <= MAX_FOLD_TEXT ? left + right : undefined;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    if (operator === "and") return left && right;
    if (operator === "or") return left || right;
  }
  if (typeof left !== "number" || typeof right !== "number") return undefined;
  switch (operator) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return left / right;
    case "%": return left % right;
    case "**": return left ** right;
    default: return undefined;
  }
}
