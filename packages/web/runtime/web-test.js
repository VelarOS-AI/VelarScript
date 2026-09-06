const browserRuntimeKey = Symbol.for("velar.browser.test.v1");
function browserRuntime() {
  const runtime = globalThis[browserRuntimeKey];
  if (!runtime) throw new Error("velar/web-test browser controls require 'velar test --browser'");
  return runtime;
}
export const browser = Object.freeze({
  open(path = "/") { return browserRuntime().open(path); },
  reload() { return browserRuntime().reload(); },
  click(selector) { return browserRuntime().click(selector); },
  fill(selector, value) { return browserRuntime().fill(selector, value); },
  select(selector, value) { return browserRuntime().select(selector, value); },
  press(selector, key) { return browserRuntime().press(selector, key); },
  scroll(selector, x, y) { return browserRuntime().scroll(selector, x, y); },
  text(selector) { return browserRuntime().text(selector); },
  attribute(selector, name) { return browserRuntime().attribute(selector, name); },
  box(selector) { return browserRuntime().box(selector); },
  style(selector, property) { return browserRuntime().style(selector, property); },
  namespace(selector) { return browserRuntime().namespace(selector); },
  count(selector) { return browserRuntime().count(selector); },
  visible(selector) { return browserRuntime().visible(selector); },
  waitFor(selector, state = "visible") { return browserRuntime().waitFor(selector, state); },
  waitForText(selector, text) { return browserRuntime().waitForText(selector, text); },
  currentPath() { return browserRuntime().currentPath(); },
  viewport(width, height) { return browserRuntime().viewport(width, height); },
  timings() { return browserRuntime().timings(); },
  animation(selector) { return browserRuntime().animation(selector); },
  measureClick(selector) { return browserRuntime().measureClick(selector); },
  measureFill(selector, value) { return browserRuntime().measureFill(selector, value); },
  measurePress(selector, key) { return browserRuntime().measurePress(selector, key); },
});
function storageRuntime(area) {
  return Object.freeze({
    get(key) { return browserRuntime().storageGet(area, key); },
    set(key, value) { return browserRuntime().storageSet(area, key, value); },
    remove(key) { return browserRuntime().storageRemove(area, key); },
    clear() { return browserRuntime().storageClear(area); },
  });
}
export const localStorage = storageRuntime("local");
export const sessionStorage = storageRuntime("session");
export const network = Object.freeze({
  respond(path, body, status = 200, contentType = "application/json; charset=utf-8", delayMs = 0) {
    return browserRuntime().networkRespond(path, body, status, contentType, delayMs);
  },
  clear() { return browserRuntime().networkClear(); },
});
