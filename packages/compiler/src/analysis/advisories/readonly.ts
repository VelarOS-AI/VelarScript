/** Canonical readonly spelling. Each edit preserves the current layer's contract. */
import type { TypeDeclaration, TypeSyntax } from "../../ast.ts";
import type { DiagnosticEdit, DiagnosticFix } from "../../diagnostic.ts";
import type { Span } from "../../source.ts";
import { isReadonlyView, type ValueType } from "../../types.ts";

export interface ReadonlyAdvisoryHost {
  readonly sourceText: string;
  advise(code: string, message: string, span: Span, fix?: DiagnosticFix): void;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
}

function removeKeyword(source: string, start: number): DiagnosticEdit | null {
  const keyword = /^readonly\b[ \t]*/u.exec(source.slice(start));
  return keyword ? { span: { start, end: start + keyword[0].length }, text: "" } : null;
}

export function adviseReadonlyDeclaration(host: ReadonlyAdvisoryHost, declaration: TypeDeclaration): void {
  const explicit = declaration.fields.filter(field => field.readonly);
  if (explicit.length === 0) return;
  // Promoting a derived declaration must not also restrict writable base slots.
  const base = declaration.base;
  const allOwn = explicit.length === declaration.fields.length;
  const promote = !declaration.readonly && allOwn && base === null;
  if (!declaration.readonly && !promote) return;
  const edits = explicit.map(field => removeKeyword(host.sourceText, field.span.start));
  if (edits.some(edit => edit === null)) return;
  const replacements = edits as DiagnosticEdit[];
  if (promote) {
    const header = /^(?:export\s+)?type\b/u.exec(host.sourceText.slice(declaration.span.start));
    if (!header) return;
    const start = declaration.span.start + header[0].lastIndexOf("type");
    replacements.push({ span: { start, end: start }, text: "readonly " });
  }
  host.advise("A20", promote
    ? `Every field of '${declaration.name}' is readonly; declare 'readonly type ${declaration.name}' once`
    : `'${declaration.name}' already declares every field readonly; remove the repeated field modifiers`,
  { start: declaration.span.start, end: declaration.fields[0]?.span.start ?? declaration.span.end },
  { title: promote ? `Use readonly type ${declaration.name}` : "Remove repeated readonly field modifiers", edits: replacements });
}

function readonlySurface(host: ReadonlyAdvisoryHost, type: ValueType): boolean {
  if (type.kind === "null") return true;
  if (type.kind === "optional") return readonlySurface(host, type.inner);
  if (type.kind === "union") return type.members.every(member => readonlySurface(host, member));
  if (isReadonlyView(type)) return true;
  const fields = type.kind === "named" ? host.fieldsOf(type.identity ?? type.name)
    : type.kind === "object" ? type.fields : null;
  const readonly = type.kind === "named" ? host.readonlyFieldsOf(type.identity ?? type.name)
    : type.kind === "object" ? type.readonlyFields : null;
  return fields !== null && fields.size > 0 && [...fields.keys()].every(name => readonly?.has(name));
}

export function adviseReadonlyView(host: ReadonlyAdvisoryHost, syntax: Extract<TypeSyntax, { kind: "ReadonlyTypeSyntax" }>, inner: ValueType): void {
  if (!readonlySurface(host, inner)) return;
  const edit = removeKeyword(host.sourceText, syntax.span.start);
  host.advise("A21", "This type already protects its own slots; remove the redundant readonly qualifier", syntax.span,
    edit ? { title: "Remove redundant readonly qualifier", edits: [edit] } : undefined);
}
