import { genericApplicationIdentity, type GenericApplication, type ModuleInterface, type ValueType } from "@velarscript/compiler";

/** Applications carry structured arguments; their length-framed identities are not path templates. */
function interfaceApplications(interface_: ModuleInterface): ReadonlyMap<string, GenericApplication> {
  const applications = new Map<string, GenericApplication>();
  const seen = new Set<object>();
  const classes = new Set<object>(interface_.classes.values());
  const remember = (identity: unknown, application: GenericApplication | undefined): void => {
    // Rebasing must not repair a previously inconsistent, untrusted contract.
    if (application && identity === genericApplicationIdentity(application.declaration, application.arguments)) {
      applications.set(identity as string, application);
    }
  };
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (record.kind === "named" || record.kind === "class" || classes.has(value)) {
      remember(record.identity, record.application as GenericApplication | undefined);
    }
    if (classes.has(value)) remember(record.base, record.baseApplication as GenericApplication | undefined);
    if (value instanceof Map) for (const [key, item] of value) { visit(key); visit(item); }
    else if (value instanceof Set || Array.isArray(value)) for (const item of value) visit(item);
    else for (const item of Object.values(value)) visit(item);
  };
  // Only ABI type-bearing tables define applications. Extension data is opaque
  // and may coincidentally use keys such as 'identity' or 'application'.
  for (const table of [interface_.exports, interface_.namedTypes, interface_.namedTypeBases,
    interface_.typeAliases, interface_.genericTypes, interface_.classes]) visit(table);
  return applications;
}

/** Rebuild each canonical application before replacing references to it, including map keys. */
export function rebaseInterfaceData(interface_: ModuleInterface, replacePath: (text: string) => string): ModuleInterface {
  const applications = interfaceApplications(interface_);
  const identities = new Map<string, string>();
  const active = new Set<string>();
  const copies = new WeakMap<object, unknown>();
  const text = (value: string): string => {
    const cached = identities.get(value);
    if (cached !== undefined) return cached;
    const application = applications.get(value);
    if (!application) return replacePath(value);
    if (active.has(value)) throw new Error("A generic application cannot recursively contain its own identity");
    active.add(value);
    try {
      const arguments_ = application.arguments.map(argument => visit(argument) as ValueType);
      const identity = genericApplicationIdentity(replacePath(application.declaration), arguments_);
      identities.set(value, identity);
      return identity;
    } finally { active.delete(value); }
  };
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") return text(value);
    if (value === null || typeof value !== "object") return value;
    if (copies.has(value)) return copies.get(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      copies.set(value, result);
      for (const item of value) result.push(visit(item));
      return result;
    }
    if (value instanceof Map) {
      const result = new Map<unknown, unknown>();
      copies.set(value, result);
      for (const [key, item] of value) result.set(visit(key), visit(item));
      return result;
    }
    if (value instanceof Set) {
      const result = new Set<unknown>();
      copies.set(value, result);
      for (const item of value) result.add(visit(item));
      return result;
    }
    const result: Record<string, unknown> = {};
    copies.set(value, result);
    for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, {
      value: visit(item), writable: true, enumerable: true, configurable: true,
    });
    return result;
  };
  return visit(interface_) as ModuleInterface;
}
