/**
 * Which file a package's `exports` map names for a subpath's types, and the
 * conditional / wildcard / array spellings that map may use to name it.
 */

export function exportedTypes(value: unknown, subpath: string): string | null {
  const selected = selectPackageExport(value, subpath);
  return selected ? findTypesTarget(selected.value, selected.wildcard) : null;
}

function selectPackageExport(value: unknown, subpath: string): { readonly value: unknown; readonly wildcard: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return subpath === "." ? { value, wildcard: null } : null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.some(([key]) => key.startsWith("."))) return subpath === "." ? { value, wildcard: null } : null;
  const exact = entries.find(([key]) => key === subpath);
  if (exact) return { value: exact[1], wildcard: null };
  const patterns = entries.flatMap(([key, target]) => {
    const star = key.indexOf("*");
    if (star < 0 || star !== key.lastIndexOf("*")) return [];
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < prefix.length + suffix.length) return [];
    return [{ target, prefix, suffix, wildcard: subpath.slice(prefix.length, subpath.length - suffix.length) }];
  }).sort((left, right) => right.prefix.length - left.prefix.length || right.suffix.length - left.suffix.length);
  const match = patterns[0];
  return match ? { value: match.target, wildcard: match.wildcard } : null;
}

function findTypesTarget(value: unknown, wildcard: string | null): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTypesTarget(item, wildcard);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const conditions = value as Record<string, unknown>;
  if (Object.hasOwn(conditions, "types")) {
    const found = firstStringTarget(conditions.types, wildcard);
    if (found) return found;
  }
  const preferred = ["import", "browser", "node", "default", "require"];
  for (const key of [...preferred, ...Object.keys(conditions).filter((key) => key !== "types" && !preferred.includes(key))]) {
    if (!Object.hasOwn(conditions, key)) continue;
    const found = findTypesTarget(conditions[key], wildcard);
    if (found) return found;
  }
  return null;
}

function firstStringTarget(value: unknown, wildcard: string | null): string | null {
  if (typeof value === "string") return wildcard === null ? value : value.replaceAll("*", wildcard);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringTarget(item, wildcard);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const conditions = value as Record<string, unknown>;
  for (const key of ["import", "browser", "node", "default", "require", ...Object.keys(conditions)]) {
    if (!Object.hasOwn(conditions, key)) continue;
    const found = firstStringTarget(conditions[key], wildcard);
    if (found) return found;
  }
  return null;
}

export function packageNameOf(source: string): string {
  const parts = source.split("/");
  return source.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? source;
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
