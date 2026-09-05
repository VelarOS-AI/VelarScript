/**
 * What a *declaration* symbol shows in an editor, as against what a value's
 * type shows.
 *
 * D114 0.28.0 I-I2 and its F2 follow-up settle one rule for the four generic
 * declaration forms: a declaration hover shows the parameter list the author
 * wrote, bounds included — `class Stack<T: Comparable>`, `type Box<T>`,
 * `def top<T: Comparable>(...)`. A *type* display keeps erasing them, because a
 * bound is a rule about what may be substituted at a call, not part of the type
 * the value has; `describeType` is that display and is left alone.
 */
import type { TypeParameterDeclaration } from "./ast.ts";
import { describeType, type ValueType } from "./types.ts";

/**
 * The display text a generic record or class declaration publishes for itself.
 * A `def` carries its parameters into a hover through the function type it
 * describes; a class and a record have no such type — their symbols read back
 * the bare name, so `class Stack<T: Comparable>` hovered as `class Stack: Stack`
 * and `type Box<T>` as `type Box: Box`, and the reader was never told the
 * declaration takes a parameter at all, let alone what it must satisfy. A
 * declaration with no parameters answers `undefined` and keeps the type its
 * binding already describes.
 */
export function declaredTypeParameters(
  name: string,
  parameters: readonly TypeParameterDeclaration[] | undefined,
): string | undefined {
  if (!parameters?.length) return undefined;
  const rendered = parameters.map((parameter) => parameter.bound ? `${parameter.name}: ${parameter.bound}` : parameter.name);
  return `${name}<${rendered.join(", ")}>`;
}

/**
 * How a symbol's own type is written. Ordinary symbols use `describeType`,
 * which erases type-parameter bounds: `def top<T: Comparable>` hovered as
 * `<T>(…)` while the class beside it showed `Stack<T: Comparable>` — one
 * declaration, two answers about the same list. A *declaration* asks for the
 * bounded form, and gets it by naming each parameter the way the declaration
 * spells it and letting `describeType` render the rest, so the two displays
 * cannot drift apart.
 */
export function declarationTypeDisplay(type: ValueType, bounded: boolean): string {
  if (!bounded || (type.kind !== "function" && type.kind !== "action" && type.kind !== "intrinsic")) return describeType(type);
  const names = type.typeParameterNames;
  const bounds = type.typeParameterBounds;
  if (!names?.length || !bounds?.some((bound) => bound !== null)) return describeType(type);
  return describeType({ ...type, typeParameterNames: names.map((name, index) => bounds[index] ? `${name}: ${bounds[index]}` : name) });
}
