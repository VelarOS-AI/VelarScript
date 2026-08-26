import {analysisTypeIdentity} from "@velarscript/compiler";
import type {CompilerInterfaceContext, Expression, Program, Span, TypeReference, ValueType} from "@velarscript/compiler/extension";

/**
 * `p"..."` 在编译期得到的稳定结构。运行时只接收这个结构，不再重新解释
 * 路由字符串；分析器、代码生成器、路由器和 OpenAPI 因而共享同一份事实。
 */
export interface CompiledRoutePattern {
  readonly kind: "node-route-pattern";
  readonly definition: string;
  readonly pathname: string;
  readonly path: readonly RoutePatternCapture[];
  readonly query: readonly RoutePatternCapture[];
}

export interface RoutePatternCapture {
  /** 处理函数中 `path.params/query` 使用的字段名。 */
  readonly name: string;
  /** URL 中实际出现的名字；查询参数允许它与字段名不同。 */
  readonly wireName: string;
  /** 是否显式写了 `wireName={field:type}`，同名时也必须保留原始写法。 */
  readonly explicitWireName: boolean;
  readonly typeName: string;
  readonly optional: boolean;
  /** 声明模块解析后的类型事实；只写入跨模块接口，不进入生成的 JavaScript。 */
  readonly resolvedType?: ValueType;
  readonly span: Span;
  readonly typeSpan: Span;
}

export interface RoutePatternIssue {
  readonly message: string;
  readonly span: Span;
}

export type RoutePatternStaticValue =
  | CompiledRoutePattern
  | { readonly kind: "node-route-pattern-object"; readonly properties: Readonly<Record<string, RoutePatternStaticValue>> };

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const queryName = /^[A-Za-z_][A-Za-z0-9_.~-]*$/u;

/**
 * 把一个路由字面量编译成路径与查询两组捕获。这里刻意只实现路由协议，
 * 不引入通用表达式 DSL：一个 `{name:type?}` 就是一项明确输入契约。
 */
export function compileRoutePattern(definition: string, contentStart = 0): {
  readonly pattern: CompiledRoutePattern;
  readonly issues: readonly RoutePatternIssue[];
} {
  const issues: RoutePatternIssue[] = [];
  const point = (start: number, end = start + 1): Span => ({start: contentStart + start, end: contentStart + Math.max(start + 1, end)});
  const separators = queryBoundaries(definition);
  const separator = separators[0] ?? -1;
  const pathname = separator < 0 ? definition : definition.slice(0, separator);
  const querySource = separator < 0 ? "" : definition.slice(separator + 1);

  if (definition.length === 0 || definition.length > 4096) {
    issues.push({message: "A route pattern must contain 1 through 4096 code units", span: point(0, Math.max(1, definition.length))});
  }
  if (!pathname.startsWith("/")) issues.push({message: "A route path must start with '/'", span: point(0)});
  if (pathname.length > 1 && pathname.endsWith("/")) issues.push({message: "A route path must not end with '/'", span: point(pathname.length - 1)});
  if (pathname.includes("//")) issues.push({message: "A route path must not contain an empty segment ('//')", span: point(pathname.indexOf("//"), pathname.indexOf("//") + 2)});
  for (const forbidden of ["#", "\\"] as const) {
    const at = definition.indexOf(forbidden);
    if (at >= 0) issues.push({message: `A route pattern must not contain '${forbidden}'`, span: point(at)});
  }
  if (separators.length > 1) {
    const at = separators[1]!;
    issues.push({message: "A route pattern contains only one query boundary '?'", span: point(at)});
  }

  const path: RoutePatternCapture[] = [];
  const query: RoutePatternCapture[] = [];
  const localNames = new Set<string>();
  const wireNames = new Set<string>();
  let offset = 0;
  for (const segment of pathname.split("/")) {
    const start = offset;
    offset += segment.length + 1;
    if (segment === "*") {
      issues.push({message: "Source route patterns cannot use a wildcard; use staticFiles for a bounded static subtree", span: point(start, start + 1)});
      continue;
    }
    if (!segment.includes("{") && !segment.includes("}")) continue;
    const capture = parseCapture(segment, start, contentStart, false, issues);
    if (!capture) continue;
    if (localNames.has(capture.name)) issues.push({message: `Route input '${capture.name}' is declared more than once`, span: capture.span});
    else localNames.add(capture.name);
    path.push(capture);
  }

  if (separator >= 0 && querySource === "") {
    issues.push({message: "A route query boundary must be followed by at least one '{name:type}' field", span: point(separator)});
  }
  let queryOffset = separator + 1;
  for (const clause of querySource === "" ? [] : querySource.split("&")) {
    const start = queryOffset;
    queryOffset += clause.length + 1;
    if (clause === "") {
      issues.push({message: "A route query must not contain an empty '&' field", span: point(start)});
      continue;
    }
    const equals = clause.indexOf("=");
    const captureText = equals < 0 ? clause : clause.slice(equals + 1);
    const captureStart = start + (equals < 0 ? 0 : equals + 1);
    const capture = parseCapture(captureText, captureStart, contentStart, true, issues);
    if (!capture) continue;
    let wireName = capture.name;
    if (equals >= 0) {
      wireName = clause.slice(0, equals);
      if (!queryName.test(wireName)) issues.push({message: `Query wire name '${wireName}' is invalid`, span: point(start, start + Math.max(1, equals))});
      if (wireName.length > 256) issues.push({message: "A query wire name cannot exceed 256 code units", span: point(start, start + equals)});
    }
    const resolved = {...capture, wireName, explicitWireName: equals >= 0};
    if (localNames.has(resolved.name)) issues.push({message: `Route input '${resolved.name}' is declared more than once`, span: resolved.span});
    else localNames.add(resolved.name);
    if (wireNames.has(wireName)) issues.push({message: `Query wire name '${wireName}' is declared more than once`, span: point(start, start + Math.max(1, equals < 0 ? clause.length : equals))});
    else wireNames.add(wireName);
    query.push(resolved);
  }
  if (path.length > 64) issues.push({message: "A route pattern cannot declare more than 64 path captures", span: point(0, Math.max(1, pathname.length))});
  if (query.length > 64) issues.push({message: "A route pattern cannot declare more than 64 query fields", span: point(Math.max(0, separator), Math.max(1, definition.length))});

  return {
    pattern: {kind: "node-route-pattern", definition, pathname, path, query},
    issues,
  };
}

/** `?` 既是查询边界，也可出现在 `{name:type?}` 内；只统计花括号外的边界。 */
function queryBoundaries(source: string): readonly number[] {
  const output: number[] = [];
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth = Math.max(0, depth - 1);
    else if (source[index] === "?" && depth === 0) output.push(index);
  }
  return output;
}

function parseCapture(
  source: string,
  relativeStart: number,
  contentStart: number,
  allowOptional: boolean,
  issues: RoutePatternIssue[],
): RoutePatternCapture | null {
  const whole: Span = {start: contentStart + relativeStart, end: contentStart + relativeStart + Math.max(1, source.length)};
  if (!source.startsWith("{") || !source.endsWith("}") || source.slice(1, -1).includes("{") || source.slice(1, -1).includes("}")) {
    issues.push({message: `A ${allowOptional ? "query" : "path"} capture must be written as '{name:type${allowOptional ? "?" : ""}'}`, span: whole});
    return null;
  }
  const inner = source.slice(1, -1);
  const colon = inner.indexOf(":");
  if (colon <= 0 || colon !== inner.lastIndexOf(":")) {
    issues.push({message: "A route capture declares its field and type as '{name:type}'", span: whole});
    return null;
  }
  const name = inner.slice(0, colon);
  let typeName = inner.slice(colon + 1);
  const optional = typeName.endsWith("?");
  if (optional) typeName = typeName.slice(0, -1);
  if (!identifier.test(name)) issues.push({message: `Route field name '${name}' must be an identifier`, span: whole});
  if (!identifier.test(typeName)) issues.push({message: `Route field '${name}' must use a named scalar type`, span: whole});
  if (optional && !allowOptional) issues.push({message: `Path field '${name}' is always required and cannot use '?'`, span: whole});
  const typeStart = contentStart + relativeStart + 1 + colon + 1;
  return {
    name,
    wireName: name,
    explicitWireName: false,
    typeName,
    optional: allowOptional && optional,
    span: whole,
    typeSpan: {start: typeStart, end: typeStart + Math.max(1, typeName.length)},
  };
}

export function isCompiledRoutePattern(value: unknown): value is CompiledRoutePattern {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CompiledRoutePattern>;
  return item.kind === "node-route-pattern" && typeof item.definition === "string" && typeof item.pathname === "string"
    && Array.isArray(item.path) && Array.isArray(item.query);
}

export function isRoutePatternStaticValue(value: unknown): value is RoutePatternStaticValue {
  if (isCompiledRoutePattern(value)) return true;
  if (!value || typeof value !== "object") return false;
  const item = value as {kind?: unknown; properties?: unknown};
  return item.kind === "node-route-pattern-object" && !!item.properties && typeof item.properties === "object" && !Array.isArray(item.properties)
    && Object.values(item.properties as Record<string, unknown>).every(isRoutePatternStaticValue);
}

/**
 * 跨模块缓存身份只取协议内容，不取源码 Span。对象键按码点排序，因此同一目录
 * 不会因为对象构造顺序或文件位置变化而产生虚假的接口漂移。
 */
export function routePatternStaticIdentity(value: unknown): string {
  if (!isRoutePatternStaticValue(value)) return "route-pattern:invalid";
  if (isCompiledRoutePattern(value)) {
    const captures = value.path.concat(value.query).map((capture) => {
      const type = capture.resolvedType ? analysisTypeIdentity(capture.resolvedType) : capture.typeName;
      return `${capture.name.length}:${capture.name}${type.length}:${type}`;
    }).join("");
    return `route-pattern:${value.definition.length}:${value.definition}${captures}`;
  }
  const entries = Object.entries(value.properties).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `route-pattern-object:${entries.map(([name, item]) => `${name.length}:${name}${routePatternStaticIdentity(item)}`).join("")}`;
}

/** 计算 `const` 路由目录；成员读取与对象展开都在编译期完成。 */
export function evaluateRoutePatternExpression(
  expression: Expression,
  values: ReadonlyMap<string, RoutePatternStaticValue>,
): RoutePatternStaticValue | null {
  if (expression.kind === "ExtensionExpression:node:path-pattern") {
    return (expression as NodePathPatternLike).pattern;
  }
  if (expression.kind === "IdentifierExpression") return values.get(expression.name) ?? null;
  if (expression.kind === "MemberExpression" && !expression.optional) {
    const owner = evaluateRoutePatternExpression(expression.object, values);
    return owner?.kind === "node-route-pattern-object" ? owner.properties[expression.property] ?? null : null;
  }
  if (expression.kind !== "ObjectExpression") return null;
  const properties: Record<string, RoutePatternStaticValue> = Object.create(null) as Record<string, RoutePatternStaticValue>;
  for (const entry of expression.properties) {
    const value = evaluateRoutePatternExpression(entry.value, values);
    if (!value) return null;
    if (entry.kind === "ObjectSpread") {
      if (value.kind !== "node-route-pattern-object") return null;
      Object.assign(properties, value.properties);
    } else properties[entry.name] = value;
  }
  return {kind: "node-route-pattern-object", properties};
}

export function collectRoutePatternValues(
  program: Program,
  imported: ReadonlyMap<string, RoutePatternStaticValue> = new Map(),
): ReadonlyMap<string, RoutePatternStaticValue> {
  const values = new Map(imported);
  for (const statement of program.body) {
    if (statement.kind !== "VariableDeclaration" || statement.binding !== "const" || statement.pattern.kind !== "NameBindingPattern") continue;
    const value = evaluateRoutePatternExpression(statement.initializer, values);
    if (value) values.set(statement.pattern.name, value);
  }
  return values;
}

export function exportedRoutePatternValues(
  program: Program,
  context?: CompilerInterfaceContext,
): ReadonlyMap<string, RoutePatternStaticValue> {
  const values = collectRoutePatternValues(program);
  const output = new Map<string, RoutePatternStaticValue>();
  for (const statement of program.body) {
    if (statement.kind !== "VariableDeclaration" || statement.binding !== "const" || !statement.exported || statement.pattern.kind !== "NameBindingPattern") continue;
    const value = values.get(statement.pattern.name);
    if (value) output.set(statement.pattern.name, context ? resolveStaticValue(value, context) : value);
  }
  return output;
}

/**
 * 接口注解保留 RoutePattern 的数据形状，同时把每个捕获解析成声明模块拥有的
 * ValueType。消费模块即使没有单独导入枚举或别名，也能得到同一身份和标量种类。
 */
function resolveStaticValue(value: RoutePatternStaticValue, context: CompilerInterfaceContext): RoutePatternStaticValue {
  if (isCompiledRoutePattern(value)) {
    const resolve = (capture: RoutePatternCapture): RoutePatternCapture => {
      const reference: TypeReference = {
        syntax: {kind: "NamedTypeSyntax", name: capture.typeName, span: capture.typeSpan},
        span: capture.typeSpan,
      };
      return {...capture, resolvedType: context.resolve(reference)};
    };
    return {...value, path: value.path.map(resolve), query: value.query.map(resolve)};
  }
  return {
    kind: "node-route-pattern-object",
    properties: Object.fromEntries(Object.entries(value.properties).map(([name, item]) => [name, resolveStaticValue(item, context)])),
  };
}

type NodePathPatternLike = Expression & {readonly kind: "ExtensionExpression:node:path-pattern"; readonly pattern: CompiledRoutePattern};
