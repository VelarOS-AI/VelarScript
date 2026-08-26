/**
 * Normalizes the two JSON envelopes emitted by supported npm generations.
 * npm through 11 returns `[receipt]`; npm 12 returns `{[packageName]: receipt}`.
 * The receipt itself is unchanged, so every pack/release gate should depend on
 * this one boundary instead of teaching the npm version split independently.
 */
export function parseNpmPackResult(stdout, label = "package") {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm pack returned invalid JSON for ${label}`, { cause: error });
  }
  const receipts = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === "object"
      ? Object.values(parsed)
      : [];
  if (receipts.length !== 1 || !isPackReceipt(receipts[0])) {
    throw new Error(`npm pack returned an invalid result for ${label}`);
  }
  return receipts[0];
}

function isPackReceipt(value) {
  return value !== null && typeof value === "object"
    && typeof value.name === "string"
    && typeof value.version === "string"
    && typeof value.filename === "string"
    && Array.isArray(value.files);
}
