/** Local and session storage, addressed by area name. */
import type { RuntimeApiContext } from "./context.ts";

export function browserStorageApi(context: RuntimeApiContext) {
  const { page, storageArea } = context;
  return {
    async storageGet(area: unknown, key: unknown) {
      const input = { area: storageArea(area), key: String(key) };
      return page.evaluate(({ area: name, key: itemKey }) => {
        const target = name === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        return target.getItem(itemKey);
      }, input);
    },
    async storageSet(area: unknown, key: unknown, value: unknown) {
      const input = { area: storageArea(area), key: String(key), value: String(value) };
      await page.evaluate(({ area: name, key: itemKey, value: itemValue }) => {
        const target = name === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        target.setItem(itemKey, itemValue);
      }, input);
      return null;
    },
    async storageRemove(area: unknown, key: unknown) {
      const input = { area: storageArea(area), key: String(key) };
      await page.evaluate(({ area: name, key: itemKey }) => {
        const target = name === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        target.removeItem(itemKey);
      }, input);
      return null;
    },
    async storageClear(area: unknown) {
      const name = storageArea(area);
      await page.evaluate((storageName) => {
        const target = storageName === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        target.clear();
      }, name);
      return null;
    },
  };
}
