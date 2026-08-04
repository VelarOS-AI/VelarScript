export const VELAR_ERROR_NORMALIZATION_RUNTIME = String.raw`
function __velarNormalizeError(value) {
  if (Error.isError(value)) return value;
  const kind = typeof value;
  let message;
  if (kind === "string") message = value;
  else if (value === null) message = "null";
  else if (kind === "undefined") message = "undefined";
  else if (kind === "number" || kind === "boolean" || kind === "bigint" || kind === "symbol") message = String(value);
  else message = "A non-Error value was thrown by JavaScript";
  return new Error(message, { cause: value });
}
`.trimStart();
