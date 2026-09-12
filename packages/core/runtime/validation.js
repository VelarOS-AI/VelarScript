const __velarValidationNativeNumber = globalThis.Number;
const __velarValidationNativeObject = globalThis.Object;
const __velarValidationNativeString = globalThis.String;
const __velarValidationNativeTypeError = globalThis.TypeError;
const __velarValidationNativeRangeError = globalThis.RangeError;
const __velarValidationGetOwnPropertyDescriptor = __velarValidationNativeObject.getOwnPropertyDescriptor;
const __velarValidationFreeze = __velarValidationGetOwnPropertyDescriptor(__velarValidationNativeObject, "freeze")?.value;
const __velarValidationIsFinite = __velarValidationGetOwnPropertyDescriptor(__velarValidationNativeNumber, "isFinite")?.value;
const __velarValidationIsInteger = __velarValidationGetOwnPropertyDescriptor(__velarValidationNativeNumber, "isInteger")?.value;
const __velarValidationIsSafeInteger = __velarValidationGetOwnPropertyDescriptor(__velarValidationNativeNumber, "isSafeInteger")?.value;
const __velarValidationTrim = __velarValidationGetOwnPropertyDescriptor(__velarValidationNativeString.prototype, "trim")?.value;
const __velarValidationCall = __velarValidationGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;

const __velarValidationMaximumRules = 4096;
const __velarValidationMaximumIssues = 4096;
const __velarValidationMaximumMessageLength = 4096;

function __velarValidationApply(fn, receiver, parameters) {
  return __velarValidationCall(fn, receiver, parameters);
}

function __velarValidationOptionalNumber(value, name) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !__velarValidationApply(__velarValidationIsFinite, __velarValidationNativeNumber, [value])) {
    throw new __velarValidationNativeTypeError(name + " must be a finite number or null");
  }
  return value;
}

function __velarValidationMessage(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") throw new __velarValidationNativeTypeError("validation message must be text or null");
  if (value.length === 0 || value.length > __velarValidationMaximumMessageLength) {
    throw new __velarValidationNativeRangeError("validation message must contain 1 to 4096 code units");
  }
  return value;
}

function __velarValidationRule(value, name) {
  if (typeof value !== "function") throw new __velarValidationNativeTypeError(name + " must be a validation rule");
  return value;
}

function __velarValidationPath(value) { return validationPath(value); }

function __velarValidationIssue(path, message) {
  return __velarValidationApply(__velarValidationFreeze, __velarValidationNativeObject, [{
    path: __velarValidationPath(path),
    message: __velarValidationMessage(message, "value is invalid"),
  }]);
}

function __velarValidationIssues(value, name) {
  value = __velarCopyList(value, name + " result");
  if (value.length > __velarValidationMaximumIssues) {
    throw new __velarValidationNativeRangeError("validation cannot return more than 4096 issues");
  }
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current === null || typeof current !== "object") {
      throw new __velarValidationNativeTypeError(name + " returned an invalid validation issue");
    }
    output[output.length] = __velarValidationIssue(__velarValidationApply(__velarValidationGetOwnPropertyDescriptor, __velarValidationNativeObject, [current, "path"])?.value, __velarValidationApply(__velarValidationGetOwnPropertyDescriptor, __velarValidationNativeObject, [current, "message"])?.value);
  }
  return output;
}

function __velarValidationRun(rule, value, path) {
  return __velarValidationIssues(
    __velarValidationApply(__velarValidationRule(rule, "rule"), undefined, [value, __velarValidationPath(path)]),
    "validation rule",
  );
}

function __velarValidationThrow(issue) {
  throw new ValidationError(issue.message, {path: issue.path, reason: issue.message});
}

function __velarValidationStructuralIssue(error) {
  const reason = typeof error.reason === "string" && error.reason.length > 0 ? error.reason : error.message;
  return __velarValidationIssue(error.path, reason);
}

function __velarValidationSuccess(value) {
  return __velarValidationApply(__velarValidationFreeze, __velarValidationNativeObject, [{success: true, value, issues: []}]);
}

function __velarValidationFailure(issues) {
  return __velarValidationApply(__velarValidationFreeze, __velarValidationNativeObject, [{success: false, value: null, issues}]);
}

function __velarValidationAny() {
  return [];
}

function __velarValidationIntegerRule(minimum, maximum, message, safe) {
  const name = safe ? "safeInteger" : "integer";
  minimum = __velarValidationOptionalNumber(minimum, name + " minimum");
  maximum = __velarValidationOptionalNumber(maximum, name + " maximum");
  if (minimum !== null && maximum !== null && minimum > maximum) {
    throw new __velarValidationNativeRangeError(name + " minimum cannot exceed maximum");
  }
  const requirement = safe ? "must be a safe integer" : "must be an integer";
  const range = minimum !== null && maximum !== null
    ? " from " + minimum + " through " + maximum
    : minimum !== null ? " of at least " + minimum
      : maximum !== null ? " of at most " + maximum : "";
  const fallback = requirement + range + (safe ? " within -9007199254740991 through 9007199254740991" : "");
  const detail = __velarValidationMessage(message, fallback);
  return function (value, path) {
    const valid = __velarValidationApply(safe ? __velarValidationIsSafeInteger : __velarValidationIsInteger, __velarValidationNativeNumber, [value])
      && (minimum === null || value >= minimum)
      && (maximum === null || value <= maximum);
    return valid ? [] : [__velarValidationIssue(path, detail)];
  };
}

export function integer(minimum = null, maximum = null, message = null) {
  return __velarValidationIntegerRule(minimum, maximum, message, false);
}

export function safeInteger(minimum = null, maximum = null, message = null) {
  return __velarValidationIntegerRule(minimum, maximum, message, true);
}

export function finite(message = null) {
  const detail = __velarValidationMessage(message, "must be a finite number");
  return function (value, path) {
    return typeof value === "number" && __velarValidationApply(__velarValidationIsFinite, __velarValidationNativeNumber, [value])
      ? [] : [__velarValidationIssue(path, detail)];
  };
}

export function nonBlank(maximum = null, message = null) {
  maximum = __velarValidationOptionalNumber(maximum, "nonBlank maximum");
  if (maximum !== null && (!__velarValidationApply(__velarValidationIsSafeInteger, __velarValidationNativeNumber, [maximum]) || maximum < 1)) {
    throw new __velarValidationNativeRangeError("nonBlank maximum must be a positive integer or null");
  }
  const detail = __velarValidationMessage(message, maximum === null
    ? "must not be blank" : "must not be blank or exceed " + maximum + " code units");
  return function (value, path) {
    const valid = typeof value === "string"
      && __velarValidationApply(__velarValidationTrim, value, []).length > 0
      && (maximum === null || value.length <= maximum);
    return valid ? [] : [__velarValidationIssue(path, detail)];
  };
}

export function refine(test, message) {
  if (typeof test !== "function") throw new __velarValidationNativeTypeError("refine test must be a function");
  const detail = __velarValidationMessage(message, "value is invalid");
  return function (value, path) {
    return __velarValidationApply(test, undefined, [value]) === true ? [] : [__velarValidationIssue(path, detail)];
  };
}

export function field(name, select, rule) {
  if (typeof name !== "string" || name.length === 0 || name.length > 1024) {
    throw new __velarValidationNativeRangeError("field name must contain 1 to 1024 code units");
  }
  if (typeof select !== "function") throw new __velarValidationNativeTypeError("field selector must be a function");
  rule = __velarValidationRule(rule, "field rule");
  return function (value, path) {
    const nested = validationPathAppend(__velarValidationPath(path), {kind: "field", name});
    if (nested[nested.length - 1].kind === "truncated") return [__velarValidationIssue(nested, "diagnostic truncated")];
    return __velarValidationRun(rule, __velarValidationApply(select, undefined, [value]), nested);
  };
}

export function each(rule) {
  rule = __velarValidationRule(rule, "element rule");
  return function (values, path) {
    values = __velarCopyList(values, "each rule values");
    const output = [];
    for (let index = 0; index < values.length; index += 1) {
      const nested = validationPathAppend(__velarValidationPath(path), {kind: "listIndex", index});
      if (nested[nested.length - 1].kind === "truncated") return [__velarValidationIssue(nested, "diagnostic truncated")];
      const issues = __velarValidationRun(rule, values[index], nested);
      for (let issueIndex = 0; issueIndex < issues.length; issueIndex += 1) {
        if (output.length >= __velarValidationMaximumIssues) {
          throw new __velarValidationNativeRangeError("validation cannot return more than 4096 issues");
        }
        output[output.length] = issues[issueIndex];
      }
    }
    return output;
  };
}

export function optional(rule) {
  rule = __velarValidationRule(rule, "optional rule");
  return function (value, path) {
    return value === null || value === undefined ? [] : __velarValidationRun(rule, value, path);
  };
}

export function all(rules) {
  rules = __velarCopyList(rules, "all rules");
  if (rules.length > __velarValidationMaximumRules) {
    throw new __velarValidationNativeRangeError("all cannot compose more than 4096 rules");
  }
  const checked = [];
  for (let index = 0; index < rules.length; index += 1) checked[checked.length] = __velarValidationRule(rules[index], "all rule");
  return function (value, path) {
    const output = [];
    for (let index = 0; index < checked.length; index += 1) {
      const issues = __velarValidationRun(checked[index], value, path);
      for (let issueIndex = 0; issueIndex < issues.length; issueIndex += 1) {
        if (output.length >= __velarValidationMaximumIssues) {
          throw new __velarValidationNativeRangeError("validation cannot return more than 4096 issues");
        }
        output[output.length] = issues[issueIndex];
      }
    }
    return output;
  };
}

export function inspect(value, rule) {
  return __velarValidationRun(rule, value, []);
}

export function validate(value, rule) {
  const issues = inspect(value, rule);
  if (issues.length > 0) __velarValidationThrow(issues[0]);
  return value;
}

export function parse(value, Type, rule = null) {
  if (Type === null || typeof Type !== "object" || typeof Type.parse !== "function") {
    throw new __velarValidationNativeTypeError("parse Type must be a runtime Type value");
  }
  // The thrown form follows the same convention: parse() and safeParse() answer
  // one structural failure with one path and one sentence, and that sentence is
  // shaped exactly as validate()'s is.
  let parsed;
  try {
    parsed = __velarValidationApply(Type.parse, Type, [value]);
  } catch (error) {
    if (!validationIsInstance(error, ValidationError)) throw error;
    __velarValidationThrow(__velarValidationStructuralIssue(error));
  }
  return validate(parsed, rule === null ? __velarValidationAny : rule);
}

export function safeParse(value, Type, rule = null) {
  let parsed;
  try {
    if (Type === null || typeof Type !== "object" || typeof Type.parse !== "function") {
      throw new __velarValidationNativeTypeError("safeParse Type must be a runtime Type value");
    }
    parsed = __velarValidationApply(Type.parse, Type, [value]);
  } catch (error) {
    if (!validationIsInstance(error, ValidationError)) throw error;
    return __velarValidationFailure([__velarValidationStructuralIssue(error)]);
  }
  const issues = rule === null ? [] : inspect(parsed, rule);
  return issues.length === 0 ? __velarValidationSuccess(parsed) : __velarValidationFailure(issues);
}

export function validator(Type, rule = null) {
  if (Type === null || typeof Type !== "object" || typeof Type.parse !== "function") {
    throw new __velarValidationNativeTypeError("validator Type must be a runtime Type value");
  }
  if (rule !== null) rule = __velarValidationRule(rule, "validator rule");
  return __velarValidationApply(__velarValidationFreeze, __velarValidationNativeObject, [{
    parse(value) { return parse(value, Type, rule); },
    safeParse(value) { return safeParse(value, Type, rule); },
    validate(value) { return validate(value, rule === null ? __velarValidationAny : rule); },
    inspect(value) { return rule === null ? [] : inspect(value, rule); },
  }]);
}


export const ValidationPath = registerRuntimeType(__velarValidationApply(__velarValidationFreeze, __velarValidationNativeObject, [{
  is(value) { try { validationPath(value); return true; } catch { return false; } },
  parse(value) { try { return validationPath(value); } catch { throw new ValidationError("Value does not match ValidationPath"); } },
  copy(value) { return validationPath(value); },
}]));
export const ValidationPathSegment = registerRuntimeType(__velarValidationApply(__velarValidationFreeze, __velarValidationNativeObject, [{
  is(value) { return ValidationPath.is([value]); },
  parse(value) { try { return validationPath([value])[0]; } catch { throw new ValidationError("Value does not match ValidationPathSegment"); } },
  copy(value) { return validationPath([value])[0]; },
}]));
