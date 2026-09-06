
const lookMissingField = Object.freeze({});
const lookReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const lookGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const lookRegExpTest = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")?.value;
function lookOwnData(value, name) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")
    || typeof lookReflectApply !== "function" || typeof lookGetOwnPropertyDescriptor !== "function") return lookMissingField;
  const descriptor = lookReflectApply(lookGetOwnPropertyDescriptor, Object, [value, name]);
  return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor.value : lookMissingField;
}
function lookMatches(pattern, value) {
  return typeof lookReflectApply === "function" && typeof lookRegExpTest === "function"
    ? lookReflectApply(lookRegExpTest, pattern, [value])
    : false;
}
function lookText(value, label) {
  if (typeof value !== "string") throw new TypeError(label + " must be text");
  if (value.length === 0 || value.length > 65536) throw new RangeError(label + " must contain 1 through 65536 characters");
  return value;
}
function lookFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(label + " must be a finite number");
  return value;
}
function lookRange(value, label, minimum, maximum) {
  value = lookFinite(value, label);
  if (value < minimum || value > maximum) throw new RangeError(label + " must be from " + minimum + " through " + maximum);
  return value;
}
// D114 P6 item 2 (LK-I3): a slot CSS spells as a percentage takes the
// language's own `Percentage`, so the guard reads the number out of the written
// unit and states the bound in the unit the author wrote.
function lookPercentageRange(value, label, minimum, maximum) {
  if (typeof value !== "string" || !lookMatches(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%$/, value)) {
    throw new TypeError(label + " must be a percentage such as 50%");
  }
  const percent = Number(value.slice(0, -1));
  if (!Number.isFinite(percent) || percent < minimum || percent > maximum) {
    throw new RangeError(label + " must be from " + minimum + "% through " + maximum + "%");
  }
  return value;
}
function lookVisual(value, label) {
  if (typeof value === "number") return String(lookFinite(value, label));
  return lookText(value, label);
}
function lookNonNegativeVisual(value, label) {
  const visual = lookVisual(value, label);
  if (lookMatches(/^\s*-/, visual)) throw new RangeError(label + " cannot be negative");
  return visual;
}
function lookResult(value) {
  if (value.length > 1024 * 1024) throw new RangeError("A constructed Look value cannot exceed 1 MiB");
  return value;
}
// A standard module ships to the browser as its own source, so it carries the
// CSS string serializer rather than reaching for the emitted runtime's copy.
// css-string.ts publishes the one implementation both spellings read.
