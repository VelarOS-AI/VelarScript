/**
 * Why two declarations claim one address, said to the author who has to repair
 * it.
 *
 * D115 P4 R4a. Composition is what makes these sentences hard: the conflicting
 * route or fallback may be in a file the author never opened, so every message
 * that can name an origin does, and the three causes of one collision each name
 * a different repair.
 */
import { type ComposedFallback, type ComposedRoute } from "../contracts.ts";

function describeComposedOrigin(entry: ComposedRoute | ComposedFallback): string {
  return entry.origin.map((name) => `'${name}'`).join(" → ");
}

export function describeComposedRoute(entry: ComposedRoute): string {
  // The effective path: a route seen through prefix(...) collides at its translated address, and
  // that address is the one the author has to narrow.
  const route = `'${entry.route.method} ${entry.path}'`;
  return entry.origin.length === 0 ? route : `${route} (composed in from ${describeComposedOrigin(entry)})`;
}

/**
 * Why two routes claim one method and shape. Three causes reach this point and each names a
 * different repair, so the message has to tell them apart: one server composed in along two paths
 * declares its route once and cannot be narrowed at all, two routes spelling the same path have no
 * parameter names to blame, and only the third is the shape collision parameter names hide.
 */
export function describeRouteCollision(previous: ComposedRoute, entry: ComposedRoute): string {
  // One declaration reaching this server twice is only reachable through spreads: a server's own
  // items are never collected back into it, so both sides carry an origin.
  const declaring = entry.origin[entry.origin.length - 1];
  if (previous.route === entry.route && declaring !== undefined) {
    const paths = describeComposedOrigin(previous) === describeComposedOrigin(entry)
      ? `both times from ${describeComposedOrigin(entry)}`
      : `from ${describeComposedOrigin(previous)} and from ${describeComposedOrigin(entry)}`;
    return `Route '${entry.route.method} ${entry.path}' is composed in twice, ${paths}; '${declaring}' declares it once — remove one spread`;
  }
  if (previous.path === entry.path) {
    return `Route ${describeComposedRoute(entry)} duplicates ${describeComposedRoute(previous)}; one method and path answer from a single route`;
  }
  return `Route ${describeComposedRoute(entry)} conflicts with ${describeComposedRoute(previous)}; parameter names do not make two route shapes distinct`;
}

/**
 * Both sides of a duplicate @notFound. A fallback a spread composes in is invisible in the author's
 * own file, so naming one contributor and not the other leaves him looking for a declaration that
 * is not there; two spreads each composing one name neither by default.
 */
export function describeFallbackCollision(previous: ComposedFallback, entry: ComposedFallback): string {
  const rule = "A server can declare only one @notFound fallback";
  if (previous.origin.length === 0 && entry.origin.length === 0) return rule;
  const source = (fallback: ComposedFallback, second: boolean): string => {
    const article = second ? "another" : "one";
    return fallback.origin.length === 0
      ? `this server declares ${article}`
      : `${describeComposedOrigin(fallback)} composes ${article} in`;
  };
  return `${rule}; ${source(previous, false)} and ${source(entry, true)}`;
}
