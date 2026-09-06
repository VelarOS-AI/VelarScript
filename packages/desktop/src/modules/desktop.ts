import { DESKTOP_MODULE_BODY, DESKTOP_MODULE_PREFIX } from "../runtime-sources.generated.ts";

/**
 * `velar/desktop`'s runtime, closed over the two grants its §5 surface reads:
 * the link schemes `openExternal` may hand to the system, and whether a drag
 * gesture's real paths may be read at all. Both are baked in rather than
 * fetched, so an ungranted call is refused where it is written, with the
 * manifest field that would grant it — and the native host asks the same
 * question again on its own side.
 */
export function desktopModuleSource(links: readonly string[], droppedFiles: boolean): string {
  return `${DESKTOP_MODULE_PREFIX}const grantedLinkSchemes = new Set(${JSON.stringify(links)});
const grantedLinkSchemeList = ${JSON.stringify(links.length === 0 ? "none" : links.join(", "))};
const droppedFilesGranted = ${JSON.stringify(droppedFiles)};
${DESKTOP_MODULE_BODY}`;
}
