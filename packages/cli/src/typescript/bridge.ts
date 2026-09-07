/**
 * What a TypeScript declaration bridge is: the shape `loadTypeScriptDeclarations`
 * answers with, the direction a type crosses the JavaScript boundary in, and the
 * VelarScript primitives every reader in `typescript/` maps a declaration onto.
 */
import {
  VELAR_BYTES_TYPE_IDENTITY,
  VELAR_FLOAT32_BUFFER_TYPE_IDENTITY,
  VELAR_UINT8_BUFFER_TYPE_IDENTITY,
  VELAR_UINT16_BUFFER_TYPE_IDENTITY,
  VELAR_UINT32_BUFFER_TYPE_IDENTITY,
  type ClassInfo,
  type ValueType,
} from "@velarscript/compiler";

export interface TypeScriptDeclarationBridge {
  readonly path: string;
  readonly dependencies: readonly string[];
  readonly exports: ReadonlyMap<string, ValueType>;
  readonly typeExports: ReadonlyMap<string, ValueType>;
  readonly classes: ReadonlyMap<string, ClassInfo>;
  readonly classRegistry: ReadonlyMap<string, ClassInfo>;
  readonly warnings: readonly string[];
  /**
   * BRG-U3: the package declares a `types` entry that cannot be read. The
   * import degrades to unknown, but with a notice — a broken declared path
   * is a package defect worth reporting, unlike a package that never
   * declared types at all.
   */
  readonly unreadableDeclaredTypes?: true;
}

export type DeclarationDirection = "to-js" | "from-js" | "invariant";

export function oppositeDirection(direction: DeclarationDirection): DeclarationDirection {
  return direction === "to-js" ? "from-js" : direction === "from-js" ? "to-js" : "invariant";
}

export const unknownType: ValueType = { kind: "unknown" };
export const unsupportedType: ValueType = { kind: "unknown", restricted: true };
export const nullType: ValueType = { kind: "null" };
export const stringType: ValueType = { kind: "string" };
export const numberType: ValueType = { kind: "number" };
export const boolType: ValueType = { kind: "bool" };
export const bytesType: ValueType = { kind: "named", name: "Bytes", identity: VELAR_BYTES_TYPE_IDENTITY };
export const uint8BufferType: ValueType = { kind: "named", name: "UInt8Buffer", identity: VELAR_UINT8_BUFFER_TYPE_IDENTITY };
export const uint16BufferType: ValueType = { kind: "named", name: "UInt16Buffer", identity: VELAR_UINT16_BUFFER_TYPE_IDENTITY };
export const uint32BufferType: ValueType = { kind: "named", name: "UInt32Buffer", identity: VELAR_UINT32_BUFFER_TYPE_IDENTITY };
export const float32BufferType: ValueType = { kind: "named", name: "Float32Buffer", identity: VELAR_FLOAT32_BUFFER_TYPE_IDENTITY };
export const MAX_TYPESCRIPT_DECLARATION_DEPTH = 16;

export function emptyDeclarationBridge(path: string, warning: string): TypeScriptDeclarationBridge {
  return { path, dependencies: [path], exports: new Map(), typeExports: new Map(), classes: new Map(), classRegistry: new Map(), warnings: [warning] };
}

/** The distinct members of `values`, in first-seen order. */
export function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
