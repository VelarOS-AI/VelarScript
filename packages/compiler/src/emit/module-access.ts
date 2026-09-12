/** Runtime Type owners and public module namespace views share one source registry. */
import type {ImportDeclaration, Program} from "../ast.ts";
import type {LoweringHints} from "../contracts.ts";

type Owner = {readonly source: string; readonly exported: string; readonly accessor?: boolean; readonly dynamic?: boolean};

interface Host {
  readonly hints: LoweringHints;
  readonly typeCheckDeclarations: string[];
  needsRuntimeTypeHelpers: boolean;
}
export const runtimeTypeGetter = (name: string): string => `__velarGetRuntimeType_${name}`;
const moduleSource = (source: string): string => source.endsWith(".vel") ? `${source.slice(0, -4)}.js` : source;

export function runtimeTypeDeclaration(name: string, value: readonly string[], prefix: string, indentation: string, lazy: boolean): readonly string[] {
  if (!lazy) return [`${indentation}${prefix}const ${name} = ${value.join("\n")};`];
  const getter = runtimeTypeGetter(name);
  return [
    `${indentation}var ${getter}_cache;`,
    `${indentation}function ${getter}() { return ${getter}_cache ??= ${value.join("\n")}; }`,
    `${indentation}${prefix}const ${name} = ${getter}();`,
  ];
}

export class ModuleAccessEmitter {
  private readonly host: Host;
  private readonly sources = new Map<string, string>();
  private readonly ownerImports = new Map<string, string>();
  private readonly ownerResolvers = new Map<string, string>();
  private readonly bindings = new Map<string, {raw: string; names: readonly string[]}>();
  constructor(host: Host) { this.host = host; }

  prepare(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" || statement.javascript) continue;
      const namespace = statement.specifiers.find((specifier) => specifier.namespace);
      const names = this.host.hints.moduleNamespaceExports?.get(statement.source);
      if (namespace && names) this.bindings.set(namespace.local, {raw: `__velarModuleNamespace${statement.span.start}`, names});
    }
  }

  namespaceImport(statement: ImportDeclaration): string | null {
    const binding = this.bindings.get(statement.specifiers[0]?.local ?? "");
    return binding ? `import * as ${binding.raw} from ${JSON.stringify(moduleSource(statement.source))};` : null;
  }

  namespaceRead(name: string): string | null {
    const binding = this.bindings.get(name);
    if (!binding) return null;
    this.host.needsRuntimeTypeHelpers = true;
    return `__velarModuleNamespace(${binding.raw}, ${JSON.stringify(binding.names)})`;
  }

  private rawNamespace(source: string): string {
    let name = this.sources.get(source);
    if (!name) {
      name = `__velarDynamicModule${this.sources.size}`;
      this.sources.set(source, name);
      this.host.typeCheckDeclarations.push(`var ${name};`);
    }
    return name;
  }

  dynamicImport(source: string): string {
    const expression = `import(${JSON.stringify(moduleSource(source))})`;
    const names = this.host.hints.moduleNamespaceExports?.get(source);
    const routed = [...this.host.hints.runtimeTypeImports?.values() ?? [], ...this.host.hints.runtimeTypeReExports ?? []].some((route) => (route.dynamic && route.source === source) || route.alternatives?.some((alternative) => alternative.dynamic && alternative.source === source));
    if (!names && !routed) return expression;
    if (!names) throw new TypeError(`Dynamic runtime Type routes require moduleNamespaceExports metadata for ${JSON.stringify(source)}`);
    this.host.needsRuntimeTypeHelpers = true;
    const raw = this.rawNamespace(source);
    return `__velarImportModule(${expression}, (__namespace) => { ${raw} = __namespace; }, ${JSON.stringify(names)})`;
  }

  private ownerRead(route: Owner): string {
    if (route.dynamic) {
      const raw = this.rawNamespace(route.source);
      return `(${raw} === undefined ? undefined : ${raw}[${JSON.stringify(route.exported)}]${route.accessor ? "()" : ""})`;
    }
    const key = JSON.stringify([route.source, route.exported]);
    let local = this.ownerImports.get(key);
    if (!local) {
      local = `__velarRuntimeTypeImport${this.ownerImports.size}`;
      this.ownerImports.set(key, local);
      this.host.typeCheckDeclarations.push(`import { ${route.exported} as ${local} } from ${JSON.stringify(moduleSource(route.source))};`);
    }
    return local + (route.accessor ? "()" : "");
  }

  owner(route: Owner & {readonly alternatives?: readonly Owner[]}): string {
    const routes = [route, ...route.alternatives ?? []];
    if (routes.length === 1) return this.ownerRead(route);
    const key = JSON.stringify(routes);
    let name = this.ownerResolvers.get(key);
    if (!name) {
      name = `__velarResolveRuntimeType${this.ownerResolvers.size}`;
      this.ownerResolvers.set(key, name);
      const reads = routes.map((candidate) => this.ownerRead(candidate));
      this.host.typeCheckDeclarations.push(`function ${name}() { let type; ${reads.map((read) => `if ((type = ${read}) !== undefined) return type;`).join(" ")} }`);
    }
    return `${name}()`;
  }

  reExport(route: NonNullable<LoweringHints["runtimeTypeReExports"]>[number]): void {
    if (!route.dynamic && route.accessor && !route.alternatives?.length) {
      this.host.typeCheckDeclarations.push(`export { ${route.imported} as ${route.exported} } from ${JSON.stringify(moduleSource(route.source))};`);
      return;
    }
    const owner = this.owner({...route, exported: route.imported});
    this.host.typeCheckDeclarations.push(`export function ${route.exported}() { return ${owner}; }`);
  }
}
