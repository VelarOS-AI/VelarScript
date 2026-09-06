import { DESKTOP_WINDOW_BODY, DESKTOP_WINDOW_PREFIX } from "../runtime-sources.generated.ts";

/**
 * `velar/window`'s runtime, closed over the window kinds this project's
 * manifest declares. The kinds are baked in rather than fetched, so an
 * undeclared kind is refused at the `openWindow` call with the manifest field
 * that would declare it, before any request reaches the host — and the host
 * refuses the same kind again on its own side.
 */
export function desktopWindowSource(kinds: readonly string[]): string {
  return `${DESKTOP_WINDOW_PREFIX}const declaredWindowKinds = new Set(${JSON.stringify(kinds)});
const declaredWindowKindList = ${JSON.stringify(kinds.join(", "))};
${DESKTOP_WINDOW_BODY}`;
}
