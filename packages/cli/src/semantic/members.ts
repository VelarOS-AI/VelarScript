import type { ProjectResult } from "../project.ts";
import { locationOf, referencesFor, uniqueLocations, uniqueTextEdits } from "./locations.ts";
import { memberTargetForReference, ownerTarget } from "./targets.ts";
import type { MemberTarget, ProjectLocation, ProjectTextEdit } from "./types.ts";

export function memberOwnerKind(target: MemberTarget): "class" | "data" {
  if (!target.symbol.container) return "data";
  const owner = target.module.result.semanticIndex.symbols.find((symbol) => symbol.name === target.symbol.container
    && (symbol.kind === "class" || symbol.kind === "type" || symbol.kind.startsWith("extension:class:") || symbol.kind.startsWith("extension:type:")));
  return owner?.kind === "class" || owner?.kind.startsWith("extension:class:") ? "class" : "data";
}

export function memberLocations(project: ProjectResult, target: MemberTarget, includeDeclaration: boolean): readonly ProjectLocation[] {
  const targets = memberContractTargets(project, target);
  const targetIds = new Set(targets.map((item) => item.symbol.id));
  const locations: ProjectLocation[] = includeDeclaration ? targets.map((item) => locationOf(item.symbol)) : [];
  for (const item of targets) locations.push(...referencesFor(item.module, item.symbol));
  for (const module of project.modules) {
    for (const reference of module.result.semanticIndex.memberReferences) {
      if (reference.name !== target.symbol.name) continue;
      const resolved = memberTargetForReference(project, module, reference);
      if (resolved && targetIds.has(resolved.symbol.id)) {
        locations.push({ path: module.inputPath, span: reference.span });
      }
    }
  }
  return uniqueLocations(locations);
}

export function renameableMember(target: MemberTarget): boolean {
  if (!target.symbol.container) return false;
  if (target.symbol.kind === "method") return true;
  if (target.symbol.kind === "parameter") {
    return target.module.result.semanticIndex.symbols.some((symbol) =>
      (symbol.kind.startsWith("extension:function:") || symbol.kind.startsWith("extension:class:"))
      && symbol.name === target.symbol.container);
  }
  if (target.symbol.kind !== "field") return false;
  return target.module.result.semanticIndex.symbols.some((symbol) => (symbol.kind === "type" || symbol.kind === "class")
    && symbol.name === target.symbol.container);
}

export function extensionRenameProtection(project: ProjectResult, target: MemberTarget): string | null {
  const containerKind = target.symbol.container
    ? target.module.result.semanticIndex.symbols.find((symbol) => symbol.name === target.symbol.container)?.kind ?? null
    : null;
  for (const extension of project.compilerExtensions) {
    const message = extension.editor?.project?.protectRename?.({
      name: target.symbol.name,
      kind: target.symbol.kind,
      container: target.symbol.container ?? null,
      containerKind,
    });
    if (message) return message;
  }
  return null;
}

export function memberRenameCollides(project: ProjectResult, target: MemberTarget, newName: string): boolean {
  const targets = memberContractTargets(project, target);
  const targetIds = new Set(targets.map((item) => item.symbol.id));
  const contractRoot = (target.symbol.kind === "method" || target.symbol.kind === "field") && !target.symbol.static && !target.symbol.private
    ? memberContractRootOwner(project, target) : null;
  const owners = contractRoot ? classHierarchyOwners(project, contractRoot)
    : targets.flatMap((item) => classOwnerForMember(item) ? [classOwnerForMember(item)!] : []);
  if (owners.length === 0) {
    return target.module.result.semanticIndex.symbols.some((symbol) => !targetIds.has(symbol.id)
      && symbol.container === target.symbol.container
      && (symbol.kind === "field" || symbol.kind === "method" || symbol.kind === "parameter")
      && symbol.name === newName);
  }
  const hierarchyCollision = owners.some((owner) => owner.module.result.semanticIndex.symbols.some((symbol) => !targetIds.has(symbol.id)
    && symbol.container === owner.symbol.name
    && (symbol.kind === "parameter" || ((symbol.kind === "field" || symbol.kind === "method")
      && Boolean(symbol.static) === Boolean(target.symbol.static)))
    && symbol.name === newName));
  if (hierarchyCollision || !contractRoot) return hierarchyCollision;
  for (let ancestor = baseClassOwner(project, contractRoot); ancestor; ancestor = baseClassOwner(project, ancestor)) {
    if (directClassMember(ancestor, newName, false)) return true;
  }
  return false;
}

export function memberRenameEdits(project: ProjectResult, target: MemberTarget, newName: string): readonly ProjectTextEdit[] {
  const targets = memberContractTargets(project, target);
  const targetIds = new Set(targets.map((item) => item.symbol.id));
  const edits: ProjectTextEdit[] = targets.map((item) => ({ ...locationOf(item.symbol), replacement: newName }));
  for (const item of targets) {
    edits.push(...referencesFor(item.module, item.symbol).map((location) => ({ ...location, replacement: newName })));
  }
  for (const module of project.modules) {
    for (const reference of module.result.semanticIndex.memberReferences) {
      if (reference.name !== target.symbol.name) continue;
      const resolved = memberTargetForReference(project, module, reference);
      if (!resolved || !targetIds.has(resolved.symbol.id)) continue;
      edits.push({
        path: module.inputPath,
        span: reference.span,
        replacement: reference.shorthand ? `${newName}: ${reference.name}` : newName,
      });
    }
  }
  return uniqueTextEdits(edits);
}

function memberContractTargets(project: ProjectResult, target: MemberTarget): readonly MemberTarget[] {
  if ((target.symbol.kind !== "method" && target.symbol.kind !== "field") || target.symbol.static || target.symbol.private) return [target];
  const rootOwner = memberContractRootOwner(project, target);
  if (!rootOwner) return [target];
  const targets: MemberTarget[] = [];
  for (const candidate of classHierarchyOwners(project, rootOwner)) {
    const declared = directClassMember(candidate, target.symbol.name, false, target.symbol.kind);
    if (declared?.symbol.kind === target.symbol.kind) targets.push(declared);
  }
  return targets.length > 0 ? targets : [target];
}

function memberContractRootOwner(project: ProjectResult, target: MemberTarget): MemberTarget | null {
  if (target.symbol.kind !== "field" && target.symbol.kind !== "method") return null;
  const memberKind = target.symbol.kind;
  const owner = classOwnerForMember(target);
  if (!owner) return null;
  let rootOwner = owner;
  for (let current = baseClassOwner(project, owner); current; current = baseClassOwner(project, current)) {
    const declared = directClassMember(current, target.symbol.name, false, memberKind);
    if (declared?.symbol.kind === memberKind) rootOwner = current;
  }
  return rootOwner;
}

function classHierarchyOwners(project: ProjectResult, rootOwner: MemberTarget): readonly MemberTarget[] {
  const owners: MemberTarget[] = [];
  for (const module of project.modules) {
    for (const symbol of module.result.semanticIndex.symbols) {
      if (symbol.kind !== "class") continue;
      const candidate = { module, symbol } satisfies MemberTarget;
      if (classDescendsFrom(project, candidate, rootOwner)) owners.push(candidate);
    }
  }
  return owners;
}

function classOwnerForMember(target: MemberTarget): MemberTarget | null {
  if (!target.symbol.container) return null;
  const owner = target.module.result.semanticIndex.symbols.find((symbol) => symbol.kind === "class" && symbol.name === target.symbol.container);
  return owner ? { module: target.module, symbol: owner } : null;
}

function baseClassOwner(project: ProjectResult, owner: MemberTarget): MemberTarget | null {
  const base = owner.module.result.moduleInterface.classes.get(owner.symbol.name)?.base;
  return base ? ownerTarget(project, owner.module, base, "class") : null;
}

function directClassMember(
  owner: MemberTarget,
  name: string,
  staticMember: boolean,
  expectedKind?: "field" | "method",
): MemberTarget | null {
  const symbol = owner.module.result.semanticIndex.symbols.find((item) => item.container === owner.symbol.name
    && item.name === name
    && (!expectedKind || item.kind === expectedKind)
    && (item.kind === "field" || item.kind === "method")
    && Boolean(item.static) === staticMember);
  return symbol ? { module: owner.module, symbol } : null;
}

function classDescendsFrom(project: ProjectResult, candidate: MemberTarget, expected: MemberTarget): boolean {
  const visited = new Set<string>();
  for (let current: MemberTarget | null = candidate; current; current = baseClassOwner(project, current)) {
    if (current.symbol.id === expected.symbol.id) return true;
    if (visited.has(current.symbol.id)) return false;
    visited.add(current.symbol.id);
  }
  return false;
}
