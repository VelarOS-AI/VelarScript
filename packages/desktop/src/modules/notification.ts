import { DESKTOP_NOTIFICATION_BODY, DESKTOP_NOTIFICATION_PREFIX } from "../runtime-sources.generated.ts";

/**
 * `velar/notification`'s runtime, closed over the manifest's `notifications`
 * declaration. All three exports fail at the call when the declaration is
 * absent and name it, rather than failing at the import (D60 rule 153) or
 * quietly delivering nothing.
 */
export function desktopNotificationSource(declared: boolean): string {
  return `${DESKTOP_NOTIFICATION_PREFIX}const notificationsDeclared = ${JSON.stringify(declared)};
${DESKTOP_NOTIFICATION_BODY}`;
}
