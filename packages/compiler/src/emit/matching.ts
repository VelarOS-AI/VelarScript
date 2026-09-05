/**
 * `match` pattern emission: the lines that attempt one `case` pattern against a
 * value and the bindings it produces when it matches.
 */
import type { Expression, MatchPattern } from "../ast.ts";
import { resolveTypeReference, type ValueType } from "../types.ts";
import { type LoweringHints } from "../contracts.ts";
import { spanIdentity } from "../source.ts";

export interface MatchEmitterHost {
  emitMappedExpression(expression: Expression, normalizeNull?: boolean): string;
  emitTypeCheck(type: ValueType, value: string, state?: string): string;
  readonly hints: LoweringHints;
  needsCollectionHelpers: boolean;
  needsDirectCollectionInfrastructure: boolean;
}

/** What one `case` pattern's emission needs from the attempt it belongs to. */
interface MatchPatternContext {
  readonly lines: string[];
  readonly bind: (name: string, value: string) => void;
  readonly rejectUnless: (condition: string) => void;
  readonly temporary: (label: string) => string;
  readonly indentation: string;
  readonly emit: (current: MatchPattern, value: string) => void;
}

export class MatchEmitter {
  private readonly host: MatchEmitterHost;

  constructor(host: MatchEmitterHost) {
    this.host = host;
  }

  emitMatchPatternAttempt(
    pattern: MatchPattern,
    valueName: string,
    indentation: string,
  ): {
    readonly lines: readonly string[];
    readonly bindings: readonly { readonly name: string; readonly value: string }[];
  } {
    const lines: string[] = [];
    const bindings = new Map<string, string>();
    let nextTemporary = 0;
    const temporary = (label: string): string => `__velarPattern${pattern.span.start}${label}${nextTemporary++}`;
    const bind = (name: string, value: string): void => {
      if (name !== "_" && !bindings.has(name)) bindings.set(name, value);
    };
    const rejectUnless = (condition: string): void => {
      lines.push(`${indentation}if (!(${condition})) return null;`);
    };

    const context: MatchPatternContext = {
      lines, bind, rejectUnless, temporary, indentation,
      emit: (current, nested) => this.emitPatternMatch(current, nested, context),
    };
    const emit = context.emit;

    emit(pattern, valueName);
    return { lines, bindings: [...bindings].map(([name, value]) => ({ name, value })) };
  }

  /**
   * One pattern against one value. `context` carries the four things every
   * branch needs — the lines emitted so far, the two ways a branch can end
   * (bind a name, reject the attempt), a fresh temporary name, and the
   * recursion — so a nested pattern is emitted by the same rules as a top one.
   */
  private emitPatternMatch(current: MatchPattern, value: string, context: MatchPatternContext): void {
    const { lines, bind, rejectUnless, temporary, indentation, emit } = context;
    switch (current.kind) {
      case "MatchWildcardPattern":
        break;
      case "MatchCapturePattern":
        bind(current.binding.name, value);
        break;
      case "MatchAsPattern":
        emit(current.pattern, value);
        bind(current.binding.name, value);
        break;
      case "MatchValuePattern":
        // ENM-D2: a candidate whose value can be NaN compares by
        // SameValueZero so `case box.nan:` agrees with `==` (charter
        // section 8); every other candidate keeps plain `===`.
        rejectUnless(current.values.map((candidate) => {
          if (this.host.hints.sameValueZeroMatchValues.has(spanIdentity(candidate.span))) {
            this.host.needsCollectionHelpers = true;
            return `__velarSameValueZero(${value}, ${this.host.emitMappedExpression(candidate)})`;
          }
          return `${value} === ${this.host.emitMappedExpression(candidate)}`;
        }).join(" || ") || "false");
        break;
      case "MatchTypePattern":
        rejectUnless(this.host.emitTypeCheck(resolveTypeReference(current.type), value));
        break;
      case "MatchListPattern": {
        this.host.needsCollectionHelpers = true;
        this.host.needsDirectCollectionInfrastructure = true;
        const items = temporary("List");
        const length = current.elements.length;
        lines.push(`${indentation}__velarReactiveCollectionTrack(${value});`);
        rejectUnless(`__velarCollectionListIsArray(${value})`);
        const lengthDescriptor = temporary("Length");
        const listLength = temporary("Size");
        lines.push(`${indentation}const ${lengthDescriptor} = __velarCollectionListGetOwnPropertyDescriptor(${value}, "length");`);
        rejectUnless(`${lengthDescriptor} && ${lengthDescriptor}.writable && !${lengthDescriptor}.enumerable && !${lengthDescriptor}.configurable && "value" in ${lengthDescriptor}`);
        lines.push(`${indentation}const ${listLength} = ${lengthDescriptor}.value;`);
        rejectUnless(`${listLength} <= __velarMaxCollectionItems && ${listLength} ${current.rest ? ">=" : "==="} ${length} && __velarCollectionListOwnSymbols(${value}).length === 0 && __velarCollectionListOwnNames(${value}).length === ${listLength} + 1`);
        lines.push(`${indentation}const ${items} = new __velarCollectionNativeArray(${listLength});`);
        const cursor = temporary("Index");
        const descriptor = temporary("Item");
        lines.push(`${indentation}for (let ${cursor} = 0; ${cursor} < ${listLength}; ${cursor} += 1) {`);
        lines.push(`${indentation}  const ${descriptor} = __velarCollectionListGetOwnPropertyDescriptor(${value}, ${cursor});`);
        lines.push(`${indentation}  if (!${descriptor}?.enumerable || !${descriptor}.configurable || !${descriptor}.writable || !("value" in ${descriptor})) return null;`);
        lines.push(`${indentation}  __velarCollectionListDefineProperty(${items}, ${cursor}, { value: __velarReactiveCollectionRead(${value}, ${cursor}, ${descriptor}.value), writable: true, enumerable: true, configurable: true });`);
        lines.push(`${indentation}}`);
        current.elements.forEach((child, index) => emit(child, `${items}[${index}]`));
        if (current.rest) {
          const rest = temporary("Rest");
          const restCursor = temporary("RestIndex");
          lines.push(`${indentation}const ${rest} = new __velarCollectionNativeArray(${listLength} - ${length});`);
          lines.push(`${indentation}for (let ${restCursor} = ${length}; ${restCursor} < ${listLength}; ${restCursor} += 1) {`);
          lines.push(`${indentation}  __velarCollectionListDefineProperty(${rest}, ${restCursor} - ${length}, { value: ${items}[${restCursor}], writable: true, enumerable: true, configurable: true });`);
          lines.push(`${indentation}}`);
          bind(current.rest.name, rest);
        }
        break;
      }
      case "MatchObjectPattern": {
        this.host.needsCollectionHelpers = true;
        this.host.needsDirectCollectionInfrastructure = true;
        rejectUnless(`${value} !== null && typeof ${value} === "object" && !__velarCollectionListIsArray(${value})`);
        for (const entry of current.entries) {
          const descriptor = temporary("Field");
          const fieldValue = temporary("Value");
          lines.push(`${indentation}__velarReactiveCollectionTrack(${value}, ${JSON.stringify(entry.property)});`);
          lines.push(`${indentation}const ${descriptor} = __velarCollectionRecordGetOwnPropertyDescriptor(${value}, ${JSON.stringify(entry.property)});`);
          rejectUnless(`${descriptor}?.enumerable && "value" in ${descriptor}`);
          lines.push(`${indentation}const ${fieldValue} = __velarReactiveCollectionRead(${value}, ${JSON.stringify(entry.property)}, ${descriptor}.value);`);
          emit(entry.pattern, fieldValue);
        }
        if (current.rest) {
          const rest = temporary("Rest");
          const key = temporary("Key");
          const descriptor = temporary("RestField");
          const selected = current.entries.map((entry) => `${key} === ${JSON.stringify(entry.property)}`).join(" || ") || "false";
          rejectUnless(`__velarCollectionRecordOwnSymbols(${value}).length === 0`);
          lines.push(`${indentation}__velarReactiveCollectionTrack(${value});`);
          lines.push(`${indentation}const ${rest} = {};`);
          const fields = temporary("Fields");
          const fieldIndex = temporary("FieldIndex");
          lines.push(`${indentation}const ${fields} = __velarCollectionRecordOwnNames(${value});`);
          rejectUnless(`${fields}.length <= __velarMaxCollectionItems`);
          lines.push(`${indentation}for (let ${fieldIndex} = 0; ${fieldIndex} < ${fields}.length; ${fieldIndex} += 1) {`);
          lines.push(`${indentation}  const ${key} = ${fields}[${fieldIndex}];`);
          lines.push(`${indentation}  if (${selected}) continue;`);
          lines.push(`${indentation}  const ${descriptor} = __velarCollectionRecordGetOwnPropertyDescriptor(${value}, ${key});`);
          lines.push(`${indentation}  if (!${descriptor}?.enumerable) continue;`);
          lines.push(`${indentation}  if (!("value" in ${descriptor})) return null;`);
          lines.push(`${indentation}  __velarCollectionRecordDefineProperty(${rest}, ${key}, { value: __velarReactiveCollectionRead(${value}, ${key}, ${descriptor}.value), writable: true, enumerable: true, configurable: true });`);
          lines.push(`${indentation}}`);
          bind(current.rest.name, rest);
        }
        break;
      }
    }
  }
}
