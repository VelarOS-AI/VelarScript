function __velarLookDimension(value) {
  if (typeof value !== "string") return null;
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|vw|vh|vmin|vmax|%|fr|ms|s|deg|turn)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? { number, unit: match[2] } : null;
}

function __velarLookNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(label + " must be a finite number");
  return value;
}

function __velarLookDimensionResult(number, unit) {
  if (!Number.isFinite(number)) throw new RangeError("Look arithmetic must produce a finite value");
  return String(Object.is(number, -0) ? 0 : number) + unit;
}

function __velarLookConvertibleDimension(value) {
  if (value.unit === "s") return { number: value.number * 1000, unit: "ms" };
  if (value.unit === "turn") return { number: value.number * 360, unit: "deg" };
  return value;
}

function __velarLookUnary(operator, value) {
  if (typeof value === "number") return operator === "-" ? -__velarLookNumber(value, "Look operand") : __velarLookNumber(value, "Look operand");
  if (typeof value !== "string") throw new TypeError("Look unit arithmetic requires a number or typed visual value");
  if (operator === "+") return value;
  const dimension = __velarLookDimension(value);
  if (dimension) return __velarLookDimensionResult(-dimension.number, dimension.unit);
  return "calc(-1 * (" + value + "))";
}

function __velarLookMath(operator, left, right) {
  if (typeof left === "number" && typeof right === "number") {
    const first = __velarLookNumber(left, "Left Look operand");
    const second = __velarLookNumber(right, "Right Look operand");
    if (operator === "/" && second === 0) throw new RangeError("Look division cannot use zero");
    const result = operator === "+" ? first + second : operator === "-" ? first - second : operator === "*" ? first * second : first / second;
    return __velarLookNumber(result, "Look arithmetic result");
  }
  const leftDimension = __velarLookDimension(left);
  const rightDimension = __velarLookDimension(right);
  if ((operator === "+" || operator === "-") && leftDimension && rightDimension) {
    const first = __velarLookConvertibleDimension(leftDimension);
    const second = __velarLookConvertibleDimension(rightDimension);
    if (first.unit === second.unit) {
      return __velarLookDimensionResult(operator === "+" ? first.number + second.number : first.number - second.number, first.unit);
    }
  }
  if (operator === "*" && leftDimension && typeof right === "number") {
    return __velarLookDimensionResult(leftDimension.number * __velarLookNumber(right, "Right Look operand"), leftDimension.unit);
  }
  if (operator === "*" && typeof left === "number" && rightDimension) {
    return __velarLookDimensionResult(__velarLookNumber(left, "Left Look operand") * rightDimension.number, rightDimension.unit);
  }
  if (operator === "/" && leftDimension && typeof right === "number") {
    const divisor = __velarLookNumber(right, "Right Look operand");
    if (divisor === 0) throw new RangeError("Look unit division cannot use zero");
    return __velarLookDimensionResult(leftDimension.number / divisor, leftDimension.unit);
  }
  if ((typeof left !== "string" && typeof left !== "number") || (typeof right !== "string" && typeof right !== "number")) {
    throw new TypeError("Look unit arithmetic requires numbers or typed visual values");
  }
  return "calc(" + left + " " + operator + " " + right + ")";
}
