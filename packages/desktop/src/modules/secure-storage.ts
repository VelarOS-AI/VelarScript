import { DESKTOP_SECURE_STORAGE_BODY, DESKTOP_SECURE_STORAGE_PREFIX } from "../runtime-sources.generated.ts";

/**
 * `velar/secure-storage`'s runtime, closed over the credential names the
 * manifest declares. A name outside that list never reaches the keychain, and
 * no stored value is ever put into an error message: the whole point of the
 * module is that the value stays where it was put.
 */
export function desktopSecureStorageSource(names: readonly string[]): string {
  return `${DESKTOP_SECURE_STORAGE_PREFIX}const declaredSecureStorageNames = new Set(${JSON.stringify(names)});
const declaredSecureStorageNameList = ${JSON.stringify(names.length === 0 ? "none" : names.join(", "))};
${DESKTOP_SECURE_STORAGE_BODY}`;
}
