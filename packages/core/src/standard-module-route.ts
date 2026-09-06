const LEGACY_VELAR_MODULE = /^velar\/[a-z0-9-]+$/u;
const LEGACY_VELAR_ROUTE = /^\/@velar\/([a-z0-9-]+)\.js$/u;
const ENCODED_MODULE_ROUTE = /^\/@velar\/module\/((?:[0-9a-f]{4})+)\.js$/u;
const MAX_STANDARD_MODULE_SPECIFIER_CODE_UNITS = 512;
const MAX_ENCODED_MODULE_ROUTE_LENGTH = "/@velar/module/".length
  + MAX_STANDARD_MODULE_SPECIFIER_CODE_UNITS * 4
  + ".js".length;

/** A path-safe, reversible development route for one compiler-owned module. */
export function standardModuleRoute(source: string): string {
  if (source.length === 0) throw new Error("A Standard runtime module specifier cannot be empty");
  if (source.length > MAX_STANDARD_MODULE_SPECIFIER_CODE_UNITS) {
    throw new RangeError(`A Standard runtime module specifier cannot exceed ${MAX_STANDARD_MODULE_SPECIFIER_CODE_UNITS} UTF-16 code units`);
  }
  if (LEGACY_VELAR_MODULE.test(source)) return `/@velar/${source.slice("velar/".length)}.js`;
  let encoded = "";
  for (let index = 0; index < source.length; index += 1) {
    encoded += source.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return `/@velar/module/${encoded}.js`;
}

/** Decodes only canonical routes produced by {@link standardModuleRoute}. */
export function standardModuleSpecifierFromRoute(pathname: string): string | null {
  if (pathname.length > MAX_ENCODED_MODULE_ROUTE_LENGTH) return null;
  const legacy = LEGACY_VELAR_ROUTE.exec(pathname);
  if (legacy) return `velar/${legacy[1]}`;
  const encoded = ENCODED_MODULE_ROUTE.exec(pathname)?.[1];
  if (!encoded) return null;
  let source = "";
  for (let index = 0; index < encoded.length; index += 4) {
    source += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 4), 16));
  }
  return standardModuleRoute(source) === pathname ? source : null;
}
