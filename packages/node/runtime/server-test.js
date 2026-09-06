import { ServeApp as __velarServerTestApp } from "velar/serve";
const __velarServerTestBridge = __velarServerTestApp.__velarCompilerBridge;
export async function client(app, overrides = null) { return await __velarServerTestBridge.testClient(app, overrides); }
export const TestClient = Object.freeze({is(value) { return !!value && typeof value === "object" && typeof value.request === "function" && typeof value.close === "function"; }, parse(value) { if (!TestClient.is(value)) throw new TypeError("Value does not match TestClient"); return value; }});
export const TestResponse = Object.freeze({is(value) { return !!value && typeof value === "object" && Number.isSafeInteger(value.status) && typeof value.text === "function" && typeof value.json === "function"; }, parse(value) { if (!TestResponse.is(value)) throw new TypeError("Value does not match TestResponse"); return value; }});
