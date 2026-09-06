import { DESKTOP_SERVICE_BODY, DESKTOP_SERVICE_PREFIX } from "../runtime-sources.generated.ts";


/**
 * `velar/service`'s runtime, closed over the service names this project's
 * manifest declares. The names are baked in rather than fetched, so an
 * undeclared name is refused at the `connect` call with the manifest field that
 * would declare it, before any request reaches the host — and the host refuses
 * the same name again on its own side.
 *
 * The token that authenticates a channel is nowhere in this file, and that is
 * the design rather than an omission: the host generates it, hands it to the
 * service process in its environment, and spends it itself on the first frame
 * of every connection. Application code receives a channel, never a credential.
 */
export function desktopServiceSource(names: readonly string[]): string {
  return `${DESKTOP_SERVICE_PREFIX}const declaredServices = new Set(${JSON.stringify(names)});
const declaredServiceList = ${JSON.stringify(names.length === 0 ? "none" : names.join(", "))};
${DESKTOP_SERVICE_BODY}`;
}
