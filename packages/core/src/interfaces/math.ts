import type { ModuleInterface } from "@velarscript/compiler";
import { numberType, functionType, apiFunction, intrinsic, moduleInterface } from "./types.ts";

/** `velar/math`: the numeric vocabulary the language does not spell as an operator. */
export const mathModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["pi", numberType], ["e", numberType], ["tau", numberType], ["infinity", numberType],
  // min and max are pure rest calls and therefore have no named rest value.
  ["min", intrinsic("math.min", [numberType], numberType)],
  ["max", intrinsic("math.max", [numberType], numberType)],
  ["clamp", apiFunction(["value", "minimum", "maximum"], [numberType, numberType, numberType], numberType)],
  ["sqrt", apiFunction(["value"], [numberType], numberType)],
  ["cbrt", apiFunction(["value"], [numberType], numberType)],
  ["pow", apiFunction(["base", "exponent"], [numberType, numberType], numberType)],
  ["exp", apiFunction(["value"], [numberType], numberType)],
  ["log", apiFunction(["value", "base"], [numberType, numberType], numberType, 1)],
  ["log2", apiFunction(["value"], [numberType], numberType)],
  ["log10", apiFunction(["value"], [numberType], numberType)],
  ["sin", apiFunction(["value"], [numberType], numberType)],
  ["cos", apiFunction(["value"], [numberType], numberType)],
  ["tan", apiFunction(["value"], [numberType], numberType)],
  ["asin", apiFunction(["value"], [numberType], numberType)],
  ["acos", apiFunction(["value"], [numberType], numberType)],
  ["atan", apiFunction(["value"], [numberType], numberType)],
  ["atan2", apiFunction(["y", "x"], [numberType, numberType], numberType)],
  ["degrees", apiFunction(["radians"], [numberType], numberType)],
  ["radians", apiFunction(["degrees"], [numberType], numberType)],
  ["hypot", apiFunction(["x", "y"], [numberType, numberType], numberType)],
  ["random", apiFunction([], [], numberType)],
  // randomInt has one-bound and minimum/maximum positional forms.
  ["randomInt", functionType([numberType, numberType], numberType, 1)],
  ["gcd", apiFunction(["left", "right"], [numberType, numberType], numberType)],
  ["lcm", apiFunction(["left", "right"], [numberType, numberType], numberType)],
]));
