/**
 * D114 0.29.0 LC-D1: `publicConfig(Type)` proved against the manifest that
 * feeds it.
 *
 * A `velar/config` value is a *build input* — the same run reads `velar.json`
 * and compiles the module, and web-api says the value is "baked into the
 * content-hashed application entry at build time" — so a manifest that does not
 * satisfy the declared type is provable before anything runs. It used to be
 * provable nowhere: `check` and `build` were both silent, and the failure then
 * arrived during module evaluation, ahead of `velar/app`'s error chain, so not
 * even the compiler-owned fatal state could render. What the author got was a
 * blank page and one uncaught host error.
 *
 * Runtime validation stays: a manifest a build baked in can be hand-edited
 * afterwards. This only moves the answer to where the mistake is.
 *
 * D115 §三: its own module under `web/analysis/`, because the walk is a
 * question about a JSON value and a type and needs nothing else from the
 * analyzer than those two.
 */
import { type Diagnostic } from "@velarscript/compiler";
import { isInvalidType, type Expression, type Program, type ValueType } from "@velarscript/compiler/extension";

/** What the walk asks of the analyzer that hosts it, and nothing more. */
export interface PublicConfigTypeHost {
  expandAliases(type: ValueType): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  describeType(type: ValueType): string;
}

/** Local names bound to `publicConfig` from `velar/config`, including aliased imports. */
export function collectPublicConfigNames(program: Program): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of program.body) {
    if (statement.kind !== "ImportDeclaration" || statement.source !== "velar/config" || statement.javascript) continue;
    for (const specifier of statement.specifiers) {
      if (!specifier.namespace && specifier.imported === "publicConfig") names.add(specifier.local);
    }
  }
  return names;
}

/**
 * The manifest's `web.publicConfig`, or null when this compile read no project
 * manifest. Null is not "empty": an empty section is a claim the compile may
 * check, and no manifest is no claim at all.
 */
export function declaredPublicConfig(webProject: unknown): Readonly<Record<string, unknown>> | null {
  if (webProject === undefined || webProject === null || typeof webProject !== "object") return null;
  const declared = (webProject as { readonly publicConfig?: unknown }).publicConfig;
  return declared && typeof declared === "object" && !Array.isArray(declared)
    ? declared as Readonly<Record<string, unknown>>
    : {};
}

/**
 * The name a `publicConfig(Type)` argument writes, or null when the argument is
 * not a written type name. A computed or qualified runtime type carries no
 * spelling for the diagnostic to quote and no claim the compile can hold to, so
 * the build-time proof exists only where the type is written out at the call.
 */
function runtimeTypeArgumentName(argument: Expression | undefined): string | null {
  return argument?.kind === "IdentifierExpression" ? argument.name : null;
}

/**
 * The VEL5080 one `publicConfig(Type)` call earns, or null when this call makes
 * no build-time claim or the manifest satisfies the type it names.
 */
export function publicConfigDiagnostic(
  expression: Extract<Expression, { kind: "CallExpression" }>,
  declared: ValueType,
  names: ReadonlySet<string>,
  manifest: Readonly<Record<string, unknown>> | null,
  host: PublicConfigTypeHost,
): Diagnostic | null {
  if (manifest === null || expression.arguments.length !== 1) return null;
  if (expression.callee.kind !== "IdentifierExpression" || !names.has(expression.callee.name)) return null;
  const typeName = runtimeTypeArgumentName(expression.arguments[0]);
  if (typeName === null || declared.kind === "unknown" || declared.kind === "any" || isInvalidType(declared)) return null;
  const reason = publicConfigMismatch(host, declared, manifest, "");
  if (reason === null) return null;
  return {
    code: "VEL5080",
    message: `Value does not match ${typeName} — ${reason}.`
      + " 'publicConfig' reads the manifest's 'web.publicConfig', which this build bakes into the application entry,"
      + " so the value is already known here: add the field to 'web.publicConfig' in velar.json, or widen the declared type",
    span: expression.span,
  };
}

/**
 * The first reason the manifest value fails the declared type, in the sentence
 * the runtime validator uses, or null when nothing is provably wrong. Only a
 * refusal that is certainly right is reported: a type this walk cannot decide —
 * a class, a capability, a generic parameter — answers null rather than
 * guessing, and the runtime keeps that case.
 */
function publicConfigMismatch(host: PublicConfigTypeHost, type: ValueType, value: unknown, path: string): string | null {
  const expanded = host.expandAliases(type);
  if (expanded.kind === "optional") {
    return value === null || value === undefined ? null : publicConfigMismatch(host, expanded.inner, value, path);
  }
  if (value === undefined) return path === "" ? "the value is missing" : `field '${path}' is missing`;
  const fields = expanded.kind === "object"
    ? expanded.fields
    : expanded.kind === "named" ? host.fieldsOf(expanded.identity ?? expanded.name) : null;
  if (fields) return recordMismatch(host, fields, expanded, value, path);
  if (expanded.kind === "list") {
    if (!Array.isArray(value)) return typeMismatch(host, expanded, path);
    for (const [index, item] of value.entries()) {
      const reason = publicConfigMismatch(host, expanded.element, item, `${path}[${index}]`);
      if (reason !== null) return reason;
    }
    return null;
  }
  const matches = expanded.kind === "string" ? typeof value === "string"
    : expanded.kind === "number" ? typeof value === "number"
      : expanded.kind === "bool" ? typeof value === "boolean"
        : expanded.kind === "null" ? value === null
          : null;
  return matches === false ? typeMismatch(host, expanded, path) : null;
}

function recordMismatch(
  host: PublicConfigTypeHost,
  fields: ReadonlyMap<string, ValueType>,
  expanded: ValueType,
  value: unknown,
  path: string,
): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return typeMismatch(host, expanded, path);
  const record = value as Record<string, unknown>;
  for (const [field, fieldType] of fields) {
    const reason = publicConfigMismatch(
      host,
      fieldType,
      Object.hasOwn(record, field) ? record[field] : undefined,
      path ? `${path}.${field}` : field,
    );
    if (reason !== null) return reason;
  }
  return null;
}

function typeMismatch(host: PublicConfigTypeHost, type: ValueType, path: string): string {
  return path === ""
    ? `the value does not match ${host.describeType(type)}`
    : `field '${path}' does not match ${host.describeType(type)}`;
}
