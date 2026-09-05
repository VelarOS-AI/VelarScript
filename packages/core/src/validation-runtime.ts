import {
  VELAR_COLLECTION_LOWERING_MODULE,
  VELAR_TYPE_VALIDATION_MODULE,
} from "@velarscript/compiler/extension";

/**
 * Target-neutral semantic validation. Structural shape remains owned by the
 * compiler's runtime Type values; this layer only composes domain rules.
 */
export const VELAR_CORE_VALIDATION_RUNTIME = String.raw`
import {ValidationError, validationIsInstance} from "${VELAR_TYPE_VALIDATION_MODULE}";
import {__velarCopyList} from "${VELAR_COLLECTION_LOWERING_MODULE}";

const __velarValidationNativeNumber = globalThis.Number;
const __velarValidationNativeObject = globalThis.Object;
const __velarValidationNativeString = globalThis.String;
const __velarValidationNativeTypeError = globalThis.TypeError;
const __velarValidationNativeRangeError = globalThis.RangeError;
const __velarValidationGetOwnPropertyDescriptor = __velarValidationNativeObject.getOwnPropertyDescriptor;
const __velarValidationFreeze = __velarValidationGetOwnPropertyDescriptor(__velarValidationNativeObject, "freeze")?.value;
const __velarValidationIsFinite = __velarValidationGetOwnPropertyDescriptor(__velarValidationNativeNumber, "isFinite")?.value;
const __velarValidationIsSafeInteger = __velarValidationGetOwnPropertyDescriptor(__velarValidationNativeNumber, "isSafeInteger")?.value;
const __velarValidationTrim = __velarValidationGetOwnPropertyDescriptor(__velarValidationNativeString.prototype, "trim")?.value;
const __velarValidationCall = __velarValidationGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;

const __velarValidationMaximumRules = 4096;
const __velarValidationMaximumIssues = 4096;
const __velarValidationMaximumPathDepth = 64;
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

function __velarValidationPath(value) {
  value = __velarCopyList(value, "validation rule path");
  if (value.length > __velarValidationMaximumPathDepth) {
    throw new __velarValidationNativeRangeError("validation path cannot exceed 64 segments");
  }
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const segment = value[index];
    if (typeof segment !== "string" && (!__velarValidationApply(__velarValidationIsSafeInteger, __velarValidationNativeNumber, [segment]) || segment < 0)) {
      throw new __velarValidationNativeTypeError("validation path segments must be text or non-negative integers");
    }
    output[output.length] = segment;
  }
  return output;
}

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
    output[output.length] = __velarValidationIssue(current.path, current.message);
  }
  return output;
}

function __velarValidationRun(rule, value, path) {
  return __velarValidationIssues(
    __velarValidationApply(__velarValidationRule(rule, "rule"), undefined, [value, __velarValidationPath(path)]),
    "validation rule",
  );
}

function __velarValidationFormatPath(path) {
  if (path.length === 0) return "value";
  let output = "value";
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    output += typeof segment === "number" ? "[" + segment + "]" : "." + segment;
  }
  return output;
}

function __velarValidationThrow(issue) {
  const path = __velarValidationFormatPath(issue.path);
  const tail = issue.path.length === 0 ? null : issue.path[issue.path.length - 1];
  throw new ValidationError(path + ": " + issue.message, {
    path,
    field: typeof tail === "string" ? tail : null,
    reason: issue.message,
  });
}

function __velarValidationStructuralIssue(error) {
  const path = typeof error.path === "string" && error.path.length > 0 ? [error.path] : [];
  const reason = typeof error.reason === "string" && error.reason.length > 0 ? error.reason : error.message;
  return __velarValidationIssue(path, reason);
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

export function integer(minimum = null, maximum = null, message = null) {
  minimum = __velarValidationOptionalNumber(minimum, "integer minimum");
  maximum = __velarValidationOptionalNumber(maximum, "integer maximum");
  if (minimum !== null && maximum !== null && minimum > maximum) {
    throw new __velarValidationNativeRangeError("integer minimum cannot exceed maximum");
  }
  const fallback = minimum !== null && maximum !== null
    ? "must be an integer from " + minimum + " through " + maximum
    : minimum !== null ? "must be an integer of at least " + minimum
      : maximum !== null ? "must be an integer of at most " + maximum : "must be an integer";
  const detail = __velarValidationMessage(message, fallback);
  return function (value, path) {
    const valid = __velarValidationApply(__velarValidationIsSafeInteger, __velarValidationNativeNumber, [value])
      && (minimum === null || value >= minimum)
      && (maximum === null || value <= maximum);
    return valid ? [] : [__velarValidationIssue(path, detail)];
  };
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
    if (path.length >= __velarValidationMaximumPathDepth) {
      throw new __velarValidationNativeRangeError("validation path cannot exceed 64 segments");
    }
    const nested = __velarValidationPath(path);
    nested[nested.length] = name;
    return __velarValidationRun(rule, __velarValidationApply(select, undefined, [value]), nested);
  };
}

export function each(rule) {
  rule = __velarValidationRule(rule, "element rule");
  return function (values, path) {
    values = __velarCopyList(values, "each rule values");
    const output = [];
    for (let index = 0; index < values.length; index += 1) {
      const nested = __velarValidationPath(path);
      nested[nested.length] = index;
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
  const parsed = __velarValidationApply(Type.parse, Type, [value]);
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
`.trimStart();
