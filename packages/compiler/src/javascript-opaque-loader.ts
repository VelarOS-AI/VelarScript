import type { AnyNode, Program } from "acorn";

import type { JavaScriptOpaqueModuleLoad } from "./javascript-module.ts";
import {
  hasLoaderOrigin,
  inspectJavaScriptLoaderStructure,
  loaderOrigin,
  nodeName,
  resolveJavaScriptBinding,
  type JavaScriptAliasEscape,
  type JavaScriptBinding,
  type JavaScriptLoaderOrigins,
  type JavaScriptOpaqueLoaderBindings,
  type JavaScriptScope,
  type JavaScriptVariableAlias,
} from "./javascript-loader-scope.ts";

export interface JavaScriptOpaqueLoaderInspection {
  readonly opaqueLoads: readonly JavaScriptOpaqueModuleLoad[];
  readonly syntaxNodes: number;
}

export function inspectJavaScriptOpaqueModuleLoads(
  program: Program,
  maximumSyntaxNodes: number,
): JavaScriptOpaqueLoaderInspection {
  const structure = inspectJavaScriptLoaderStructure(program, maximumSyntaxNodes);
  const aliasEscapeLoads = propagateJavaScriptLoaderAliases(
    structure.aliases,
    structure.aliasEscapes,
    structure.bindings,
    structure.syntaxNodes,
  );
  const opaqueLoads = structure.calls
    .map((call) => opaqueModuleLoad(call, structure.bindings))
    .filter((load): load is JavaScriptOpaqueModuleLoad => load !== null);
  opaqueLoads.push(...aliasEscapeLoads);
  opaqueLoads.sort((left, right) => left.start - right.start || left.end - right.end);
  return { opaqueLoads, syntaxNodes: structure.syntaxNodes };
}

function opaqueModuleLoad(
  node: AnyNode,
  bindings: JavaScriptOpaqueLoaderBindings,
): JavaScriptOpaqueModuleLoad | null {
  if (node.type !== "CallExpression" && node.type !== "NewExpression") return null;
  const call = node as AnyNode & {
    readonly arguments?: readonly AnyNode[];
    readonly callee?: AnyNode;
    readonly optional?: boolean;
  };
  if (call.callee === undefined) return null;
  const loader = calledOpaqueLoader(call.callee, bindings);
  if (loader === null) return null;
  return opaqueLoad(
    loader.kind,
    loader.kind === "commonjs-require" || loader.kind === "get-builtin-module"
      ? provableCallTarget(call.arguments)
      : null,
    loader.bundlerVisible && node.type === "CallExpression" && call.optional !== true,
    loader.node,
  );
}

function calledOpaqueLoader(
  node: AnyNode,
  bindings: JavaScriptOpaqueLoaderBindings,
): { readonly kind: JavaScriptOpaqueModuleLoad["kind"]; readonly bundlerVisible: boolean; readonly node: AnyNode } | null {
  if (node.type === "SequenceExpression") {
    const expressions = (node as AnyNode & { readonly expressions?: readonly AnyNode[] }).expressions ?? [];
    const last = expressions.at(-1);
    const loader = last === undefined ? null : calledOpaqueLoader(last, bindings);
    return loader === null ? null : { ...loader, bundlerVisible: false };
  }
  if (node.type === "ChainExpression") {
    const expression = (node as AnyNode & { readonly expression?: AnyNode }).expression;
    const loader = expression === undefined ? null : calledOpaqueLoader(expression, bindings);
    return loader === null ? null : { ...loader, bundlerVisible: false };
  }
  const origins = expressionLoaderOrigins(node, bindings);
  const kind = hasLoaderOrigin(origins, "create-require")
    ? "create-require"
    : hasLoaderOrigin(origins, "get-builtin-module")
      ? "get-builtin-module"
      : hasLoaderOrigin(origins, "commonjs-require")
        ? "commonjs-require"
        : null;
  if (kind === null) return null;
  const scope = bindings.scopeByNode.get(node);
  const unshadowedPlainRequire = node.type === "Identifier"
    && nodeName(node) === "require"
    && scope !== undefined
    && resolveJavaScriptBinding(scope, "require") === null;
  return { kind, bundlerVisible: unshadowedPlainRequire, node };
}

function expressionLoaderOrigins(node: AnyNode, bindings: JavaScriptOpaqueLoaderBindings): JavaScriptLoaderOrigins {
  const cached = bindings.originsByNode.get(node);
  if (cached !== undefined) return cached;
  const origins = uncachedExpressionLoaderOrigins(node, bindings);
  bindings.originsByNode.set(node, origins);
  return origins;
}

function uncachedExpressionLoaderOrigins(node: AnyNode, bindings: JavaScriptOpaqueLoaderBindings): JavaScriptLoaderOrigins {
  if (node.type === "Identifier") return identifierLoaderOrigins(node, bindings);
  if (node.type === "MemberExpression") {
    const member = node as AnyNode & { readonly object?: AnyNode; readonly property?: AnyNode; readonly computed?: boolean };
    if (member.object === undefined) return 0;
    return memberLoaderOrigins(expressionLoaderOrigins(member.object, bindings), staticMemberName(member));
  }
  if (node.type === "SequenceExpression") {
    const expressions = (node as AnyNode & { readonly expressions?: readonly AnyNode[] }).expressions ?? [];
    const last = expressions.at(-1);
    return last === undefined ? 0 : expressionLoaderOrigins(last, bindings);
  }
  if (node.type === "ChainExpression") {
    const expression = (node as AnyNode & { readonly expression?: AnyNode }).expression;
    return expression === undefined ? 0 : expressionLoaderOrigins(expression, bindings);
  }
  if (node.type === "CallExpression") {
    const call = node as AnyNode & { readonly arguments?: readonly AnyNode[]; readonly callee?: AnyNode };
    return call.callee === undefined
      ? 0
      : loaderCallResultOrigins(
        expressionLoaderOrigins(call.callee, bindings),
        provableCallTarget(call.arguments),
        call.callee,
      );
  }
  if (node.type === "AwaitExpression") {
    const argument = (node as AnyNode & { readonly argument?: AnyNode }).argument;
    return argument === undefined ? 0 : expressionLoaderOrigins(argument, bindings);
  }
  if (node.type === "ImportExpression") {
    const source = (node as AnyNode & { readonly source?: AnyNode }).source;
    const target = source === undefined ? null : provableString(source);
    return target === "module" || target === "node:module" ? loaderOrigin("node-module-namespace") : 0;
  }
  if (node.type === "ConditionalExpression" || node.type === "LogicalExpression") {
    return branchingExpressionLoaderOrigins(node, bindings);
  }
  if (node.type === "AssignmentExpression") {
    const assignment = node as AnyNode & { readonly operator?: string; readonly right?: AnyNode };
    return assignment.operator === "=" && assignment.right !== undefined
      ? expressionLoaderOrigins(assignment.right, bindings)
      : 0;
  }
  return 0;
}

function identifierLoaderOrigins(node: AnyNode, bindings: JavaScriptOpaqueLoaderBindings): JavaScriptLoaderOrigins {
  const name = nodeName(node);
  if (name === null) return 0;
  const scope = bindings.scopeByNode.get(node);
  const binding = scope === undefined ? null : resolveJavaScriptBinding(scope, name);
  if (binding) return binding.origins;
  if (name === "globalThis" || name === "global") return loaderOrigin("global-object");
  if (name === "process") return loaderOrigin("node-process");
  if (name === "module") return loaderOrigin("commonjs-module");
  if (name === "require") return loaderOrigin("commonjs-require");
  return 0;
}

function branchingExpressionLoaderOrigins(
  node: AnyNode,
  bindings: JavaScriptOpaqueLoaderBindings,
): JavaScriptLoaderOrigins {
  const pending = [node];
  let origins = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    const branches = expressionBranchNodes(current);
    if (branches === null) origins |= expressionLoaderOrigins(current, bindings);
    else for (const branch of branches) if (branch !== undefined) pending.push(branch);
  }
  return origins;
}

interface JavaScriptOriginProjectionBranch {
  readonly source: JavaScriptBinding | null;
  readonly project: (source: JavaScriptLoaderOrigins) => JavaScriptLoaderOrigins;
}

interface JavaScriptOriginProjection {
  readonly branches: readonly JavaScriptOriginProjectionBranch[];
}

interface JavaScriptAliasRule extends JavaScriptOriginProjectionBranch {
  readonly target: JavaScriptBinding;
}

interface JavaScriptAliasRuleBudget {
  readonly maximum: number;
  remaining: number;
}

function propagateJavaScriptLoaderAliases(
  aliases: readonly JavaScriptVariableAlias[],
  aliasEscapes: readonly JavaScriptAliasEscape[],
  bindings: JavaScriptOpaqueLoaderBindings,
  maximumAliasRules: number,
): JavaScriptOpaqueModuleLoad[] {
  const dependents = new Map<JavaScriptBinding, JavaScriptAliasRule[]>();
  const staticRules: JavaScriptAliasRule[] = [];
  const budget: JavaScriptAliasRuleBudget = { maximum: maximumAliasRules, remaining: maximumAliasRules };
  for (const alias of aliases) {
    collectPatternAliasRules(
      alias.pattern,
      loaderOriginProjection(alias.initializer, bindings),
      bindings.scopeByNode,
      dependents,
      staticRules,
      budget,
    );
  }
  propagateAliasRules(dependents, staticRules);
  return aliasEscapes
    .map((escape) => opaqueAliasEscape(escape, bindings))
    .filter((load): load is JavaScriptOpaqueModuleLoad => load !== null);
}

function propagateAliasRules(
  dependents: ReadonlyMap<JavaScriptBinding, readonly JavaScriptAliasRule[]>,
  staticRules: readonly JavaScriptAliasRule[],
): void {
  const queued = new Set<JavaScriptBinding>();
  const pending: JavaScriptBinding[] = [];
  const enqueue = (binding: JavaScriptBinding): void => {
    if (queued.has(binding)) return;
    queued.add(binding);
    pending.push(binding);
  };
  const promote = (rule: JavaScriptAliasRule, source: JavaScriptLoaderOrigins): void => {
    const origins = rule.project(source);
    const added = origins & ~rule.target.origins;
    if (added === 0) return;
    rule.target.origins |= origins;
    enqueue(rule.target);
  };
  for (const rule of staticRules) promote(rule, 0);
  for (const source of dependents.keys()) if (source.origins !== 0) enqueue(source);
  for (let index = 0; index < pending.length; index += 1) {
    const source = pending[index]!;
    for (const rule of dependents.get(source) ?? []) promote(rule, source.origins);
  }
}

function opaqueAliasEscape(
  escape: JavaScriptAliasEscape,
  bindings: JavaScriptOpaqueLoaderBindings,
): JavaScriptOpaqueModuleLoad | null {
  const origins = expressionLoaderOrigins(escape.initializer, bindings);
  if (hasLoaderOrigin(origins, "get-builtin-module")) {
    return opaqueLoad("get-builtin-module", null, false, escape.target);
  }
  if (hasLoaderOrigin(origins, "node-module-namespace") || hasLoaderOrigin(origins, "create-require")) {
    return opaqueLoad("create-require", null, false, escape.target);
  }
  if (hasLoaderOrigin(origins, "commonjs-module") || hasLoaderOrigin(origins, "commonjs-require")) {
    return opaqueLoad("commonjs-require", null, false, escape.target);
  }
  return null;
}

function loaderOriginProjection(
  node: AnyNode,
  bindings: JavaScriptOpaqueLoaderBindings,
): JavaScriptOriginProjection {
  if (node.type === "Identifier") {
    const name = nodeName(node);
    const scope = bindings.scopeByNode.get(node);
    const binding = name === null || scope === undefined ? null : resolveJavaScriptBinding(scope, name);
    if (binding) return { branches: [{ source: binding, project: (origins) => origins }] };
    return staticOriginProjection(globalIdentifierOrigins(name));
  }
  if (node.type === "MemberExpression") {
    const member = node as AnyNode & { readonly object?: AnyNode; readonly property?: AnyNode; readonly computed?: boolean };
    if (member.object === undefined) return staticOriginProjection(0);
    return mapOriginProjection(
      loaderOriginProjection(member.object, bindings),
      (origins) => memberLoaderOrigins(origins, staticMemberName(member)),
    );
  }
  if (node.type === "SequenceExpression") {
    const expressions = (node as AnyNode & { readonly expressions?: readonly AnyNode[] }).expressions ?? [];
    const last = expressions.at(-1);
    return last === undefined ? staticOriginProjection(0) : loaderOriginProjection(last, bindings);
  }
  if (node.type === "ChainExpression" || node.type === "AwaitExpression") {
    const expression = node.type === "ChainExpression"
      ? (node as AnyNode & { readonly expression?: AnyNode }).expression
      : (node as AnyNode & { readonly argument?: AnyNode }).argument;
    return expression === undefined ? staticOriginProjection(0) : loaderOriginProjection(expression, bindings);
  }
  if (node.type === "CallExpression") {
    const call = node as AnyNode & { readonly arguments?: readonly AnyNode[]; readonly callee?: AnyNode };
    if (call.callee === undefined) return staticOriginProjection(0);
    const target = provableCallTarget(call.arguments);
    return mapOriginProjection(
      loaderOriginProjection(call.callee, bindings),
      (origins) => loaderCallResultOrigins(origins, target, call.callee!),
    );
  }
  if (node.type === "ImportExpression") {
    const source = (node as AnyNode & { readonly source?: AnyNode }).source;
    const target = source === undefined ? null : provableString(source);
    return staticOriginProjection(
      target === "module" || target === "node:module" ? loaderOrigin("node-module-namespace") : 0,
    );
  }
  if (node.type === "ConditionalExpression" || node.type === "LogicalExpression") {
    return branchingOriginProjection(node, bindings);
  }
  if (node.type === "AssignmentExpression") {
    const assignment = node as AnyNode & { readonly operator?: string; readonly right?: AnyNode };
    return assignment.operator === "=" && assignment.right !== undefined
      ? loaderOriginProjection(assignment.right, bindings)
      : staticOriginProjection(0);
  }
  return staticOriginProjection(0);
}

function globalIdentifierOrigins(name: string | null): JavaScriptLoaderOrigins {
  if (name === "globalThis" || name === "global") return loaderOrigin("global-object");
  if (name === "process") return loaderOrigin("node-process");
  if (name === "module") return loaderOrigin("commonjs-module");
  if (name === "require") return loaderOrigin("commonjs-require");
  return 0;
}

function branchingOriginProjection(
  node: AnyNode,
  bindings: JavaScriptOpaqueLoaderBindings,
): JavaScriptOriginProjection {
  const pending = [node];
  const projections: JavaScriptOriginProjection[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const branches = expressionBranchNodes(current);
    if (branches === null) projections.push(loaderOriginProjection(current, bindings));
    else for (const branch of branches) if (branch !== undefined) pending.push(branch);
  }
  return combineOriginProjections(projections);
}

function expressionBranchNodes(node: AnyNode): readonly (AnyNode | undefined)[] | null {
  if (node.type === "ConditionalExpression") {
    return [
      (node as AnyNode & { readonly consequent?: AnyNode }).consequent,
      (node as AnyNode & { readonly alternate?: AnyNode }).alternate,
    ];
  }
  if (node.type === "LogicalExpression") {
    return [
      (node as AnyNode & { readonly left?: AnyNode }).left,
      (node as AnyNode & { readonly right?: AnyNode }).right,
    ];
  }
  return null;
}

function loaderCallResultOrigins(
  callee: JavaScriptLoaderOrigins,
  target: string | null,
  calleeNode: AnyNode,
): JavaScriptLoaderOrigins {
  let result = 0;
  if (hasLoaderOrigin(callee, "create-require")) result |= loaderOrigin("commonjs-require");
  if (hasLoaderOrigin(callee, "get-builtin-module")) {
    if (target === "module" || target === "node:module") result |= loaderOrigin("node-module-namespace");
    if (target === "process" || target === "node:process") result |= loaderOrigin("node-process");
  }
  if (hasLoaderOrigin(callee, "commonjs-require")
    && !isLoaderUtilityMember(calleeNode)
    && (target === "module" || target === "node:module")) result |= loaderOrigin("node-module-namespace");
  return result;
}

function isLoaderUtilityMember(node: AnyNode): boolean {
  if (node.type === "ChainExpression") {
    const expression = (node as AnyNode & { readonly expression?: AnyNode }).expression;
    return expression !== undefined && isLoaderUtilityMember(expression);
  }
  if (node.type !== "MemberExpression") return false;
  const property = staticMemberName(node as AnyNode & { readonly property?: AnyNode; readonly computed?: boolean });
  return property === "resolve" || property === "call" || property === "apply" || property === "bind";
}

function staticOriginProjection(origins: JavaScriptLoaderOrigins): JavaScriptOriginProjection {
  return origins === 0 ? { branches: [] } : { branches: [{ source: null, project: () => origins }] };
}

function mapOriginProjection(
  projection: JavaScriptOriginProjection,
  transform: (origin: JavaScriptLoaderOrigins) => JavaScriptLoaderOrigins,
): JavaScriptOriginProjection {
  return {
    branches: projection.branches.map((branch) => ({
      source: branch.source,
      project: (origins) => transform(branch.project(origins)),
    })),
  };
}

function combineOriginProjections(projections: readonly JavaScriptOriginProjection[]): JavaScriptOriginProjection {
  return { branches: projections.flatMap((projection) => projection.branches) };
}

function collectPatternAliasRules(
  pattern: AnyNode,
  projection: JavaScriptOriginProjection,
  scopeByNode: WeakMap<object, JavaScriptScope>,
  dependents: Map<JavaScriptBinding, JavaScriptAliasRule[]>,
  staticRules: JavaScriptAliasRule[],
  budget: JavaScriptAliasRuleBudget,
): void {
  if (pattern.type === "Identifier") {
    const name = nodeName(pattern);
    const scope = scopeByNode.get(pattern);
    const binding = name === null || scope === undefined ? null : resolveJavaScriptBinding(scope, name);
    if (binding === null) return;
    for (const branch of projection.branches) {
      consumeAliasRuleBudget(budget);
      const rule = { ...branch, target: binding };
      if (branch.source === null) staticRules.push(rule);
      else {
        const rules = dependents.get(branch.source) ?? [];
        rules.push(rule);
        dependents.set(branch.source, rules);
      }
    }
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    const left = (pattern as AnyNode & { readonly left?: AnyNode }).left;
    if (left) collectPatternAliasRules(left, projection, scopeByNode, dependents, staticRules, budget);
    return;
  }
  if (pattern.type === "RestElement") {
    const argument = (pattern as AnyNode & { readonly argument?: AnyNode }).argument;
    if (argument) collectPatternAliasRules(argument, projection, scopeByNode, dependents, staticRules, budget);
    return;
  }
  if (pattern.type !== "ObjectPattern") return;
  for (const property of (pattern as AnyNode & { readonly properties?: readonly AnyNode[] }).properties ?? []) {
    if (property.type === "RestElement") {
      collectPatternAliasRules(property, projection, scopeByNode, dependents, staticRules, budget);
      continue;
    }
    if (property.type !== "Property") continue;
    const entry = property as AnyNode & { readonly key?: AnyNode; readonly value?: AnyNode; readonly computed?: boolean };
    if (entry.value === undefined) continue;
    collectPatternAliasRules(
      entry.value,
      mapOriginProjection(projection, (origins) => memberLoaderOrigins(origins, staticPatternPropertyName(entry))),
      scopeByNode,
      dependents,
      staticRules,
      budget,
    );
  }
}

function consumeAliasRuleBudget(budget: JavaScriptAliasRuleBudget): void {
  if (budget.remaining < 1) {
    throw new RangeError(`JavaScript module loader alias graph exceeds ${budget.maximum} edges`);
  }
  budget.remaining -= 1;
}

function memberLoaderOrigins(owner: JavaScriptLoaderOrigins, property: string | null): JavaScriptLoaderOrigins {
  let result = 0;
  if (property === null) return unknownMemberLoaderOrigins(owner);
  if (hasLoaderOrigin(owner, "global-object") && property === "require") result |= loaderOrigin("commonjs-require");
  if (hasLoaderOrigin(owner, "global-object") && property === "process") result |= loaderOrigin("node-process");
  if (hasLoaderOrigin(owner, "global-object") && property === "module") result |= loaderOrigin("commonjs-module");
  if (hasLoaderOrigin(owner, "node-process") && property === "getBuiltinModule") {
    result |= loaderOrigin("get-builtin-module");
  }
  if (hasLoaderOrigin(owner, "commonjs-module") && property === "require") result |= loaderOrigin("commonjs-require");
  if (hasLoaderOrigin(owner, "node-module-namespace") && property === "createRequire") {
    result |= loaderOrigin("create-require");
  }
  if (property === "call" || property === "apply" || property === "bind" || property === "resolve") {
    if (hasLoaderOrigin(owner, "commonjs-require")) result |= loaderOrigin("commonjs-require");
    if (hasLoaderOrigin(owner, "create-require")) result |= loaderOrigin("create-require");
    if (hasLoaderOrigin(owner, "get-builtin-module")) result |= loaderOrigin("get-builtin-module");
  }
  return result;
}

function unknownMemberLoaderOrigins(owner: JavaScriptLoaderOrigins): JavaScriptLoaderOrigins {
  let result = 0;
  // An unknown computed member can select any loader-bearing property on a
  // known carrier. Preserve the carrier so a later computed hop stays tainted.
  if (hasLoaderOrigin(owner, "global-object")) {
    result |= loaderOrigin("global-object") | loaderOrigin("node-process")
      | loaderOrigin("commonjs-module") | loaderOrigin("commonjs-require");
  }
  if (hasLoaderOrigin(owner, "node-process")) {
    result |= loaderOrigin("node-process") | loaderOrigin("get-builtin-module");
  }
  if (hasLoaderOrigin(owner, "commonjs-module")) {
    result |= loaderOrigin("commonjs-module") | loaderOrigin("commonjs-require");
  }
  if (hasLoaderOrigin(owner, "node-module-namespace")) {
    result |= loaderOrigin("node-module-namespace") | loaderOrigin("create-require");
  }
  if (hasLoaderOrigin(owner, "commonjs-require")) result |= loaderOrigin("commonjs-require");
  if (hasLoaderOrigin(owner, "create-require")) result |= loaderOrigin("create-require");
  if (hasLoaderOrigin(owner, "get-builtin-module")) result |= loaderOrigin("get-builtin-module");
  return result;
}

function staticPatternPropertyName(property: { readonly key?: AnyNode; readonly computed?: boolean }): string | null {
  const key = property.key;
  if (key === undefined) return null;
  if (!property.computed && key.type === "Identifier") return nodeName(key);
  if (key.type === "Literal") {
    const value = (key as AnyNode & { readonly value?: unknown }).value;
    return typeof value === "string" ? value : null;
  }
  return null;
}

function provableCallTarget(arguments_: readonly AnyNode[] | undefined): string | null {
  const first = arguments_?.[0];
  return first === undefined || first.type === "SpreadElement" ? null : provableString(first);
}

function staticMemberName(member: {
  readonly computed?: boolean;
  readonly property?: AnyNode;
}): string | null {
  const property = member.property;
  if (!property) return null;
  if (!member.computed && property.type === "Identifier") return nodeName(property);
  return member.computed ? provableString(property) : null;
}

function provableString(source: AnyNode): string | null {
  if (source.type === "Literal") {
    const value = (source as AnyNode & { readonly value?: unknown }).value;
    return typeof value === "string" ? value : null;
  }
  if (source.type !== "TemplateLiteral") return null;
  const template = source as AnyNode & {
    readonly expressions?: readonly unknown[];
    readonly quasis?: readonly { readonly value?: { readonly cooked?: unknown } }[];
  };
  if (template.expressions?.length !== 0 || template.quasis?.length !== 1) return null;
  const cooked = template.quasis[0]?.value?.cooked;
  return typeof cooked === "string" ? cooked : null;
}

function opaqueLoad(
  kind: JavaScriptOpaqueModuleLoad["kind"],
  target: string | null,
  bundlerVisible: boolean,
  node: Pick<AnyNode, "start" | "end">,
): JavaScriptOpaqueModuleLoad {
  return { kind, target, bundlerVisible, start: node.start, end: node.end };
}
